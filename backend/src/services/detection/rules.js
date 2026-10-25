import { compareSeverity } from '../../lib/severity.js';

export const CATEGORIES = Object.freeze(['AVAILABILITY', 'LATENCY', 'DATA']);

/** Catalog of every rule: category, severity and a short description (used by templates/UI). */
export const RULES = Object.freeze({
  HTTP_5XX: { category: 'AVAILABILITY', severity: 'critical', description: 'Server error (5xx)' },
  HTTP_AUTH: {
    category: 'AVAILABILITY',
    severity: 'high',
    description: 'Authentication/authorization failure (401/403)',
  },
  HTTP_RATE_LIMITED: { category: 'AVAILABILITY', severity: 'medium', description: 'Rate limited (429)' },
  HTTP_4XX: { category: 'AVAILABILITY', severity: 'high', description: 'Client error (4xx)' },
  UNEXPECTED_STATUS: {
    category: 'AVAILABILITY',
    severity: 'medium',
    description: 'Unexpected status (1xx/3xx)',
  },
  LATENCY_CRITICAL: {
    category: 'LATENCY',
    severity: 'high',
    description: 'Response time above critical threshold',
  },
  LATENCY_WARNING: {
    category: 'LATENCY',
    severity: 'medium',
    description: 'Response time above warning threshold',
  },
  INVALID_PAYLOAD: {
    category: 'DATA',
    severity: 'high',
    description: 'Malformed or inconsistent response metrics',
  },
  RECORDS_MISSING: {
    category: 'DATA',
    severity: 'high',
    description: 'Successful response without a record count',
  },
  ZERO_RECORDS: {
    category: 'DATA',
    severity: 'medium',
    description: 'Successful response returned zero records',
  },
});

export function anomaly(rule) {
  const { category, severity } = RULES[rule];
  return { rule, category, severity };
}

export const isSuccess = (status) => status !== null && status >= 200 && status <= 299;

/** Pure: AVAILABILITY rule for a status code (mutually exclusive), or null. */
export function availabilityRule(status) {
  if (status === null || isSuccess(status)) return null;
  if (status >= 500) return 'HTTP_5XX';
  if (status === 401 || status === 403) return 'HTTP_AUTH';
  if (status === 429) return 'HTTP_RATE_LIMITED';
  if (status >= 400) return 'HTTP_4XX';
  return 'UNEXPECTED_STATUS'; // 1xx / 3xx
}

/** Pure: LATENCY rule for a response time, or null. Most severe tier wins. */
export function latencyRule(responseTimeMs, { latencyWarningMs, latencyCriticalMs }) {
  if (responseTimeMs === null) return null;
  if (responseTimeMs >= latencyCriticalMs) return 'LATENCY_CRITICAL';
  if (responseTimeMs >= latencyWarningMs) return 'LATENCY_WARNING';
  return null;
}

/**
 * Pure: DATA rule for an observation, or null. Most severe wins.
 * Record-count rules only apply to successful (2xx) responses: zero/missing records
 * on a failed request is a consequence of the failure, not a separate issue
 * (the count is still carried in the observation for the alert text).
 * INVALID_PAYLOAD is not suppressed: malformed metrics are worth knowing about regardless.
 */
export function dataRule({ status_code, records_returned, invalid_fields }) {
  if (invalid_fields.length > 0) return 'INVALID_PAYLOAD';
  if (!isSuccess(status_code)) return null;
  if (records_returned === null) return 'RECORDS_MISSING';
  if (records_returned === 0) return 'ZERO_RECORDS';
  return null;
}

/** Pure: sort anomalies most severe first, then by category order. Stable output for tests/UI. */
export function sortAnomalies(anomalies) {
  return [...anomalies].sort(
    (a, b) =>
      compareSeverity(b.severity, a.severity) ||
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category),
  );
}

/** Pure: all anomalies for one normalized observation (at most one per category). */
export function evaluateObservation(observation, thresholds) {
  const rules = [
    availabilityRule(observation.status_code),
    latencyRule(observation.response_time_ms, thresholds),
    dataRule(observation),
  ].filter(Boolean);
  return sortAnomalies(rules.map(anomaly));
}
