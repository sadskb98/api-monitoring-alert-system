import { ApiError } from '@google/genai';
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Alert } from '../../src/models/Alert.js';
import { Batch } from '../../src/models/Batch.js';
import { createAlertWriter } from '../../src/services/llm/alertWriter.js';
import { createMonitorService } from '../../src/services/monitor.service.js';
import { useTestDb } from '../db.js';
import { SPEC_EXAMPLE } from '../fixtures.js';
import { captureLogger, testConfig } from '../helpers.js';

useTestDb();

const APPOINTMENT_OK = {
  api_name: 'AppointmentAPI',
  response_time_ms: 300,
  status_code: 200,
  records_returned: 12,
};

/** Fake LLM that answers every prompt item, writing the facts it was given. */
function echoClient({ fail = null } = {}) {
  const client = {
    calls: 0,
    async generateJson({ userContent }) {
      client.calls++;
      if (fail) throw fail();
      const { items } = JSON.parse(userContent);
      return JSON.stringify({
        alerts: items.map(({ id, api_name, observation: o }) => ({
          id,
          title: `${api_name} degraded`,
          message: `${api_name} returned status ${o.status_code} with ${o.records_returned} records in ${o.response_time_ms} ms; possible outage.`,
          suggested_action: 'Check the service logs.',
        })),
      });
    },
  };
  return client;
}

function makeApp({ client = null, env = {} } = {}) {
  const config = testConfig(env);
  const { log, warnings } = captureLogger();
  const alertWriter = createAlertWriter({
    llm: { ...config.llm, enabled: Boolean(client) },
    thresholds: config.thresholds,
    client,
    sleep: async () => {},
  });
  const app = createApp({
    config,
    logger: log,
    db: mongoose.connection,
    monitorService: createMonitorService({ config, alertWriter }),
  });
  return { app, warnings };
}

const post = (app, body) => request(app).post('/monitor').send(body);

