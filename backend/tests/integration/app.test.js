import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { fakeDb, silentLogger, testConfig } from '../helpers.js';

const makeApp = ({ readyState = 1, env = {} } = {}) =>
  createApp({ config: testConfig(env), logger: silentLogger, db: fakeDb(readyState) });

describe('GET /health', () => {
  it('returns 200 when the DB is up', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up', llm: 'disabled' });
    expect(res.body.uptime_s).toEqual(expect.any(Number));
  });

  it('returns 503 when the DB is down', async () => {
    const res = await request(makeApp({ readyState: 0 })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('reports the LLM as enabled when a key is configured', async () => {
    const res = await request(makeApp({ env: { GEMINI_API_KEY: 'k' } })).get('/health');
    expect(res.body.llm).toBe('enabled');
  });
});

describe('request ids', () => {
  it('generates an x-request-id', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a valid incoming x-request-id', async () => {
    const res = await request(makeApp()).get('/health').set('x-request-id', 'trace-abc-1');
    expect(res.headers['x-request-id']).toBe('trace-abc-1');
  });

  it('includes the request id on error responses', async () => {
    const res = await request(makeApp()).get('/nope').set('x-request-id', 'trace-404');
    expect(res.headers['x-request-id']).toBe('trace-404');
  });
});

describe('error handling', () => {
  it('returns the canonical 404 shape for unknown routes', async () => {
    const res = await request(makeApp()).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /does-not-exist not found', details: null },
    });
  });

  it('returns 400 INVALID_JSON for malformed JSON', async () => {
    const res = await request(makeApp())
      .post('/monitor')
      .set('content-type', 'application/json')
      .send('[{"api_name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE when the body exceeds the batch-derived limit', async () => {
    // MAX_BATCH_SIZE=1 -> 100 KB floor
    const app = makeApp({ env: { MAX_BATCH_SIZE: '1' } });
    const big = JSON.stringify([{ api_name: 'X', padding: 'a'.repeat(110 * 1024) }]);
    const res = await request(app).post('/monitor').set('content-type', 'application/json').send(big);
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', details: { limit_bytes: 102_400 } });
  });

  it('accepts a body under the limit (reaches routing)', async () => {
    const app = makeApp({ env: { MAX_BATCH_SIZE: '1' } });
    const ok = JSON.stringify([{ api_name: 'X', padding: 'a'.repeat(50 * 1024) }]);
    const res = await request(app).post('/monitor').set('content-type', 'application/json').send(ok);
    expect(res.status).toBe(404); // /monitor arrives in a later phase
  });
});
