import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../../src/api/client.js';
import { DEFAULT_FILTERS } from '../../src/lib/filters.js';

function response(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function clientWith(handler) {
  const fetchImpl = vi.fn(handler);
  return { client: createApiClient({ baseUrl: 'http://api.test', fetchImpl }), fetchImpl };
}

describe('createApiClient', () => {
  it('lists alerts with the filters as query parameters', async () => {
    const page = { data: [], meta: { total: 0 } };
    const { client, fetchImpl } = clientWith(async () => response(200, page));
    await expect(client.listAlerts({ ...DEFAULT_FILTERS, severity: ['critical'] })).resolves.toEqual(page);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://api.test/alerts?status=active&sort=severity&severity=critical&page=1&limit=25',
    );
  });

  it('posts the batch text as-is and returns the request id with the result', async () => {
    const { client, fetchImpl } = clientWith(async () =>
      response(200, { batch_id: 'b1' }, { 'X-Request-Id': 'req-9' }),
    );
    const text = '[{"api_name":"A"}]';
    await expect(client.submitBatch(text)).resolves.toEqual({ batch_id: 'b1', request_id: 'req-9' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/monitor');
    expect(init).toMatchObject({
      method: 'POST',
      body: text,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('turns the backend error body into an ApiError with code, details and request id', async () => {
    const details = [{ index: 0, issues: [{ path: 'api_name', message: 'Required' }] }];
    const { client } = clientWith(async () =>
      response(
        400,
        { error: { code: 'VALIDATION_ERROR', message: 'No valid observations in batch', details } },
        { 'X-Request-Id': 'req-1' },
      ),
    );
    const error = await client.submitBatch('[{}]').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'No valid observations in batch',
      details,
      requestId: 'req-1',
    });
  });

  it('copes with a non-JSON error body', async () => {
    const { client } = clientWith(async () => new Response('Bad gateway', { status: 502 }));
    await expect(client.listAlerts(DEFAULT_FILTERS)).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'Request failed with status 502',
    });
  });

  it('maps a network failure to a NETWORK error naming the API URL', async () => {
    const { client } = clientWith(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.getHealth()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK',
      message: "Can't reach the API at http://api.test",
    });
  });

  it('treats a 503 health report as data (degraded), not an error', async () => {
    const report = { status: 'degraded', db: 'down', llm: 'enabled', uptime_s: 5 };
    const { client } = clientWith(async () => response(503, report));
    await expect(client.getHealth()).resolves.toEqual(report);
  });

  it('resolves an alert with PATCH { status: "resolved" }', async () => {
    const { client, fetchImpl } = clientWith(async () =>
      response(200, { data: { id: 'x', status: 'resolved' } }),
    );
    await expect(client.resolveAlert('x')).resolves.toEqual({ id: 'x', status: 'resolved' });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: '{"status":"resolved"}' });
  });

  it('lets aborts through untouched (TanStack Query cancels stale requests)', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const { client } = clientWith(async () => {
      throw abort;
    });
    await expect(client.listAlerts(DEFAULT_FILTERS)).rejects.toBe(abort);
  });
});
