import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasNarrowingFilters, toggleSeverity } from '../lib/filters.js';
import { useDebounced } from '../lib/hooks.js';
import { RULE_NAMES } from '../lib/rules.js';
import { SEVERITIES_DESC, styleFor } from '../lib/severity.js';

const STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const CONTROL =
  'h-8 rounded-md border border-line bg-surface px-2 text-xs text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

export function AlertFilters({ filters, setFilters, resetFilters }) {
  const [apiText, setApiText] = useState(filters.api);
  const debouncedApi = useDebounced(apiText.trim(), 350);

  // URL/clear changes flow into the box; typing flows out after the debounce.
  useEffect(() => setApiText(filters.api), [filters.api]);
  useEffect(() => {
    if (debouncedApi !== filters.api) setFilters({ api: debouncedApi });
  }, [debouncedApi]); // only react to the debounced text, not to filters.api changing under it

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div role="group" aria-label="Status" className="inline-flex rounded-md bg-surface-2 p-0.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={filters.status === tab.value}
            onClick={() => setFilters({ status: tab.value })}
            className={`h-7 rounded px-3 text-xs font-medium transition ${
              filters.status === tab.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Severity" className="flex items-center gap-1">
        {SEVERITIES_DESC.map((severity) => {
          const style = styleFor(severity);
          const active = filters.severity.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              aria-pressed={active}
              onClick={() => setFilters({ severity: toggleSeverity(filters.severity, severity) })}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition ${
                active
                  ? `border-transparent ring-1 ring-inset ${style.pill}`
                  : 'border-line text-muted hover:text-fg'
              }`}
            >
              <span aria-hidden="true" className={`size-1.5 rounded-full ${style.bar}`} />
              {style.label}
            </button>
          );
        })}
      </div>

      <label className="sr-only" htmlFor="rule-filter">
        Rule
      </label>
      <select
        id="rule-filter"
        value={filters.rule}
        onChange={(e) => setFilters({ rule: e.target.value })}
        className={CONTROL}
      >
        <option value="">All rules</option>
        {RULE_NAMES.map((rule) => (
          <option key={rule} value={rule}>
            {rule}
          </option>
        ))}
      </select>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle"
        />
        <input
          type="search"
          value={apiText}
          onChange={(e) => setApiText(e.target.value)}
          placeholder="API name (exact)"
          aria-label="Filter by API name"
          className={`${CONTROL} w-44 pl-7`}
        />
      </div>

      {hasNarrowingFilters(filters) && (
        <button
          type="button"
          onClick={() => {
            setApiText('');
            resetFilters();
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:text-fg"
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear filters
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <label htmlFor="sort" className="text-xs text-muted">
          Sort
        </label>
        <select
          id="sort"
          value={filters.sort}
          onChange={(e) => setFilters({ sort: e.target.value })}
          className={CONTROL}
        >
          <option value="severity">Severity</option>
          <option value="last_seen">Last seen</option>
        </select>
      </div>
    </div>
  );
}
