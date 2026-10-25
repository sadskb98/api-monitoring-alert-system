// A digit, a comma or whitespace (incl. no-break / narrow no-break space), then a 3-digit group.
const GROUP_SEPARATOR = /(\d)[,\s  ](?=\d{3}(?!\d))/g;
const NUMBER = /\d+(?:\.\d+)?/g;

/** Pure: drop thousands separators so "5,500" and "5 500" read as "5500". */
export function normalizeNumbers(text) {
  return text.replace(GROUP_SEPARATOR, '$1');
}

/** Pure: every number token in the text, after normalization. "15500" does not contain "5500". */
export function numbersIn(text) {
  return new Set(normalizeNumbers(text).match(NUMBER) ?? []);
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Pure: facts the alert message must state, from the finding's evidence.
 *   api_name          always
 *   status_code       when an AVAILABILITY rule fired
 *   response_time_ms  when a LATENCY rule fired
 *   records_returned  whenever a count is known (also on failed requests, e.g. "500 and 0 records")
 */
export function requiredFacts(finding) {
  const categories = new Set(finding.anomalies.map((a) => a.category));
  const { status_code, response_time_ms, records_returned } = finding.evidence;
  const facts = [];
  if (categories.has('AVAILABILITY') && status_code !== null) facts.push(['status_code', status_code]);
  if (categories.has('LATENCY') && response_time_ms !== null) {
    facts.push(['response_time_ms', response_time_ms]);
  }
  if (records_returned !== null) facts.push(['records_returned', records_returned]);
  return facts;
}

/**
 * Pure: does the message state the API name and every required number verbatim?
 * @returns {{ ok: boolean, missing: string[] }} e.g. missing: ['response_time_ms=5500']
 */
export function checkFacts(message, finding) {
  const missing = [];
  if (!collapse(message).includes(collapse(finding.api_name))) missing.push('api_name');
  const numbers = numbersIn(message);
  for (const [field, value] of requiredFacts(finding)) {
    if (!numbers.has(String(value))) missing.push(`${field}=${value}`);
  }
  return { ok: missing.length === 0, missing };
}
