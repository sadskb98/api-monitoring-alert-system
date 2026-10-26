import { SEVERITIES_DESC, styleFor } from '../lib/severity.js';
import { Skeleton } from './States.jsx';

const TOTAL_LABELS = {
  active: { label: 'Active alerts', note: (n) => `${n === 1 ? '1 API' : `${n} APIs`} affected` },
  resolved: { label: 'Resolved alerts', note: () => 'incident history' },
  all: { label: 'All alerts', note: () => 'active and resolved' },
};

const TILE =
  'flex h-16 min-w-0 flex-col justify-between rounded-md border border-line bg-surface px-2.5 py-2 text-left sm:px-3';

/**
 * One tile per severity (click toggles that severity filter) plus a total.
 * Counts ignore the severity filter (backend `counts_by_severity`), so tiles never drop to zero when filtering.
 */
export function SummaryTiles({ counts, status, selected, onToggle }) {
  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null;
  const totals = TOTAL_LABELS[status];

  return (
    <section aria-label="Alert summary" className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      {SEVERITIES_DESC.map((severity) => {
        const style = styleFor(severity);
        const count = counts?.[severity];
        const isSelected = selected.includes(severity);
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(severity)}
            title={isSelected ? `Stop filtering by ${style.label}` : `Show only ${style.label}`}
            className={`${TILE} relative overflow-hidden transition hover:border-line-strong ${isSelected ? `ring-2 ring-inset ${style.selected}` : ''}`}
          >
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${style.bar}`} />
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              {style.label}
            </span>
            {count === undefined ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <span
                className={`text-2xl leading-none font-semibold ${count > 0 ? style.text : 'text-subtle'}`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
      <div className={`${TILE} col-span-4 sm:col-span-1`}>
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{totals.label}</span>
        {total === null ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="text-2xl leading-none font-semibold">{total}</span>
            <span className="truncate text-xs text-muted">{totals.note(total)}</span>
          </span>
        )}
      </div>
    </section>
  );
}
