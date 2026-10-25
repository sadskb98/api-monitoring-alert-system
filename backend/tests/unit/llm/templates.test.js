import { describe, expect, it } from 'vitest';
import { RULES } from '../../../src/services/detection/rules.js';
import { checkFacts } from '../../../src/services/llm/factCheck.js';
import { renderTemplate } from '../../../src/services/llm/templates.js';
import { THRESHOLDS, findingOf, specFinding } from '../../fixtures.js';

/** One record that fires each rule (as the top rule of its finding). */
const RECORD_FOR_RULE = {
  HTTP_5XX: { status_code: 503 },
  HTTP_AUTH: { status_code: 401 },
  HTTP_RATE_LIMITED: { status_code: 429 },
  HTTP_4XX: { status_code: 404 },
  UNEXPECTED_STATUS: { status_code: 302 },
  LATENCY_CRITICAL: { response_time_ms: 12000 },
  LATENCY_WARNING: { response_time_ms: 2500 },
  INVALID_PAYLOAD: { response_time_ms: 120, records_returned: 'many' },
  RECORDS_MISSING: { records_returned: null },
  ZERO_RECORDS: { records_returned: 0 },
};

function findingFor(rule) {
  const record = { ...RECORD_FOR_RULE[rule] };
  if (rule === 'INVALID_PAYLOAD') {
    // parseObservation would null the bad field and record why
    record.records_returned = null;
    record.invalid_fields = [{ field: 'records_returned', message: 'Expected an integer' }];
  }
  return findingOf({ api_name: 'BillingAPI', ...record });
}

describe('renderTemplate', () => {
  it('spec example: states 500, 0 records and 5500 ms', () => {
    expect(renderTemplate(specFinding(), THRESHOLDS)).toEqual({
      title: 'AppointmentAPI: server errors, critical latency',
      message:
        'AppointmentAPI failed with server error status 500, returned 0 records and responded in 5500 ms ' +
        '(critical threshold 5000 ms). Possible outage; dependent features are likely failing.',
      suggested_action:
        'Check service logs and recent deployments; roll back or fail over if errors persist.',
      message_source: 'template',
    });
  });

  it.each(Object.keys(RULES))('covers %s and passes the fact-check', (rule) => {
    const finding = findingFor(rule);
    expect(finding.anomalies[0].rule).toBe(rule);
    const t = renderTemplate(finding, THRESHOLDS);
    expect(t.title.length).toBeLessThanOrEqual(70);
    expect(t.message).toContain('BillingAPI');
    expect(t.suggested_action).toEqual(expect.any(String));
    expect(checkFacts(t.message, finding)).toEqual({ ok: true, missing: [] });
  });

  it('writes numbers as plain digits', () => {
    const t = renderTemplate(findingOf({ response_time_ms: 12000, records_returned: 1500 }), THRESHOLDS);
    expect(t.message).toContain('12000 ms');
    expect(t.message).toContain('1500 records');
    expect(t.message).not.toMatch(/\d,\d{3}/);
  });

  it('mentions the warning threshold for LATENCY_WARNING', () => {
    expect(renderTemplate(findingFor('LATENCY_WARNING'), THRESHOLDS).message).toContain(
      'responded in 2500 ms (warning threshold 2000 ms)',
    );
  });

  it('lists invalid fields for INVALID_PAYLOAD', () => {
    expect(renderTemplate(findingFor('INVALID_PAYLOAD'), THRESHOLDS).message).toContain(
      'reported malformed metrics (records_returned: Expected an integer)',
    );
  });

  it('reports how many records were anomalous in a multi-record batch', () => {
    const f = findingOf(
      { api_name: 'A', status_code: 503 },
      { api_name: 'A' },
      { api_name: 'A', status_code: 500 },
    );
    expect(renderTemplate(f, THRESHOLDS).message).toContain('2 of 3 records in this batch were anomalous.');
  });

  it('uses singular "record" for one', () => {
    expect(renderTemplate(findingOf({ status_code: 500, records_returned: 1 }), THRESHOLDS).message).toMatch(
      /returned 1 record\b(?!s)/,
    );
  });

  it('truncates long titles to 70 characters', () => {
    const f = findingOf({
      api_name: 'A'.repeat(60),
      status_code: 503,
      response_time_ms: 9000,
    });
    const { title } = renderTemplate(f, THRESHOLDS);
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title.length).toBeGreaterThan(60);
    expect(title.endsWith('…')).toBe(true);
  });
});
