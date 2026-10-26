import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Alert } from '../../src/models/Alert.js';
import { useTestDb } from '../db.js';
import { SPEC_EXAMPLE } from '../fixtures.js';
import { silentLogger, testConfig } from '../helpers.js';
import { runBatch } from '../pipeline.js';

useTestDb();

const app = () => createApp({ config: testConfig(), logger: silentLogger, db: mongoose.connection });
const t = (hhmm) => new Date(`2026-10-25T${hhmm}:00Z`);
const rec = (api_name, overrides = {}) => ({
  api_name,
  response_time_ms: 100,
  status_code: 200,
  records_returned: 5,
  ...overrides,
});

/** Seeds: critical (AppointmentAPI), high (BillingAPI auth), medium (SearchAPI zero records), resolved (OldAPI). */
async function seed() {
  await runBatch(
    [
      SPEC_EXAMPLE[1],
      rec('BillingAPI', { status_code: 401 }),
      rec('SearchAPI', { records_returned: 0 }),
      rec('OldAPI', { status_code: 503 }),
    ],
    { now: t('10:00') },
  );
  await runBatch([rec('OldAPI')], { now: t('10:01') }); // resolves OldAPI
  await runBatch([rec('SearchAPI', { records_returned: 0 })], { now: t('10:02') }); // SearchAPI seen most recently
}

describe('GET /alerts', () => {
  beforeEach(seed);

  it('returns active alerts by default, most severe first, with meta', async () => {
    const res = await request(app()).get('/alerts');
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.api_name)).toEqual(['AppointmentAPI', 'BillingAPI', 'SearchAPI']);
    expect(res.body.meta).toEqual({
      total: 3,
      page: 1,
      limit: 50,
      counts_by_severity: { low: 0, medium: 1, high: 1, critical: 1 },
    });
  });

  it('serializes alerts with id and without internal fields', async () => {
    const { body } = await request(app()).get('/alerts');
    const alert = body.data[0];
    expect(alert.id).toMatch(/^[a-f0-9]{24}$/);
    expect(alert).not.toHaveProperty('_id');
    expect(alert).not.toHaveProperty('severity_rank');
    expect(alert).toMatchObject({
      api_name: 'AppointmentAPI',
      status: 'active',
      severity: 'critical',
      anomalies: [
        { rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' },
        { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
      ],
      last_observation: { status_code: 500, response_time_ms: 5500, records_returned: 0 },
      message_source: 'template',
    });
  });

  it('filters by status', async () => {
    const resolved = await request(app()).get('/alerts?status=resolved');
    expect(resolved.body.data.map((a) => a.api_name)).toEqual(['OldAPI']);
    expect(resolved.body.data[0]).toMatchObject({ resolved_by: 'auto' });

    const all = await request(app()).get('/alerts?status=all');
    expect(all.body.meta.total).toBe(4);
  });

  it('filters by severity (csv) while counts still cover every severity', async () => {
    const res = await request(app()).get('/alerts?severity=critical,high');
    expect(res.body.data.map((a) => a.severity)).toEqual(['critical', 'high']);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.counts_by_severity).toEqual({ low: 0, medium: 1, high: 1, critical: 1 });
  });

  it('filters by api_name case-insensitively', async () => {
    const res = await request(app()).get('/alerts?api_name=billingapi');
    expect(res.body.data.map((a) => a.api_name)).toEqual(['BillingAPI']);
  });

  it('filters by a partial api_name (substring, any case)', async () => {
    const res = await request(app()).get('/alerts?api_name=POINT');
    expect(res.body.data.map((a) => a.api_name)).toEqual(['AppointmentAPI']);

    const all = await request(app()).get('/alerts?api_name=api');
    expect(all.body.data.map((a) => a.api_name).sort()).toEqual([
      'AppointmentAPI',
      'BillingAPI',
      'SearchAPI',
    ]);
    expect(all.body.meta.counts_by_severity).toEqual({ low: 0, medium: 1, high: 1, critical: 1 });
  });

  it('matches regex special characters literally', async () => {
    for (const query of ['.', '.*', '(', 'Billing|Search']) {
      const res = await request(app()).get(`/alerts?api_name=${encodeURIComponent(query)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    }
  });

  it('filters by rule', async () => {
    const res = await request(app()).get('/alerts?rule=LATENCY_CRITICAL');
    expect(res.body.data.map((a) => a.api_name)).toEqual(['AppointmentAPI']);
  });

  it('sorts by last_seen', async () => {
    const res = await request(app()).get('/alerts?sort=last_seen');
    expect(res.body.data[0].api_name).toBe('SearchAPI');
  });

  it('paginates', async () => {
    const page2 = await request(app()).get('/alerts?limit=2&page=2');
    expect(page2.body.data.map((a) => a.api_name)).toEqual(['SearchAPI']);
    expect(page2.body.meta).toMatchObject({ total: 3, page: 2, limit: 2 });
  });

  it.each([
    ['status=open', 'status'],
    ['severity=urgent', 'severity.0'],
    ['limit=0', 'limit'],
    ['limit=500', 'limit'],
    ['page=abc', 'page'],
    ['sort=name', 'sort'],
    ['rule=NOPE', 'rule'],
  ])('rejects invalid query %s with 400', async (qs, path) => {
    const res = await request(app()).get(`/alerts?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toContain(path);
  });
});

describe('GET /alerts/:id', () => {
  it('returns one alert', async () => {
    await runBatch(SPEC_EXAMPLE, { now: t('10:00') });
    const [doc] = await Alert.find({}).lean();
    const res = await request(app()).get(`/alerts/${doc._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: String(doc._id), api_name: 'AppointmentAPI' });
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app()).get(`/alerts/${new mongoose.Types.ObjectId()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    const res = await request(app()).get('/alerts/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('id');
  });
});

describe('PATCH /alerts/:id', () => {
  let id;
  beforeEach(async () => {
    await runBatch(SPEC_EXAMPLE, { now: t('10:00') });
    id = String((await Alert.findOne({}).lean())._id);
  });

  it('manually resolves an active alert', async () => {
    const res = await request(app()).patch(`/alerts/${id}`).send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, status: 'resolved', resolved_by: 'manual' });
    expect(res.body.data.resolved_at).toEqual(expect.any(String));

    const list = await request(app()).get('/alerts');
    expect(list.body.data).toEqual([]);
  });

  it('is idempotent for an already-resolved alert', async () => {
    const first = await request(app()).patch(`/alerts/${id}`).send({ status: 'resolved' });
    const second = await request(app()).patch(`/alerts/${id}`).send({ status: 'resolved' });
    expect(second.status).toBe(200);
    expect(second.body.data.resolved_at).toBe(first.body.data.resolved_at);
  });

  it('keeps an auto-resolved alert as resolved_by auto', async () => {
    await runBatch([{ ...SPEC_EXAMPLE[1], status_code: 200, response_time_ms: 100, records_returned: 3 }]);
    const res = await request(app()).patch(`/alerts/${id}`).send({ status: 'resolved' });
    expect(res.body.data.resolved_by).toBe('auto');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app())
      .patch(`/alerts/${new mongoose.Types.ObjectId()}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });

  it.each([[{}], [{ status: 'active' }], [{ status: 'resolved', extra: 1 }], [{ acknowledged: true }]])(
    'rejects body %j with 400',
    async (body) => {
      const res = await request(app()).patch(`/alerts/${id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('GET /health with a real connection', () => {
  it('reports the DB as up', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('up');
  });
});