describe('POST /monitor', () => {
  it('spec example: one critical AppointmentAPI alert stating 500, 0 records and 5500 ms (LLM text)', async () => {
    const client = echoClient();
    const { app } = makeApp({ client });
    const res = await post(app, SPEC_EXAMPLE);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      batch_id: expect.stringMatching(/^[a-f0-9]{24}$/),
      received: 2,
      accepted: 2,
      rejected: [],
      findings: 1,
      alerts: { created: 1, escalated: 0, updated: 0, resolved: 0 },
      llm: { status: 'ok', attempts: 1 },
    });
    expect(res.body.items).toEqual([
      expect.objectContaining({
        api_name: 'AppointmentAPI',
        action: 'created',
        status: 'active',
        severity: 'critical',
        anomalies: [
          { rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' },
          { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
        ],
        message_source: 'llm',
      }),
    ]);
    const { message } = res.body.items[0];
    expect(message).toMatch(/\b500\b/);
    expect(message).toMatch(/\b0 records\b/);
    expect(message).toMatch(/\b5500 ms\b/);

    const alerts = await Alert.find({}).lean();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ api_name: 'AppointmentAPI', status: 'active', severity: 'critical' });
    expect(await Alert.countDocuments({ fingerprint: 'patientdataapi' })).toBe(0);
    expect(client.calls).toBe(1);
  });

  it('spec example without an LLM: template text, still states 500, 0 records and 5500 ms', async () => {
    const { app, warnings } = makeApp();
    const res = await post(app, SPEC_EXAMPLE);

    expect(res.body.llm.status).toBe('disabled');
    expect(res.body.items[0]).toMatchObject({ message_source: 'template', severity: 'critical' });
    expect(res.body.items[0].message).toContain('status 500, returned 0 records and responded in 5500 ms');
    expect(warnings('Alert text fell back to template')).toEqual([
      expect.objectContaining({ api_name: 'AppointmentAPI', reason: 'llm_disabled' }),
    ]);
  });

  it('re-posting touches the alert without an LLM call', async () => {
    const client = echoClient();
    const { app } = makeApp({ client });
    await post(app, SPEC_EXAMPLE);
    const res = await post(app, SPEC_EXAMPLE);

    expect(res.body.alerts).toEqual({ created: 0, escalated: 0, updated: 1, resolved: 0 });
    expect(res.body.llm.status).toBe('skipped');
    expect(client.calls).toBe(1);
    const alerts = await Alert.find({}).lean();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].stats.occurrences).toBe(2);
  });

  it('a healthy AppointmentAPI record resolves the alert', async () => {
    const { app } = makeApp();
    await post(app, SPEC_EXAMPLE);
    const res = await post(app, APPOINTMENT_OK);

    expect(res.body.alerts.resolved).toBe(1);
    expect(res.body.items).toEqual([expect.objectContaining({ action: 'resolved', status: 'resolved' })]);
    expect(await Alert.countDocuments({ status: 'active' })).toBe(0);
  });

  it('falls back to templates after persistent 503 high-demand errors and still returns 200', async () => {
    const client = echoClient({
      fail: () => new ApiError({ status: 503, message: 'This model is currently experiencing high demand.' }),
    });
    const { app, warnings } = makeApp({ client });
    const res = await post(app, SPEC_EXAMPLE);

    expect(res.status).toBe(200);
    expect(res.body.llm).toMatchObject({ status: 'fallback', attempts: 3 });
    expect(res.body.items[0].message_source).toBe('template');
    expect(client.calls).toBe(3);
    expect(warnings('Alert text fell back to template')).toEqual([
      expect.objectContaining({ api_name: 'AppointmentAPI', reason: 'unavailable' }),
    ]);
  });

  it('reports rejected records and processes the rest', async () => {
    const { app } = makeApp();
    const res = await post(app, [...SPEC_EXAMPLE, { response_time_ms: 10 }]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 3, accepted: 2 });
    expect(res.body.rejected).toEqual([{ index: 2, issues: [{ path: 'api_name', message: 'Required' }] }]);
  });

  it('accepts a single observation object', async () => {
    const { app } = makeApp();
    const res = await post(app, SPEC_EXAMPLE[1]);
    expect(res.status).toBe(200);
    expect(res.body.alerts.created).toBe(1);
  });

  it('writes a batch audit record', async () => {
    const { app } = makeApp({ client: echoClient() });
    const res = await request(app).post('/monitor').set('x-request-id', 'trace-42').send(SPEC_EXAMPLE);

    const batch = await Batch.findById(res.body.batch_id).lean();
    expect(batch).toMatchObject({
      source: 'http',
      request_id: 'trace-42',
      received: 2,
      accepted: 2,
      rejected: 0,
      findings: 1,
      alerts: { created: 1, escalated: 0, updated: 0, resolved: 0 },
      llm: { status: 'ok', attempts: 1 },
    });
    const [alert] = await Alert.find({}).lean();
    expect(String(alert.last_batch_id)).toBe(res.body.batch_id);
  });

  it('concurrent posts leave one active alert', async () => {
    const { app } = makeApp();
    await Promise.all([post(app, SPEC_EXAMPLE), post(app, SPEC_EXAMPLE), post(app, SPEC_EXAMPLE)]);
    expect(await Alert.countDocuments({ status: 'active' })).toBe(1);
    const [alert] = await Alert.find({}).lean();
    expect(alert.stats.occurrences).toBe(3);
  });

  describe('errors', () => {
    it.each([
      ['an empty array', [], 'Batch must contain at least one observation'],
      ['a primitive JSON body', '"hello"', null],
    ])('400 for %s', async (_label, body, message) => {
      const { app } = makeApp();
      const res = await request(app).post('/monitor').set('content-type', 'application/json').send(body);
      expect(res.status).toBe(400);
      if (message) expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message });
    });

    it('400 VALIDATION_ERROR when every record is rejected, with per-record details', async () => {
      const { app } = makeApp();
      const res = await post(app, [{ api_name: '' }, { status_code: 200 }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'No valid observations in batch',
      });
      expect(res.body.error.details.map((d) => d.index)).toEqual([0, 1]);
      expect(await Batch.countDocuments({})).toBe(0);
    });

    it('400 when the body is not JSON', async () => {
      const { app } = makeApp();
      const res = await request(app).post('/monitor').set('content-type', 'text/plain').send('hi');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('413 when the batch has more records than MAX_BATCH_SIZE', async () => {
      const { app } = makeApp({ env: { MAX_BATCH_SIZE: '2' } });
      const res = await post(app, [APPOINTMENT_OK, APPOINTMENT_OK, APPOINTMENT_OK]);
      expect(res.status).toBe(413);
      expect(res.body.error).toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        details: { max_batch_size: 2, received: 3 },
      });
    });
  });
});
