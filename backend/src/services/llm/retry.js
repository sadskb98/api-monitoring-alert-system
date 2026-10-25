import { LlmTimeoutError } from './geminiClient.js';

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 8000;
const DETAIL_MAX = 300;

// Gemini 503s read e.g. "This model is currently experiencing high demand" / status UNAVAILABLE.
const UNAVAILABLE = /\bUNAVAILABLE\b|high demand|overloaded/i;
const NETWORK = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i;

function statusOf(err) {
  const status = err?.status ?? err?.code;
  return Number.isInteger(status) ? status : null;
}

/**
 * Pure: classify an LLM call failure.
 * Retryable: timeouts, 408, 429, 503 / "high demand" / UNAVAILABLE, other 5xx, network errors.
 * Not retryable: other 4xx (bad request, auth, unknown model) and anything unrecognized.
 * @returns {{ reason: string, retryable: boolean, status: number|null, detail: string }}
 */
export function classifyLlmError(err) {
  const status = statusOf(err);
  const message = String(err?.message ?? err);
  const detail = message.slice(0, DETAIL_MAX);
  const result = (reason, retryable) => ({ reason, retryable, status, detail });

  if (err instanceof LlmTimeoutError || status === 408) return result('timeout', true);
  if (status === 429) return result('rate_limited', true);
  if (status === 503 || (status === null && UNAVAILABLE.test(message))) return result('unavailable', true);
  if (status !== null && status >= 500) return result('server_error', true);
  if (status !== null && status >= 400) return result('request_rejected', false);
  if (status === null && NETWORK.test(`${message} ${err?.cause?.code ?? ''}`)) {
    return result('network_error', true);
  }
  return result('unexpected_error', false);
}

/** Pure: exponential backoff (1s, 2s, 4s, ... capped at 8s) with jitter in [50%, 100%]. */
export function backoffMs(attempt, random = Math.random) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.round(exp * (0.5 + random() * 0.5));
}

/**
 * Call `fn` with up to `maxRetries` retries on retryable failures. Never throws.
 * @returns {Promise<{ ok: true, value, attempts } | { ok: false, failure, attempts }>}
 */
export async function withRetry(fn, { maxRetries, log, sleep, random = Math.random }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true, value: await fn(), attempts: attempt };
    } catch (err) {
      const failure = classifyLlmError(err);
      if (!failure.retryable || attempt > maxRetries) return { ok: false, failure, attempts: attempt };
      const delay = backoffMs(attempt, random);
      log.warn(
        { attempt, reason: failure.reason, status: failure.status, retry_in_ms: delay },
        'LLM call failed, retrying',
      );
      await sleep(delay);
    }
  }
}
