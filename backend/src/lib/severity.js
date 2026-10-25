/** Ordered lowest -> highest. Index is the rank. */
export const SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

export function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  if (rank === -1) throw new TypeError(`Unknown severity: ${severity}`);
  return rank;
}

export function compareSeverity(a, b) {
  return severityRank(a) - severityRank(b);
}

/** Highest severity in the list, or null for an empty list. */
export function maxSeverity(severities) {
  return severities.reduce((max, s) => (max === null || compareSeverity(s, max) > 0 ? s : max), null);
}

export function isAtLeast(severity, minimum) {
  return compareSeverity(severity, minimum) >= 0;
}
