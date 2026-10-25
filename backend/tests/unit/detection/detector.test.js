import { describe, expect, it } from 'vitest';
import { parseBatch } from '../../../src/schemas/observation.schema.js';
import { detect } from '../../../src/services/detection/detector.js';
import { SPEC_EXAMPLE, THRESHOLDS, obs } from '../../fixtures.js';

const t = (iso) => new Date(`2026-10-25T${iso}Z`);

describe('detect', () => {
  it('spec example -> exactly one critical finding for AppointmentAPI; PatientDataAPI healthy', () => {
    const { accepted } = parseBatch(SPEC_EXAMPLE, { maxBatchSize: 10, receivedAt: t('10:00:00') });
    const { findings, healthy } = detect(accepted, THRESHOLDS);

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f).toMatchObject({
      fingerprint: 'appointmentapi',
      api_name: 'AppointmentAPI',
      severity: 'critical',
      anomalies: [
        { rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' },
        { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
      ],
      worst_observation: { status_code: 500, response_time_ms: 5500, records_returned: 0 },
      batch_stats: { records: 1, anomalous_records: 1, healthy_records: 0, max_response_time_ms: 5500 },
    });
    expect(healthy).toEqual([
      {
        fingerprint: 'patientdataapi',
        api_name: 'PatientDataAPI',
        healthy_records: 1,
        last_observation: expect.objectContaining({ status_code: 200, records_returned: 50 }),
      },
    ]);
  });

  it('produces one combined finding per API, merging anomalies across records', () => {
    const { findings } = detect(
      [
        obs({ api_name: 'A', status_code: 503, response_time_ms: 300 }),
        obs({ api_name: 'A', status_code: 200, response_time_ms: 2500, records_returned: 0 }),
        obs({ api_name: 'A', status_code: 200, response_time_ms: 6000 }),
      ],
      THRESHOLDS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].anomalies.map((a) => a.rule)).toEqual([
      'HTTP_5XX',
      'LATENCY_CRITICAL',
      'ZERO_RECORDS',
    ]);
    expect(findings[0].severity).toBe('critical');
  });

  it('keeps only the most severe rule per category across records', () => {
    const { findings } = detect(
      [obs({ api_name: 'A', response_time_ms: 2500 }), obs({ api_name: 'A', response_time_ms: 7000 })],
      THRESHOLDS,
    );
    expect(findings[0].anomalies).toEqual([
      { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
    ]);
  });

  it('groups API names case- and whitespace-insensitively, keeping the first-seen display name', () => {
    const { findings } = detect(
      [
        obs({ api_name: 'Billing API', status_code: 500 }),
        obs({ api_name: 'billing  api', status_code: 500 }),
      ],
      THRESHOLDS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].api_name).toBe('Billing API');
    expect(findings[0].batch_stats.records).toBe(2);
  });

  it('treats an API with mixed healthy/anomalous records as unhealthy (no healthy entry)', () => {
    const { findings, healthy } = detect(
      [obs({ api_name: 'A' }), obs({ api_name: 'A', status_code: 500 }), obs({ api_name: 'A' })],
      THRESHOLDS,
    );
    expect(healthy).toEqual([]);
    expect(findings[0].batch_stats).toMatchObject({ records: 3, anomalous_records: 1, healthy_records: 2 });
  });

  it('counts all healthy records for an all-healthy API and reports the latest one', () => {
    const { findings, healthy } = detect(
      [
        obs({ api_name: 'A', observed_at: t('10:00:00'), response_time_ms: 10 }),
        obs({ api_name: 'A', observed_at: t('10:05:00'), response_time_ms: 20 }),
      ],
      THRESHOLDS,
    );
    expect(findings).toEqual([]);
    expect(healthy[0]).toMatchObject({ healthy_records: 2, last_observation: { response_time_ms: 20 } });
  });

  describe('worst_observation', () => {
    it('is the highest-severity record', () => {
      const { findings } = detect(
        [
          obs({ api_name: 'A', response_time_ms: 9000 }),
          obs({ api_name: 'A', status_code: 500, response_time_ms: 50 }),
        ],
        THRESHOLDS,
      );
      expect(findings[0].worst_observation).toMatchObject({ status_code: 500, response_time_ms: 50 });
    });

    it('breaks severity ties by highest latency, then latest time', () => {
      const tie = detect(
        [
          obs({ api_name: 'A', status_code: 500, response_time_ms: 100 }),
          obs({ api_name: 'A', status_code: 502, response_time_ms: 400 }),
        ],
        THRESHOLDS,
      );
      expect(tie.findings[0].worst_observation.status_code).toBe(502);

      const sameLatency = detect(
        [
          obs({ api_name: 'A', status_code: 500, observed_at: t('10:01:00') }),
          obs({ api_name: 'A', status_code: 503, observed_at: t('10:00:00') }),
        ],
        THRESHOLDS,
      );
      expect(sameLatency.findings[0].worst_observation.status_code).toBe(500);
    });

    it('does not leak internal fields', () => {
      const { findings } = detect([obs({ api_name: 'A', status_code: 500 })], THRESHOLDS);
      expect(Object.keys(findings[0].worst_observation).sort()).toEqual([
        'invalid_fields',
        'observed_at',
        'records_returned',
        'response_time_ms',
        'status_code',
      ]);
    });
  });

  it('computes batch stats ignoring null metrics', () => {
    const { findings } = detect(
      [
        obs({
          api_name: 'A',
          status_code: 500,
          response_time_ms: 300,
          records_returned: 0,
          observed_at: t('10:00:00'),
        }),
        obs({
          api_name: 'A',
          response_time_ms: null,
          records_returned: 7,
          invalid_fields: [{ field: 'response_time_ms', message: 'x' }],
          observed_at: t('10:02:00'),
        }),
      ],
      THRESHOLDS,
    );
    expect(findings[0].batch_stats).toEqual({
      records: 2,
      anomalous_records: 2,
      healthy_records: 0,
      max_response_time_ms: 300,
      min_records_returned: 0,
      first_observed_at: t('10:00:00'),
      last_observed_at: t('10:02:00'),
    });
  });

  describe('evidence', () => {
    it('spec example: the record itself', () => {
      const { findings } = detect(
        [obs({ api_name: 'A', status_code: 500, response_time_ms: 5500, records_returned: 0 })],
        THRESHOLDS,
      );
      expect(findings[0].evidence).toEqual({
        status_code: 500,
        response_time_ms: 5500,
        records_returned: 0,
        invalid_fields: [],
      });
    });

    it('takes each value from the record that triggered its rule, not the worst record', () => {
      const { findings } = detect(
        [
          obs({ api_name: 'A', status_code: 503, response_time_ms: 300, records_returned: 4 }),
          obs({ api_name: 'A', status_code: 200, response_time_ms: 2500, records_returned: 0 }),
          obs({ api_name: 'A', status_code: 200, response_time_ms: 6000 }),
        ],
        THRESHOLDS,
      );
      expect(findings[0].worst_observation).toMatchObject({ status_code: 503, response_time_ms: 300 });
      expect(findings[0].evidence).toEqual({
        status_code: 503,
        response_time_ms: 6000,
        records_returned: 0,
        invalid_fields: [],
      });
    });

    it('uses the latest record when several fired the same rule', () => {
      const { findings } = detect(
        [
          obs({ api_name: 'A', status_code: 500, observed_at: t('10:00:00') }),
          obs({ api_name: 'A', status_code: 502, observed_at: t('10:05:00') }),
        ],
        THRESHOLDS,
      );
      expect(findings[0].evidence.status_code).toBe(502);
    });

    it('carries invalid fields for INVALID_PAYLOAD', () => {
      const invalid_fields = [{ field: 'records_returned', message: 'Expected an integer' }];
      const { findings } = detect(
        [obs({ api_name: 'A', records_returned: null, invalid_fields })],
        THRESHOLDS,
      );
      expect(findings[0].evidence).toMatchObject({ records_returned: null, invalid_fields });
    });

    it('falls back to the worst record for categories without an anomaly', () => {
      const { findings } = detect(
        [obs({ api_name: 'A', status_code: 200, response_time_ms: 2500, records_returned: 9 })],
        THRESHOLDS,
      );
      expect(findings[0].evidence).toMatchObject({ status_code: 200, records_returned: 9 });
    });
  });

  it('sorts findings by severity desc, then api name', () => {
    const { findings } = detect(
      [
        obs({ api_name: 'Zeta', response_time_ms: 2500 }),
        obs({ api_name: 'Beta', status_code: 500 }),
        obs({ api_name: 'Alpha', response_time_ms: 2500 }),
      ],
      THRESHOLDS,
    );
    expect(findings.map((f) => f.api_name)).toEqual(['Beta', 'Alpha', 'Zeta']);
  });

  it('handles an empty observation list', () => {
    expect(detect([], THRESHOLDS)).toEqual({ findings: [], healthy: [] });
  });

  it('is pure: does not mutate its input', () => {
    const input = [obs({ api_name: 'A', status_code: 500 })];
    const snapshot = structuredClone(input);
    detect(input, THRESHOLDS);
    expect(input).toEqual(snapshot);
  });
});
