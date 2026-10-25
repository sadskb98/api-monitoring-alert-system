const TITLE_MAX = 70;

const AVAILABILITY = {
  HTTP_5XX: (s) => `failed with server error status ${s}`,
  HTTP_AUTH: (s) => `was refused with status ${s} (authentication/authorization failure)`,
  HTTP_RATE_LIMITED: (s) => `was rate limited with status ${s}`,
  HTTP_4XX: (s) => `failed with client error status ${s}`,
  UNEXPECTED_STATUS: (s) => `returned unexpected status ${s}`,
};

const TITLE_LABELS = {
  HTTP_5XX: 'server errors',
  HTTP_AUTH: 'auth failures',
  HTTP_RATE_LIMITED: 'rate limited',
  HTTP_4XX: 'client errors',
  UNEXPECTED_STATUS: 'unexpected status',
  LATENCY_CRITICAL: 'critical latency',
  LATENCY_WARNING: 'high latency',
  INVALID_PAYLOAD: 'malformed metrics',
  RECORDS_MISSING: 'missing record count',
  ZERO_RECORDS: 'zero records',
};

const IMPACT = {
  HTTP_5XX: 'Possible outage; dependent features are likely failing.',
  HTTP_AUTH: 'Callers are likely blocked by expired or misconfigured credentials.',
  HTTP_RATE_LIMITED: 'Requests are being throttled; users may see delays or failures.',
  HTTP_4XX: 'Requests are likely malformed or hitting a changed contract.',
  UNEXPECTED_STATUS: 'Possible misrouting or an unexpected redirect.',
  LATENCY_CRITICAL: 'Users are likely seeing timeouts or very slow pages.',
  LATENCY_WARNING: 'Users may notice slower responses.',
  INVALID_PAYLOAD: 'The monitoring data is unreliable for this API.',
  RECORDS_MISSING: 'Possible data issue: the response did not report how many records it returned.',
  ZERO_RECORDS: 'Possible data issue: a successful call returned no data.',
};

const ACTIONS = {
  HTTP_5XX: 'Check service logs and recent deployments; roll back or fail over if errors persist.',
  HTTP_AUTH: 'Verify the API credentials, tokens and permission changes.',
  HTTP_RATE_LIMITED: 'Review request volume and rate-limit quotas; add backoff if needed.',
  HTTP_4XX: 'Check recent client changes and the request contract for this API.',
  UNEXPECTED_STATUS: 'Check routing, redirects and gateway configuration for this API.',
  LATENCY_CRITICAL: 'Check upstream dependencies, database load and resource saturation.',
  LATENCY_WARNING: 'Watch latency trends and check for slow queries or dependencies.',
  INVALID_PAYLOAD: 'Check the monitoring agent or the API response format for this API.',
  RECORDS_MISSING: 'Verify the API response includes a record count and check the data source.',
  ZERO_RECORDS: 'Verify the data source and any filters or recent data migrations.',
};

const records = (n) => `${n} ${n === 1 ? 'record' : 'records'}`;

function joinClauses(clauses) {
  if (clauses.length <= 1) return clauses.join('');
  return `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`;
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Pure: one clause per fact, numbers as plain digits exactly as observed. */
export function factClauses(finding, thresholds) {
  const rule = Object.fromEntries(finding.anomalies.map((a) => [a.category, a.rule]));
  const ev = finding.evidence;
  const clauses = [];

  if (rule.AVAILABILITY) clauses.push(AVAILABILITY[rule.AVAILABILITY](ev.status_code));

  if (rule.DATA === 'RECORDS_MISSING') clauses.push('returned no record count');
  else if (ev.records_returned !== null) clauses.push(`returned ${records(ev.records_returned)}`);
  if (rule.DATA === 'INVALID_PAYLOAD') {
    const fields = ev.invalid_fields.map((f) => `${f.field}: ${f.message}`).join('; ');
    clauses.push(`reported malformed metrics (${fields})`);
  }

  if (rule.LATENCY) {
    const critical = rule.LATENCY === 'LATENCY_CRITICAL';
    const threshold = critical ? thresholds.latencyCriticalMs : thresholds.latencyWarningMs;
    clauses.push(
      `responded in ${ev.response_time_ms} ms (${critical ? 'critical' : 'warning'} threshold ${threshold} ms)`,
    );
  }
  return clauses;
}

/**
 * Pure: deterministic alert text composed from the finding's anomalies.
 * Always states the facts the LLM output is checked against, so it passes the same fact-check.
 */
export function renderTemplate(finding, thresholds) {
  const top = finding.anomalies[0].rule; // anomalies are sorted most severe first
  const { records: total, anomalous_records: anomalous } = finding.batch_stats;

  const sentences = [`${finding.api_name} ${joinClauses(factClauses(finding, thresholds))}.`];
  if (total > 1) sentences.push(`${anomalous} of ${total} records in this batch were anomalous.`);
  sentences.push(IMPACT[top]);

  return {
    title: truncate(
      `${finding.api_name}: ${finding.anomalies.map((a) => TITLE_LABELS[a.rule]).join(', ')}`,
      TITLE_MAX,
    ),
    message: sentences.join(' '),
    suggested_action: ACTIONS[top],
    message_source: 'template',
  };
}
