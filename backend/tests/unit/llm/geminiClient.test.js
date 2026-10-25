import { describe, expect, it } from 'vitest';
import { LlmTimeoutError, createGeminiClient } from '../../../src/services/llm/geminiClient.js';

const fakeGenai = (generateContent) => ({ models: { generateContent } });
const args = {
  systemInstruction: 'sys',
  userContent: '{"items":[]}',
  responseJsonSchema: { type: 'object' },
};

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
});
