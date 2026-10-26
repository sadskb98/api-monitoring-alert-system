import { RULE_NAMES } from './rules.js';
import { SEVERITIES_DESC } from './severity.js';

export const STATUSES = Object.freeze(['active', 'resolved', 'all']);
export const SORTS = Object.freeze(['severity', 'last_seen']);
export const PAGE_SIZE = 25;

export const DEFAULT_FILTERS = Object.freeze({
  status: 'active',
  severity: [],
  api: '',
  rule: '',
  sort: 'severity',
  page: 1,
});

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** Pure: URL query string -> filters. Unknown or invalid values fall back to the defaults. */
export function parseFilters(search) {
  const params = new URLSearchParams(search);
  const requested = (params.get('severity') ?? '').split(',');
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    status: oneOf(params.get('status'), STATUSES, DEFAULT_FILTERS.status),
    severity: SEVERITIES_DESC.filter((s) => requested.includes(s)),
    api: (params.get('api') ?? '').trim().slice(0, 100),
    rule: oneOf(params.get('rule'), RULE_NAMES, ''),
    sort: oneOf(params.get('sort'), SORTS, DEFAULT_FILTERS.sort),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Pure: filters -> "?status=resolved&severity=critical,high" (defaults omitted; "" when all default). */
export function serializeFilters(filters) {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
  if (filters.severity.length) params.set('severity', filters.severity.join(','));
  if (filters.api) params.set('api', filters.api);
  if (filters.rule) params.set('rule', filters.rule);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString().replaceAll('%2C', ',');
  return query ? `?${query}` : '';
}

/** Pure: apply a change; any change other than the page itself goes back to page 1. */
export function updateFilters(filters, patch) {
  return { ...filters, ...patch, page: 'page' in patch ? patch.page : 1 };
}

/** Pure: toggle one severity in the filter, keeping most-severe-first order. */
export function toggleSeverity(selected, severity) {
  const next = selected.includes(severity) ? selected.filter((s) => s !== severity) : [...selected, severity];
  return SEVERITIES_DESC.filter((s) => next.includes(s));
}

export const hasNarrowingFilters = (filters) =>
  filters.severity.length > 0 || filters.api !== '' || filters.rule !== '';

/** Pure: filters -> GET /alerts query parameters. */
export function toAlertsQuery(filters, limit = PAGE_SIZE) {
  const params = new URLSearchParams({ status: filters.status, sort: filters.sort });
  if (filters.severity.length) params.set('severity', filters.severity.join(','));
  if (filters.api) params.set('api_name', filters.api);
  if (filters.rule) params.set('rule', filters.rule);
  params.set('page', String(filters.page));
  params.set('limit', String(limit));
  return params;
}
