import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { LlmTimeoutError } from '../../../src/services/llm/geminiClient.js';
import { backoffMs, classifyLlmError, withRetry } from '../../../src/services/llm/retry.js';
import { captureLogger } from '../../helpers.js';

const HIGH_DEMAND =
  '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';
const apiError = (status, message = `error ${status}`) => new ApiError({ status, message });

describe('classifyLlmError', () => {
  it.each([
    ['Gemini 503 high demand', apiError(503, HIGH_DEMAND), 'unavailable', true],
    ['503 without a body', apiError(503), 'unavailable', true],
    ['high demand without a status', new Error(HIGH_DEMAND), 'unavailable', true],
    ['UNAVAILABLE without a status', new Error('got status: UNAVAILABLE'), 'unavailable', true],
    ['timeout', new LlmTimeoutError(8000), 'timeout', true],
    ['408', apiError(408), 'timeout', true],
    ['429', apiError(429), 'rate_limited', true],
    ['500', apiError(500), 'server_error', true],
    ['504', apiError(504), 'server_error', true],
    [
      'network',
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
      'network_error',
      true,
    ],
    ['400', apiError(400), 'request_rejected', false],
    ['401', apiError(401), 'request_rejected', false],
    ['403', apiError(403), 'request_rejected', false],
    ['404 unknown model', apiError(404), 'request_rejected', false],
    ['unknown', new Error('boom'), 'unexpected_error', false],
  ])('%s -> %s (retryable=%s)', (_label, err, reason, retryable) => {
    expect(classifyLlmError(err)).toMatchObject({ reason, retryable });
  });

  it('keeps the status and a bounded detail', () => {
    const c = classifyLlmError(apiError(503, 'x'.repeat(1000)));
    expect(c.status).toBe(503);
    expect(c.detail).toHaveLength(300);
  });
});

describe('backoffMs', () => {
  it('grows exponentially and is capped at 8s', () => {
    const max = (attempt) => backoffMs(attempt, () => 1);
    expect([1, 2, 3, 4, 5].map(max)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it('applies jitter down to half', () => {
    expect(backoffMs(2, () => 0)).toBe(1000);
  });
});

describe('withRetry', () => {
  const run = (fn, maxRetries = 2) => {
    const sleeps = [];
    const { log, warnings } = captureLogger();
    const promise = withRetry(fn, {
      maxRetries,
      log,
      sleep: async (ms) => sleeps.push(ms),
      random: () => 1,
    });
    return { promise, sleeps, warnings };
  };

  it('retries a 503 high-demand error and then succeeds', async () => {
    let calls = 0;
    const { promise, sleeps, warnings } = run(async () => {
      calls++;
      if (calls === 1) throw apiError(503, HIGH_DEMAND);
      return 'ok';
    });
    expect(await promise).toEqual({ ok: true, value: 'ok', attempts: 2 });
    expect(sleeps).toEqual([1000]);
    expect(warnings('LLM call failed, retrying')).toEqual([
      { attempt: 1, reason: 'unavailable', status: 503, retry_in_ms: 1000 },
    ]);
  });

  it('gives up after maxRetries + 1 attempts', async () => {
    const { promise, sleeps } = run(async () => {
      throw apiError(503, HIGH_DEMAND);
    });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, attempts: 3, failure: { reason: 'unavailable' } });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('does not retry a non-retryable error', async () => {
    let calls = 0;
    const { promise, sleeps } = run(async () => {
      calls++;
      throw apiError(400);
    });
    expect(await promise).toMatchObject({ ok: false, attempts: 1, failure: { reason: 'request_rejected' } });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('maxRetries 0 means a single attempt', async () => {
    const { promise } = run(async () => {
      throw new LlmTimeoutError(10);
    }, 0);
    expect(await promise).toMatchObject({ ok: false, attempts: 1, failure: { reason: 'timeout' } });
  });
});
