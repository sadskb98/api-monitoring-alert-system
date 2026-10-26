/** Mirror of the backend rule catalog (backend/src/services/detection/rules.js), for labels and tooltips. */
export const RULES = Object.freeze({
  HTTP_5XX: { category: 'AVAILABILITY', description: 'Server error (5xx)' },
  HTTP_AUTH: { category: 'AVAILABILITY', description: 'Authentication/authorization failure (401/403)' },
  HTTP_RATE_LIMITED: { category: 'AVAILABILITY', description: 'Rate limited (429)' },
  HTTP_4XX: { category: 'AVAILABILITY', description: 'Client error (4xx)' },
  UNEXPECTED_STATUS: { category: 'AVAILABILITY', description: 'Unexpected status (1xx/3xx)' },
  LATENCY_CRITICAL: { category: 'LATENCY', description: 'Response time above critical threshold' },
  LATENCY_WARNING: { category: 'LATENCY', description: 'Response time above warning threshold' },
  INVALID_PAYLOAD: { category: 'DATA', description: 'Malformed or inconsistent response metrics' },
  RECORDS_MISSING: { category: 'DATA', description: 'Successful response without a record count' },
  ZERO_RECORDS: { category: 'DATA', description: 'Successful response returned zero records' },
});

export const RULE_NAMES = Object.freeze(Object.keys(RULES));

export const ruleDescription = (rule) => RULES[rule]?.description ?? rule;
