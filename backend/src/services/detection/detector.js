import { compareSeverity, maxSeverity } from '../../lib/severity.js';
import { evaluateObservation, sortAnomalies } from './rules.js';

/** Pure: keep the most severe anomaly per category across many records. */
function mergeAnomalies(lists) {
  const byCategory = new Map();
  for (const a of lists.flat()) {
    const current = byCategory.get(a.category);
    if (!current || compareSeverity(a.severity, current.severity) > 0) byCategory.set(a.category, a);
  }
  return sortAnomalies([...byCategory.values()]);
}

/** Pure: worst record = highest severity; ties -> slowest; then latest. */
function pickWorst(evaluated) {
  return evaluated.reduce((worst, cur) => {
    const bySeverity = compareSeverity(cur.severity, worst.severity);
    if (bySeverity !== 0) return bySeverity > 0 ? cur : worst;
    const byLatency = (cur.observation.response_time_ms ?? -1) - (worst.observation.response_time_ms ?? -1);
    if (byLatency !== 0) return byLatency > 0 ? cur : worst;
    return cur.observation.observed_at >= worst.observation.observed_at ? cur : worst;
  });
}

const minOrNull = (values) => (values.length ? Math.min(...values) : null);
const maxOrNull = (values) => (values.length ? Math.max(...values) : null);

/** Public projection of an observation (drops internal bookkeeping like index). */
export function toObservationSummary(o) {
  return {
    response_time_ms: o.response_time_ms,
    status_code: o.status_code,
    records_returned: o.records_returned,
    observed_at: o.observed_at,
    invalid_fields: o.invalid_fields,
  };
}

function latest(observations) {
  return observations.reduce((a, b) => (b.observed_at >= a.observed_at ? b : a));
}

function batchStats(observations, anomalousCount) {
  const latencies = observations.map((o) => o.response_time_ms).filter((v) => v !== null);
  const records = observations.map((o) => o.records_returned).filter((v) => v !== null);
  const times = observations.map((o) => o.observed_at.getTime());
  return {
    records: observations.length,
    anomalous_records: anomalousCount,
    healthy_records: observations.length - anomalousCount,
    max_response_time_ms: maxOrNull(latencies),
    min_records_returned: minOrNull(records),
    first_observed_at: new Date(Math.min(...times)),
    last_observed_at: new Date(Math.max(...times)),
  };
}

/** Pure: group observations by API fingerprint, preserving first-seen order. */
export function groupByApi(observations) {
  const groups = new Map();
  for (const o of observations) {
    if (!groups.has(o.fingerprint)) groups.set(o.fingerprint, { api_name: o.api_name, observations: [] });
    groups.get(o.fingerprint).observations.push(o);
  }
  return groups;
}

/**
 * Pure: turn a batch of normalized observations into
 *   findings: one combined finding per API that had any anomalous record
 *   healthy:  APIs whose records in this batch were all anomaly-free (used for auto-resolve)
 * An API with mixed records counts as unhealthy for the batch.
 */
export function detect(observations, thresholds) {
  const findings = [];
  const healthy = [];

  for (const [fingerprint, { api_name, observations: group }] of groupByApi(observations)) {
    const evaluated = group.map((observation) => {
      const anomalies = evaluateObservation(observation, thresholds);
      return { observation, anomalies, severity: maxSeverity(anomalies.map((a) => a.severity)) };
    });
    const anomalous = evaluated.filter((e) => e.anomalies.length > 0);

    if (anomalous.length === 0) {
      healthy.push({
        fingerprint,
        api_name,
        healthy_records: group.length,
        last_observation: toObservationSummary(latest(group)),
      });
      continue;
    }

    const anomalies = mergeAnomalies(anomalous.map((e) => e.anomalies));
    findings.push({
      fingerprint,
      api_name,
      anomalies,
      severity: maxSeverity(anomalies.map((a) => a.severity)),
      worst_observation: toObservationSummary(pickWorst(anomalous).observation),
      batch_stats: batchStats(group, anomalous.length),
    });
  }

  findings.sort((a, b) => compareSeverity(b.severity, a.severity) || a.api_name.localeCompare(b.api_name));
  return { findings, healthy };
}
