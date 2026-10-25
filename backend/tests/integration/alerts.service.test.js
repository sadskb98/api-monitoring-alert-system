import { describe, expect, it } from 'vitest';
import { Alert } from '../../src/models/Alert.js';
import { parseBatch } from '../../src/schemas/observation.schema.js';
import {
  applyPlan,
  findActiveByFingerprints,
  resolveAlert,
} from '../../src/services/alerts/alert.service.js';
import { needsMessage, planBatch } from '../../src/services/alerts/dedup.js';
import { detect } from '../../src/services/detection/detector.js';
import { useTestDb } from '../db.js';
import { SPEC_EXAMPLE, THRESHOLDS } from '../fixtures.js';
import { runBatch, stubMessages } from '../pipeline.js';

useTestDb();

const APPOINTMENT_FAIL = SPEC_EXAMPLE[1];
const APPOINTMENT_OK = {
  api_name: 'AppointmentAPI',
  response_time_ms: 300,
  status_code: 200,
  records_returned: 12,
};
const t = (hhmm) => new Date(`2026-10-25T${hhmm}:00Z`);

describe('alert lifecycle (applyPlan against MongoDB)', () => {
  it('spec example creates exactly one critical active alert for AppointmentAPI', async () => {
    const { result } = await runBatch(SPEC_EXAMPLE, { now: t('10:00') });

    expect(result.created).toHaveLength(1);
    const docs = await Alert.find({}).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      fingerprint: 'appointmentapi',
      api_name: 'AppointmentAPI',
      status: 'active',
      severity: 'critical',
      severity_rank: 3,
      seen_rules: ['HTTP_5XX', 'LATENCY_CRITICAL'],
      last_observation: { status_code: 500, response_time_ms: 5500, records_returned: 0 },
      stats: { occurrences: 1, max_response_time_ms: 5500, min_records_returned: 0 },
      message_source: 'template',
    });
  });

  it('re-posting the same data touches the alert: occurrences 2, no new document, message kept', async () => {
    await runBatch(SPEC_EXAMPLE, { now: t('10:00'), tag: 'first' });
    const { plan, result } = await runBatch(SPEC_EXAMPLE, { now: t('10:05'), tag: 'second' });

    expect(needsMessage(plan)).toEqual([]); // no LLM call would be made
    expect(result.updated).toHaveLength(1);
    const docs = await Alert.find({}).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].stats.occurrences).toBe(2);
    expect(docs[0].message).toContain('(first)');
    expect(docs[0].last_seen_at).toEqual(t('10:05'));
  });

  it('escalates on a new rule and regenerates the message', async () => {
    await runBatch([{ ...APPOINTMENT_FAIL, response_time_ms: 100 }], { now: t('10:00'), tag: 'first' });
    const { result } = await runBatch([APPOINTMENT_FAIL], { now: t('10:05'), tag: 'second' });

    expect(result.escalated).toHaveLength(1);
    const [doc] = await Alert.find({}).lean();
    expect(doc.seen_rules).toEqual(['HTTP_5XX', 'LATENCY_CRITICAL']);
    expect(doc.message).toContain('(second)');
    expect(doc.message_generated_at).toEqual(t('10:05'));
  });

  it('escalates on a severity increase', async () => {
    await runBatch([{ ...APPOINTMENT_OK, records_returned: 0 }], { now: t('10:00') }); // ZERO_RECORDS medium
    const { result } = await runBatch([APPOINTMENT_FAIL], { now: t('10:05') });

    expect(result.escalated).toHaveLength(1);
    const [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ severity: 'critical', peak_severity: 'critical' });
  });

  it('lets severity drop on a touch while peak_severity stays', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });
    const { result } = await runBatch([{ ...APPOINTMENT_OK, response_time_ms: 6000 }], { now: t('10:05') });

    expect(result.updated).toHaveLength(1);
    const [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ severity: 'high', severity_rank: 2, peak_severity: 'critical' });
    expect(doc.anomalies.map((a) => a.rule)).toEqual(['LATENCY_CRITICAL']);
  });

  it('does not escalate on a same-category downgrade (LATENCY_CRITICAL -> LATENCY_WARNING)', async () => {
    await runBatch([{ ...APPOINTMENT_OK, response_time_ms: 6000 }], { now: t('10:00'), tag: 'first' });
    const { plan, result } = await runBatch([{ ...APPOINTMENT_OK, response_time_ms: 2500 }], {
      now: t('10:05'),
      tag: 'second',
    });

    expect(needsMessage(plan)).toEqual([]);
    expect(result.escalated).toEqual([]);
    expect(result.updated).toHaveLength(1);
    const [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({
      severity: 'medium',
      peak_severity: 'high',
      seen_rules: ['LATENCY_CRITICAL', 'LATENCY_WARNING'], // every rule seen since opening
      message_generated_at: t('10:00'),
    });
    expect(doc.anomalies.map((a) => a.rule)).toEqual(['LATENCY_WARNING']);
    expect(doc.message).toContain('(first)');
  });

  it('auto-resolves on a fully healthy observation', async () => {
    await runBatch(SPEC_EXAMPLE, { now: t('10:00') });
    const { result } = await runBatch([APPOINTMENT_OK], { now: t('10:05') });

    expect(result.resolved).toHaveLength(1);
    const [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ status: 'resolved', resolved_by: 'auto', resolved_at: t('10:05') });
  });

  it('does not resolve on a mixed batch', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });
    const { result } = await runBatch([APPOINTMENT_OK, APPOINTMENT_FAIL], { now: t('10:05') });

    expect(result.resolved).toEqual([]);
    expect(await Alert.countDocuments({ status: 'active' })).toBe(1);
  });

  it('a mixed batch does not advance the healthy streak; it resets it (threshold > 1)', async () => {
    const opts = (hhmm) => ({ now: t(hhmm), resolveAfterHealthy: 3 });
    await runBatch([APPOINTMENT_FAIL], opts('10:00'));
    await runBatch([APPOINTMENT_OK], opts('10:01'));
    let [doc] = await Alert.find({}).lean();
    expect(doc.healthy_streak).toBe(1);

    // 2 healthy + 1 failing record: advancing would reach 1 + 2 = 3 and resolve
    const { result } = await runBatch([APPOINTMENT_OK, APPOINTMENT_OK, APPOINTMENT_FAIL], opts('10:02'));

    expect(result.resolved).toEqual([]);
    expect(result.healthy).toEqual([]);
    [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ status: 'active', healthy_streak: 0 });
  });

  it('respects ALERT_RESOLVE_AFTER_HEALTHY across batches', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00'), resolveAfterHealthy: 2 });
    await runBatch([APPOINTMENT_OK], { now: t('10:01'), resolveAfterHealthy: 2 });
    let [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ status: 'active', healthy_streak: 1 });

    await runBatch([APPOINTMENT_OK], { now: t('10:02'), resolveAfterHealthy: 2 });
    [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ status: 'resolved', healthy_streak: 2 });
  });

  it('a recurrence resets the healthy streak', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00'), resolveAfterHealthy: 2 });
    await runBatch([APPOINTMENT_OK], { now: t('10:01'), resolveAfterHealthy: 2 });
    await runBatch([APPOINTMENT_FAIL], { now: t('10:02'), resolveAfterHealthy: 2 });
    const [doc] = await Alert.find({}).lean();
    expect(doc).toMatchObject({ status: 'active', healthy_streak: 0 });
  });

  it('a recurrence after resolution opens a new alert and keeps history', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });
    await runBatch([APPOINTMENT_OK], { now: t('10:05') });
    const { result } = await runBatch([APPOINTMENT_FAIL], { now: t('10:10') });

    expect(result.created).toHaveLength(1);
    expect(await Alert.countDocuments({ status: 'resolved' })).toBe(1);
    expect(await Alert.countDocuments({ status: 'active' })).toBe(1);
  });

  it('does not touch alerts for APIs absent from the batch', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });
    await runBatch([SPEC_EXAMPLE[0]], { now: t('10:05') }); // only PatientDataAPI (healthy)
    const [doc] = await Alert.find({ fingerprint: 'appointmentapi' }).lean();
    expect(doc).toMatchObject({ status: 'active', healthy_streak: 0, last_seen_at: t('10:00') });
  });

  it('enforces at most one active alert per fingerprint at the DB level', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });
    const [doc] = await Alert.find({}).lean();
    const { _id: _ignored, ...copy } = doc;
    await expect(Alert.create(copy)).rejects.toMatchObject({ code: 11000 });
  });

  describe('concurrent batches (create race)', () => {
    async function planFor(records, now) {
      const { accepted } = parseBatch(records, { maxBatchSize: 1000, receivedAt: now });
      const { findings, healthy } = detect(accepted, THRESHOLDS);
      const plan = planBatch({ findings, healthy, activeAlerts: [], resolveAfterHealthy: 1 });
      return { plan, messages: stubMessages(findings) };
    }

    it('two batches creating the same alert concurrently leave one active alert with both counted', async () => {
      const a = await planFor([APPOINTMENT_FAIL], t('10:00'));
      const b = await planFor([APPOINTMENT_FAIL], t('10:00'));

      const results = await Promise.all([applyPlan(a.plan, a), applyPlan(b.plan, b)]);

      expect(await Alert.countDocuments({ status: 'active' })).toBe(1);
      const [doc] = await Alert.find({}).lean();
      expect(doc.stats.occurrences).toBe(2);
      const created = results.flatMap((r) => r.created);
      const updated = results.flatMap((r) => [...r.updated, ...r.escalated]);
      expect(created).toHaveLength(1);
      expect(updated).toHaveLength(1);
    });

    it('a stale create plan (alert already exists) becomes a touch', async () => {
      const stale = await planFor([APPOINTMENT_FAIL], t('10:00'));
      await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });

      const result = await applyPlan(stale.plan, stale);
      expect(result.created).toEqual([]);
      expect(result.updated).toHaveLength(1);
      expect(await Alert.countDocuments({})).toBe(1);
    });

    it('a stale create plan with worse news escalates the existing alert', async () => {
      const stale = await planFor([APPOINTMENT_FAIL], t('10:00')); // critical
      await runBatch([{ ...APPOINTMENT_OK, records_returned: 0 }], { now: t('10:00') }); // medium

      const result = await applyPlan(stale.plan, stale);
      expect(result.escalated).toHaveLength(1);
      const [doc] = await Alert.find({}).lean();
      expect(doc.severity).toBe('critical');
    });
  });

  it('findActiveByFingerprints only returns active alerts', async () => {
    await runBatch([APPOINTMENT_FAIL], { now: t('10:00') });
    const [doc] = await Alert.find({}).lean();
    await resolveAlert(doc._id);
    expect(await findActiveByFingerprints(['appointmentapi'])).toEqual([]);
  });

  it('applyPlan rejects a create without a message', async () => {
    const { accepted } = parseBatch([APPOINTMENT_FAIL], { maxBatchSize: 10 });
    const { findings } = detect(accepted, THRESHOLDS);
    const plan = planBatch({ findings, healthy: [], activeAlerts: [], resolveAfterHealthy: 1 });
    await expect(applyPlan(plan, { messages: new Map() })).rejects.toThrow(/No alert message/);
  });
});
