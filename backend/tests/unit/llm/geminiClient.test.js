import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import {
  LlmTimeoutError,
  createGeminiClient,
  isThinkingConfigRejected,
} from '../../../src/services/llm/geminiClient.js';
import { captureLogger, silentLogger } from '../../helpers.js';

const fakeGenai = (generateContent) => ({ models: { generateContent } });
const args = {
  systemInstruction: 'sys',
  userContent: '{"items":[]}',
  responseJsonSchema: { type: 'object' },
  log: silentLogger,
};
const THINKING_400 = () =>
  new ApiError({ status: 400, message: 'Thinking level MINIMAL is not supported for this model.' });

/** Fake genai recording each request's config; `script` entries are results or errors, in call order. */
function recordingGenai(...script) {
  const configs = [];
  const genai = fakeGenai(async (req) => {
    configs.push(req.config);
    const next = script.shift();
    if (next instanceof Error) throw next;
    return { text: next };
  });
  return { genai, configs };
}

describe('createGeminiClient', () => {
  it('sends one JSON-mode request with the configured model and returns the text', async () => {
    let request;
    const client = createGeminiClient(
      { model: 'test-model', timeoutMs: 1000 },
      {
        genai: fakeGenai(async (req) => {
          request = req;
          return { text: '{"alerts":[]}' };
        }),
      },
    );

    expect(await client.generateJson(args)).toBe('{"alerts":[]}');
    expect(request).toMatchObject({
      model: 'test-model',
      contents: '{"items":[]}',
      config: {
        systemInstruction: 'sys',
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
      },
    });
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('returns an empty string when the response has no text', async () => {
    const client = createGeminiClient(
      { model: 'm', timeoutMs: 1000 },
      { genai: fakeGenai(async () => ({})) },
    );
    expect(await client.generateJson(args)).toBe('');
  });

  it('times out with LlmTimeoutError and aborts the request', async () => {
    let signal;
    const client = createGeminiClient(
      { model: 'm', timeoutMs: 20 },
      {
        genai: fakeGenai((req) => {
          signal = req.config.abortSignal;
          return new Promise(() => {}); // never settles, like a hung request
        }),
      },
    );
    await expect(client.generateJson(args)).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(signal.aborted).toBe(true);
  });

  it('passes SDK errors through unchanged', async () => {
    const err = Object.assign(new Error('high demand'), { status: 503 });
    const client = createGeminiClient(
      { model: 'm', timeoutMs: 1000 },
      { genai: fakeGenai(async () => Promise.reject(err)) },
    );
    await expect(client.generateJson(args)).rejects.toBe(err);
  });

  it('sends thinkingConfig.thinkingLevel using the SDK enum value', async () => {
    const { genai, configs } = recordingGenai('{}');
    const client = createGeminiClient({ model: 'm', timeoutMs: 1000, thinkingLevel: 'minimal' }, { genai });
    await client.generateJson(args);
    expect(configs[0].thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(configs[0]).not.toHaveProperty('thinkingConfig.thinkingBudget');
  });

  it('omits thinkingConfig when no level is configured', async () => {
    const { genai, configs } = recordingGenai('{}');
    await createGeminiClient({ model: 'm', timeoutMs: 1000 }, { genai }).generateJson(args);
    expect(configs[0]).not.toHaveProperty('thinkingConfig');
  });

  it('the timeout is per request: a later call gets a fresh timer', async () => {
    let calls = 0;
    const client = createGeminiClient(
      { model: 'm', timeoutMs: 40 },
      {
        genai: fakeGenai(() => {
          calls++;
          if (calls === 1) return new Promise(() => {}); // hangs -> times out at 40 ms
          return new Promise((resolve) => setTimeout(() => resolve({ text: 'ok' }), 25));
        }),
      },
    );
    await expect(client.generateJson(args)).rejects.toBeInstanceOf(LlmTimeoutError);
    // 40 ms already spent above; a shared budget would time this one out too
    expect(await client.generateJson(args)).toBe('ok');
  });

  describe('when the model rejects the thinking level', () => {
    it('warns and retries once without thinkingConfig, then keeps omitting it', async () => {
      const { genai, configs } = recordingGenai(THINKING_400(), '{"a":1}', '{"a":2}');
      const { log, warnings } = captureLogger();
      const client = createGeminiClient({ model: 'm', timeoutMs: 1000, thinkingLevel: 'minimal' }, { genai });

      expect(await client.generateJson({ ...args, log })).toBe('{"a":1}');
      expect(await client.generateJson({ ...args, log })).toBe('{"a":2}');

      expect(configs.map((c) => c.thinkingConfig)).toEqual([
        { thinkingLevel: 'MINIMAL' },
        undefined,
        undefined,
      ]);
      expect(warnings('Model rejected thinkingConfig; retrying without it')).toEqual([
        expect.objectContaining({
          model: 'm',
          thinking_level: 'MINIMAL',
          detail: expect.stringMatching(/Thinking level/),
        }),
      ]);
    });

    it('retries only once: a second failure propagates', async () => {
      const err = new ApiError({ status: 503, message: 'high demand' });
      const { genai, configs } = recordingGenai(THINKING_400(), err);
      const client = createGeminiClient({ model: 'm', timeoutMs: 1000, thinkingLevel: 'low' }, { genai });
      await expect(client.generateJson(args)).rejects.toBe(err);
      expect(configs).toHaveLength(2);
    });

    it('does not retry other 400s', async () => {
      const err = new ApiError({ status: 400, message: 'Invalid JSON payload' });
      const { genai, configs } = recordingGenai(err);
      const client = createGeminiClient({ model: 'm', timeoutMs: 1000, thinkingLevel: 'minimal' }, { genai });
      await expect(client.generateJson(args)).rejects.toBe(err);
      expect(configs).toHaveLength(1);
    });
  });
});

describe('isThinkingConfigRejected', () => {
  it.each([
    [THINKING_400(), true],
    [new ApiError({ status: 400, message: 'thinking_level is not supported' }), true],
    [new ApiError({ status: 400, message: 'Invalid argument' }), false],
    [new ApiError({ status: 503, message: 'thinking overloaded' }), false],
    [new Error('thinking'), false],
  ])('%s -> %s', (err, expected) => {
    expect(isThinkingConfigRejected(err)).toBe(expected);
  });
});
