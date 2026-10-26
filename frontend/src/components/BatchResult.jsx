import { FileText, Sparkles } from 'lucide-react';
import { describeLlm } from '../lib/batch.js';
import { shortId } from '../lib/format.js';
import { SeverityBadge } from './Badges.jsx';
import { CopyButton } from './CopyButton.jsx';

function Stat({ label, value, tone = '' }) {
  return (
    <div className="rounded-md border border-line px-2.5 py-1.5">
      <div className={`text-lg leading-tight font-semibold ${value > 0 ? tone : 'text-subtle'}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

const ACTION_LABELS = {
  created: 'created',
  escalated: 'escalated',
  updated: 'seen again',
  resolved: 'resolved',
};

/** Per-record validation problems, from `rejected` or a 400's `details`. */
export function RejectedList({ rejected }) {
  return (
    <ul className="space-y-1 text-xs">
      {rejected.map((r) => (
        <li key={r.index} className="rounded border border-line bg-surface-2/50 px-2 py-1">
          <span className="font-mono font-semibold">#{r.index}</span>{' '}
          {r.issues.map((issue, i) => (
            <span key={i} className="text-muted">
              {i > 0 && '; '}
              {issue.path && <code className="font-mono text-fg">{issue.path}</code>} {issue.message}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

function IdLine({ label, value }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {label} <code className="font-mono text-fg">{shortId(value)}</code>
      <CopyButton value={value} label={`${label} id`} />
    </span>
  );
}

/** Outcome of one POST /monitor: counts, LLM status, affected alerts and rejected records. */
export function BatchResult({ result }) {
  const llm = describeLlm(result.llm);
  const LlmIcon = llm.tone === 'ai' ? Sparkles : FileText;
  const llmTone =
    llm.tone === 'ai'
      ? 'text-indigo-700 dark:text-indigo-300'
      : llm.tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-muted';

  return (
    <section aria-label="Batch result" className="space-y-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Result</h3>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <IdLine label="batch" value={result.batch_id} />
          <IdLine label="request" value={result.request_id} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="received" value={result.received} tone="text-fg" />
        <Stat label="accepted" value={result.accepted} tone="text-fg" />
        <Stat label="rejected" value={result.rejected.length} tone="text-red-600 dark:text-red-400" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="created" value={result.alerts.created} tone="text-red-600 dark:text-red-400" />
        <Stat label="escalated" value={result.alerts.escalated} tone="text-orange-600 dark:text-orange-400" />
        <Stat label="seen again" value={result.alerts.updated} tone="text-fg" />
        <Stat label="resolved" value={result.alerts.resolved} tone="text-emerald-600 dark:text-emerald-400" />
      </div>

      <p className={`flex items-start gap-1.5 text-xs ${llmTone}`}>
        <LlmIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="font-medium">Alert text: {llm.label}</span>
          {llm.detail && <span className="text-muted"> · {llm.detail}</span>}
        </span>
      </p>

      {result.items.length > 0 && (
        <ul className="space-y-1">
          {result.items.map((item) => (
            <li key={`${item.alert_id}-${item.action}`} className="flex items-center gap-2 text-xs">
              <SeverityBadge severity={item.severity} className="w-[76px] shrink-0" />
              <span className="font-medium">{item.api_name}</span>
              <span className="text-muted">{ACTION_LABELS[item.action] ?? item.action}</span>
            </li>
          ))}
        </ul>
      )}

      {result.rejected.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-red-700 dark:text-red-400">
            Rejected records ({result.rejected.length})
          </h4>
          <RejectedList rejected={result.rejected} />
        </div>
      )}
    </section>
  );
}
