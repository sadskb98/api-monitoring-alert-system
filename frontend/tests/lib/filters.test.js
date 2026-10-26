import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  hasNarrowingFilters,
  parseFilters,
  serializeFilters,
  toAlertsQuery,
  toggleSeverity,
  updateFilters,
} from '../../src/lib/filters.js';

describe('parseFilters', () => {
  it('returns the defaults for an empty query', () => {
    expect(parseFilters('')).toEqual(DEFAULT_FILTERS);
  });

  it('reads every filter from the URL', () => {
    expect(
      parseFilters(
        '?status=resolved&severity=high,critical&api=AppointmentAPI&rule=HTTP_5XX&sort=last_seen&page=3',
      ),
    ).toEqual({
      status: 'resolved',
      severity: ['critical', 'high'],
      api: 'AppointmentAPI',
      rule: 'HTTP_5XX',
      sort: 'last_seen',
      page: 3,
    });
  });

  it('falls back to defaults for invalid values instead of erroring', () => {
    expect(parseFilters('?status=open&severity=urgent,low&rule=NOPE&sort=name&page=-2')).toEqual({
      ...DEFAULT_FILTERS,
      severity: ['low'],
    });
    expect(parseFilters('?page=abc').page).toBe(1);
  });
});

describe('serializeFilters', () => {
  it('omits defaults', () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe('');
  });

  it('round-trips through parseFilters', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      status: 'all',
      severity: ['critical', 'medium'],
      api: 'X API',
      page: 2,
    };
    const query = serializeFilters(filters);
    expect(query).toBe('?status=all&severity=critical,medium&api=X+API&page=2');
    expect(parseFilters(query)).toEqual(filters);
  });
});

describe('updateFilters', () => {
  it('goes back to page 1 on any filter change', () => {
    expect(updateFilters({ ...DEFAULT_FILTERS, page: 4 }, { status: 'all' }).page).toBe(1);
  });

  it('keeps an explicit page change', () => {
    expect(updateFilters(DEFAULT_FILTERS, { page: 2 }).page).toBe(2);
  });
});

describe('toggleSeverity', () => {
  it('adds and removes, keeping most-severe-first order', () => {
    expect(toggleSeverity(['medium'], 'critical')).toEqual(['critical', 'medium']);
    expect(toggleSeverity(['critical', 'medium'], 'critical')).toEqual(['medium']);
  });
});

describe('hasNarrowingFilters', () => {
  it('ignores status, sort and page', () => {
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, status: 'all', sort: 'last_seen', page: 2 })).toBe(
      false,
    );
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, rule: 'HTTP_5XX' })).toBe(true);
  });
});

describe('toAlertsQuery', () => {
  it('maps filters to the GET /alerts parameters', () => {
    const params = toAlertsQuery(
      { ...DEFAULT_FILTERS, severity: ['critical', 'high'], api: 'BillingAPI' },
      25,
    );
    expect(Object.fromEntries(params)).toEqual({
      status: 'active',
      sort: 'severity',
      severity: 'critical,high',
      api_name: 'BillingAPI',
      page: '1',
      limit: '25',
    });
  });
});
