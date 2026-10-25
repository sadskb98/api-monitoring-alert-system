import { describe, expect, it } from 'vitest';
import {
  RULES,
  availabilityRule,
  dataRule,
  evaluateObservation,
  latencyRule,
} from '../../../src/services/detection/rules.js';
import { THRESHOLDS, obs } from '../../fixtures.js';

describe('availabilityRule', () => {
  it.each([
    [199, 'UNEXPECTED_STATUS'],
    [200, null],
    [204, null],
    [299, null],
    [300, 'UNEXPECTED_STATUS'],
    [304, 'UNEXPECTED_STATUS'],
    [399, 'UNEXPECTED_STATUS'],
    [400, 'HTTP_4XX'],
    [401, 'HTTP_AUTH'],
    [403, 'HTTP_AUTH'],
    [404, 'HTTP_4XX'],
    [429, 'HTTP_RATE_LIMITED'],
    [499, 'HTTP_4XX'],
    [500, 'HTTP_5XX'],
    [503, 'HTTP_5XX'],
    [599, 'HTTP_5XX'],
    [null, null],
  ])('status %s -> %s', (status, expected) => {
    expect(availabilityRule(status)).toBe(expected);
  });
});

describe('latencyRule', () => {
  it.each([
    [0, null],
    [1999, null],
    [2000, 'LATENCY_WARNING'],
    [4999, 'LATENCY_WARNING'],
    [5000, 'LATENCY_CRITICAL'],
    [5500, 'LATENCY_CRITICAL'],
    [null, null],
  ])('%s ms -> %s', (ms, expected) => {
    expect(latencyRule(ms, THRESHOLDS)).toBe(expected);
  });

  it('uses configured thresholds', () => {
    const t = { latencyWarningMs: 100, latencyCriticalMs: 300 };
    expect(latencyRule(150, t)).toBe('LATENCY_WARNING');
    expect(latencyRule(300, t)).toBe('LATENCY_CRITICAL');
  });
});

describe('dataRule', () => {
  it('flags zero records on success', () => {
    expect(dataRule(obs({ records_returned: 0 }))).toBe('ZERO_RECORDS');
  });

  it('flags missing records on success', () => {
    expect(dataRule(obs({ records_returned: null }))).toBe('RECORDS_MISSING');
  });

  it('accepts a positive record count', () => {
    expect(dataRule(obs({ records_returned: 1 }))).toBeNull();
  });

  it.each([500, 404, 302])('suppresses record-count rules when status is %s', (status_code) => {
    expect(dataRule(obs({ status_code, records_returned: 0 }))).toBeNull();
    expect(dataRule(obs({ status_code, records_returned: null }))).toBeNull();
  });

  it('flags INVALID_PAYLOAD, even on failed requests, and it wins over record-count rules', () => {
    const invalid_fields = [{ field: 'response_time_ms', message: 'x' }];
    expect(dataRule(obs({ invalid_fields, records_returned: 0 }))).toBe('INVALID_PAYLOAD');
    expect(dataRule(obs({ invalid_fields, status_code: 500 }))).toBe('INVALID_PAYLOAD');
  });

  it('does not flag RECORDS_MISSING when records_returned was invalid (INVALID_PAYLOAD covers it)', () => {
    const o = obs({ records_returned: null, invalid_fields: [{ field: 'records_returned', message: 'x' }] });
    expect(dataRule(o)).toBe('INVALID_PAYLOAD');
  });

  it('skips record-count rules when the status itself is invalid', () => {
    const o = obs({
      status_code: null,
      records_returned: 0,
      invalid_fields: [{ field: 'status_code', message: 'x' }],
    });
    expect(dataRule(o)).toBe('INVALID_PAYLOAD');
  });
});

describe('evaluateObservation', () => {
  it('returns nothing for a healthy record', () => {
    expect(evaluateObservation(obs(), THRESHOLDS)).toEqual([]);
  });

  it('spec example: 500 + 5500 ms + 0 records -> HTTP_5XX + LATENCY_CRITICAL, DATA suppressed', () => {
    const anomalies = evaluateObservation(
      obs({ status_code: 500, response_time_ms: 5500, records_returned: 0 }),
      THRESHOLDS,
    );
    expect(anomalies).toEqual([
      { rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' },
      { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
    ]);
  });

  it('combines latency and data anomalies on success, most severe first', () => {
    const anomalies = evaluateObservation(
      obs({ response_time_ms: 2500, records_returned: null }),
      THRESHOLDS,
    );
    expect(anomalies.map((a) => a.rule)).toEqual(['RECORDS_MISSING', 'LATENCY_WARNING']);
  });

  it('orders same-severity anomalies by category', () => {
    const anomalies = evaluateObservation(obs({ response_time_ms: 2500, records_returned: 0 }), THRESHOLDS);
    expect(anomalies.map((a) => a.rule)).toEqual(['LATENCY_WARNING', 'ZERO_RECORDS']);
  });

  it('emits at most one anomaly per category', () => {
    const anomalies = evaluateObservation(
      obs({
        status_code: 503,
        response_time_ms: 9000,
        invalid_fields: [{ field: 'records_returned', message: 'x' }],
      }),
      THRESHOLDS,
    );
    const categories = anomalies.map((a) => a.category);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe('RULES catalog', () => {
  it('assigns every rule a known category and severity', () => {
    for (const def of Object.values(RULES)) {
      expect(['AVAILABILITY', 'LATENCY', 'DATA']).toContain(def.category);
      expect(['low', 'medium', 'high', 'critical']).toContain(def.severity);
    }
  });
});
