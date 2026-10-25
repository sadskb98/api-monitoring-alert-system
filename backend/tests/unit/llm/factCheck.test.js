import { describe, expect, it } from 'vitest';
import {
  checkFacts,
  normalizeNumbers,
  numbersIn,
  requiredFacts,
} from '../../../src/services/llm/factCheck.js';
import { findingOf, specFinding } from '../../fixtures.js';

describe('normalizeNumbers', () => {
  it.each([
    ['5,500 ms', '5500 ms'],
    ['5 500 ms', '5500 ms'],
    ['5 500 ms', '5500 ms'],
    ['5 500 ms', '5500 ms'],
    ['1,234,567 records', '1234567 records'],
    ['5,500ms', '5500ms'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeNumbers(input)).toBe(expected);
  });

  it('leaves list punctuation and short groups alone', () => {
    expect(normalizeNumbers('status 500, 0 records')).toBe('status 500, 0 records');
    expect(normalizeNumbers('status 500, 200 records')).toBe('status 500, 200 records');
    expect(normalizeNumbers('5,50 ms')).toBe('5,50 ms');
    expect(normalizeNumbers('5,5000 ms')).toBe('5,5000 ms');
  });
});

describe('numbersIn', () => {
  it('extracts whole number tokens, so 15500 does not count as 5500', () => {
    expect([...numbersIn('took 15500 ms')]).toEqual(['15500']);
  });

  it('keeps decimals as one token, so 5.5 seconds does not count as 5500', () => {
    expect([...numbersIn('5.5 seconds')]).toEqual(['5.5']);
  });
});

describe('requiredFacts', () => {
  it('spec example: status, latency and records', () => {
    expect(requiredFacts(specFinding())).toEqual([
      ['status_code', 500],
      ['response_time_ms', 5500],
      ['records_returned', 0],
    ]);
  });

  it('latency only when a LATENCY rule fired; status only when AVAILABILITY fired', () => {
    expect(requiredFacts(findingOf({ records_returned: 0, response_time_ms: 300 }))).toEqual([
      ['records_returned', 0],
    ]);
  });

  it('no record count when it is missing', () => {
    expect(requiredFacts(findingOf({ records_returned: null }))).toEqual([]);
  });

  it('uses the values that triggered each rule, not just the worst record', () => {
    const f = findingOf(
      { api_name: 'A', status_code: 429, response_time_ms: 100, records_returned: 3 },
      { api_name: 'A', status_code: 200, response_time_ms: 6000, records_returned: 8 },
    );
    expect(requiredFacts(f)).toEqual([
      ['status_code', 429],
      ['response_time_ms', 6000],
      ['records_returned', 8],
    ]);
  });
});

describe('checkFacts', () => {
  const good = 'AppointmentAPI returned status 500 with 0 records after 5500 ms.';

  it('passes when the name and every number are present', () => {
    expect(checkFacts(good, specFinding())).toEqual({ ok: true, missing: [] });
  });

  it('accepts thousands separators after normalization', () => {
    const text = 'AppointmentAPI returned status 500 with 0 records after 5,500 ms.';
    expect(checkFacts(text, specFinding()).ok).toBe(true);
    expect(checkFacts(text.replace('5,500', '5 500'), specFinding()).ok).toBe(true);
  });

  it('rejects unit conversion', () => {
    const text = 'AppointmentAPI returned status 500 with 0 records after 5.5 seconds.';
    expect(checkFacts(text, specFinding())).toEqual({ ok: false, missing: ['response_time_ms=5500'] });
  });

  it('rejects a missing record count and a missing status', () => {
    const text = 'AppointmentAPI failed and took 5500 ms.';
    expect(checkFacts(text, specFinding()).missing).toEqual(['status_code=500', 'records_returned=0']);
  });

  it('requires the API name (case and whitespace insensitive)', () => {
    expect(checkFacts(good.replace('AppointmentAPI', 'The API'), specFinding()).missing).toEqual([
      'api_name',
    ]);
    expect(checkFacts(good.replace('AppointmentAPI', 'appointmentapi'), specFinding()).ok).toBe(true);
  });
});
