import { ChevronRight } from 'lucide-react';
import { displayTitle, relativeTime } from '../lib/format.js';
import { useNow } from '../lib/hooks.js';
import { RESOLVED_STYLE, styleFor } from '../lib/severity.js';
import { AlertDetail } from './AlertDetail.jsx';
import { ResolvedBadge, RuleChip, SeverityBadge, SourceBadge } from './Badges.jsx';

function RowMeta({ alert, now }) {
  const resolved = alert.status === 'resolved';
  return (
    <>
      <SourceBadge source={alert.message_source} model={alert.message_model} />
      {resolved && <ResolvedBadge by={alert.resolved_by} />}
      <span className="w-8 text-right text-xs text-muted" title="Occurrences">
        ×{alert.stats?.occurrences ?? 1}
      </span>
      <time
        dateTime={resolved ? alert.resolved_at : alert.last_seen_at}
        title={resolved ? 'Resolved' : 'Last seen'}
        className="w-16 text-right text-xs text-muted"
      >
        {relativeTime(resolved ? alert.resolved_at : alert.last_seen_at, now)}
      </time>
    </>
  );
}

export function AlertRow({ alert, expanded, onToggle, highlighted, now }) {
  const resolved = alert.status === 'resolved';
  const bar = resolved ? RESOLVED_STYLE.bar : styleFor(alert.severity).bar;
  const detailId = `alert-detail-${alert.id}`;

  return (
    <li className={`border-b border-line last:border-b-0 ${highlighted ? 'row-flash' : ''}`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
        className={`relative flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-surface-2/70 focus-visible:bg-surface-2 focus-visible:outline-none ${expanded ? 'bg-surface-2/50' : ''}`}
      >
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${bar}`} />
        <SeverityBadge
          severity={alert.severity}
          className={`w-[76px] shrink-0 ${resolved ? 'opacity-60' : ''}`}
        />
        <span className={`block min-w-0 flex-1 ${resolved ? 'opacity-75' : ''}`}>
          <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
            <span className="shrink-0 truncate text-sm font-semibold">{alert.api_name}</span>
            <span className="truncate text-sm text-muted">{displayTitle(alert.title, alert.api_name)}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {alert.anomalies.map((a) => (
              <RuleChip key={a.rule} rule={a.rule} />
            ))}
            <span className="ml-1 flex items-center gap-2 sm:hidden">
              <RowMeta alert={alert} now={now} />
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          <RowMeta alert={alert} now={now} />
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`size-4 shrink-0 text-subtle transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && <AlertDetail alert={alert} id={detailId} />}
    </li>
  );
}

export function AlertList({ alerts, expandedId, onToggle, highlighted }) {
  const now = useNow(5000);
  return (
    <ul aria-label="Alerts">
      {alerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          now={now}
          expanded={expandedId === alert.id}
          highlighted={highlighted.has(alert.id)}
          onToggle={() => onToggle(alert.id)}
        />
      ))}
    </ul>
  );
}
