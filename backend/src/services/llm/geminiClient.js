import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export class LlmTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`LLM call timed out after ${timeoutMs} ms`);
    this.name = 'LlmTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Pure: a 400 that rejects the thinking config (e.g. a level this model does not support). */
export function isThinkingConfigRejected(err) {
  return err?.status === 400 && /thinking/i.test(String(err?.message));
}

/**
 * Thin @google/genai wrapper: one JSON-mode generateContent call with a hard timeout.
 * The timeout is per HTTP request: every call (and so every retry attempt) gets a fresh timer.
 * The SDK's own retries are left off (the default); alertWriter owns the retry policy.
 *
 * thinkingConfig.thinkingLevel (Gemini 3 field; the legacy thinkingBudget is not sent, since
 * sending both is a 400) keeps reasoning minimal. If the model rejects the level, the request is
 * retried once without thinkingConfig, and later calls from this client omit it too.
 * `genai` is injectable for tests.
 */
export function createGeminiClient(
  { apiKey, model, timeoutMs, thinkingLevel },
  { genai = new GoogleGenAI({ apiKey }) } = {},
) {
  // config value 'minimal' -> ThinkingLevel.MINIMAL ('MINIMAL'), etc.
  let thinkingConfig = thinkingLevel ? { thinkingLevel: ThinkingLevel[thinkingLevel.toUpperCase()] } : null;

  async function request({ systemInstruction, userContent, responseJsonSchema }) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LlmTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        genai.models.generateContent({
          model,
          contents: userContent,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseJsonSchema,
            ...(thinkingConfig ? { thinkingConfig } : {}),
            abortSignal: controller.signal,
          },
        }),
        timeout,
      ]);
      return response.text ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    model,
    async generateJson({ log, ...args }) {
      try {
        return await request(args);
      } catch (err) {
        if (!thinkingConfig || !isThinkingConfigRejected(err)) throw err;
        log.warn(
          { model, thinking_level: thinkingConfig.thinkingLevel, detail: String(err.message).slice(0, 300) },
          'Model rejected thinkingConfig; retrying without it',
        );
        thinkingConfig = null;
        return request(args);
      }
    },
  };
}
