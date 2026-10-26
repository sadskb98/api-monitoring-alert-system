import { toAlertsQuery } from '../lib/filters.js';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

/** Error from the backend's `{ error: { code, message, details } }` body, or a network failure (status 0). */
export class ApiError extends Error {
  constructor({ status, code, message, details = null, requestId = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

/**
 * Thin fetch wrapper for the backend API. `fetchImpl` is injectable for tests.
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createApiClient({ baseUrl = API_URL, fetchImpl = (...args) => fetch(...args) } = {}) {
  async function request(path, { method = 'GET', body, signal, acceptStatuses = [] } = {}) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        signal,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new ApiError({ status: 0, code: 'NETWORK', message: `Can't reach the API at ${baseUrl}` });
    }

    const requestId = res.headers.get('x-request-id');
    const payload = await res.json().catch(() => null);
    if (res.ok || acceptStatuses.includes(res.status)) return { payload, requestId, status: res.status };

    const error = payload?.error;
    throw new ApiError({
      status: res.status,
      code: error?.code ?? 'HTTP_ERROR',
      message: error?.message ?? `Request failed with status ${res.status}`,
      details: error?.details ?? null,
      requestId,
    });
  }

  return {
    baseUrl,

    /** GET /alerts -> { data, meta: { total, page, limit, counts_by_severity } } */
    async listAlerts(filters, { signal } = {}) {
      const { payload } = await request(`/alerts?${toAlertsQuery(filters)}`, { signal });
      return payload;
    },

    /** GET /health -> { status, db, llm, uptime_s }; 503 (degraded) is a valid answer, not an error. */
    async getHealth({ signal } = {}) {
      const { payload } = await request('/health', { signal, acceptStatuses: [503] });
      return payload;
    },

    /** POST /monitor with the editor text as-is (already checked to be JSON). */
    async submitBatch(text) {
      const { payload, requestId } = await request('/monitor', { method: 'POST', body: text });
      return { ...payload, request_id: requestId };
    },

    /** PATCH /alerts/:id -> the resolved alert. */
    async resolveAlert(id) {
      const { payload } = await request(`/alerts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      });
      return payload.data;
    },
  };
}
