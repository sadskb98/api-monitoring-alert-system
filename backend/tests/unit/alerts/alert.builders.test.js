import { describe, expect, it } from 'vitest';
import {
  buildCreateDoc,
  buildFindingUpdate,
  buildListFilter,
} from '../../../src/services/alerts/alert.service.js';
import { anomaly } from '../../../src/services/detection/rules.js';

const t = (hhmm) => new Date(`2026-10-25T${hhmm}:00Z`);
const now = t('12:00');
const message = { title: 'T', message: 'M', suggested_action: 'S', message_source: 'llm' };

const finding = {
  fingerprint: 'appointmentapi',
  api_name: 'AppointmentAPI',
  anomalies: [anomaly('HTTP_5XX'), anomaly('LATENCY_CRITICAL')],
  severity: 'critical',
  worst_observation: {
    response_time_ms: 5500,
    status_code: 500,
    records_returned: 0,
    observed_at: t('10:00'),
  },
  batch_stats: {
    records: 2,
    anomalous_records: 2,
    healthy_records: 0,
    max_response_time_ms: 5500,
    min_records_returned: 0,
    first_observed_at: t('10:00'),
    last_observed_at: t('10:05'),
  },
};

describe('buildCreateDoc', () => {
  it('builds a full active alert from a finding and its message', () => {
    const doc = buildCreateDoc(finding, message, { batchId: 'b1', now });
    expect(doc).toMatchObject({
      fingerprint: 'appointmentapi',
      api_name: 'AppointmentAPI',
      seen_rules: ['HTTP_5XX', 'LATENCY_CRITICAL'],
      severity: 'critical',
      severity_rank: 3,
      peak_severity: 'critical',
      status: 'active',
      title: 'T',
      message: 'M',
      suggested_action: 'S',
      message_source: 'llm',
      message_generated_at: now,
      last_observation: finding.worst_observation,
      stats: { occurrences: 2, max_response_time_ms: 5500, min_records_returned: 0 },
      healthy_streak: 0,
      first_seen_at: t('10:00'),
      last_seen_at: t('10:05'),
      last_batch_id: 'b1',
    });
  });
});

describe('buildFindingUpdate', () => {
  const existing = {
    severity: 'high',
    peak_severity: 'critical',
    seen_rules: ['LATENCY_CRITICAL'],
    stats: { max_response_time_ms: 9000, min_records_returned: null },
  };

  it('touch: updates state, keeps the message', () => {
    const u = buildFindingUpdate(existing, finding, { batchId: 'b2', now });
    expect(u.$set).toMatchObject({
      severity: 'critical',
      severity_rank: 3,
      peak_severity: 'critical',
      seen_rules: ['LATENCY_CRITICAL', 'HTTP_5XX'],
      healthy_streak: 0,
      last_batch_id: 'b2',
      'stats.max_response_time_ms': 9000, // keeps the larger value
      'stats.min_records_returned': 0, // null + 0 -> 0
    });
    expect(u.$set).not.toHaveProperty('message');
    expect(u.$inc).toEqual({ 'stats.occurrences': 2 });
    expect(u.$max).toEqual({ last_seen_at: t('10:05') });
  });

  it('escalate: also replaces the message fields', () => {
    const u = buildFindingUpdate(existing, finding, { batchId: 'b2', message, now });
    expect(u.$set).toMatchObject({
      title: 'T',
      message: 'M',
      message_source: 'llm',
      message_generated_at: now,
    });
  });

  it('lets severity go down but never peak_severity', () => {
    const milder = { ...finding, anomalies: [anomaly('LATENCY_WARNING')], severity: 'medium' };
    const u = buildFindingUpdate({ ...existing, severity: 'critical' }, milder, { batchId: 'b3', now });
    expect(u.$set.severity).toBe('medium');
    expect(u.$set.peak_severity).toBe('critical');
  });
});

describe('buildListFilter', () => {
  it('defaults to active alerts', () => {
    expect(buildListFilter({})).toEqual({ status: 'active' });
  });

  it('supports status=all, api name (normalized substring) and rule', () => {
    expect(buildListFilter({ status: 'all', api_name: ' Appointment  API ', rule: 'HTTP_5XX' })).toEqual({
      fingerprint: { $regex: 'appointment api' },
      'anomalies.rule': 'HTTP_5XX',
    });
  });

  it('escapes regex special characters in the api name', () => {
    expect(buildListFilter({ api_name: 'Billing.API (v2)*' }).fingerprint).toEqual({
      $regex: 'billing\\.api \\(v2\\)\\*',
    });
  });
});
