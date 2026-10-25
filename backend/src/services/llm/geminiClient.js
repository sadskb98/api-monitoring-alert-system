import { GoogleGenAI } from '@google/genai';

export class LlmTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`LLM call timed out after ${timeoutMs} ms`);
    this.name = 'LlmTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thin @google/genai wrapper: one JSON-mode generateContent call with a hard timeout.
 * The SDK's own retries are left off (the default); alertWriter owns the retry policy.
 * `genai` is injectable for tests.
 */
export function createGeminiClient(
  { apiKey, model, timeoutMs },
  { genai = new GoogleGenAI({ apiKey }) } = {},
) {
  return {
    model,
    async generateJson({ systemInstruction, userContent, responseJsonSchema }) {
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
              abortSignal: controller.signal,
            },
          }),
          timeout,
        ]);
        return response.text ?? '';
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
