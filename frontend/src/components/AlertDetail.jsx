import { CheckCheck, Lightbulb, LoaderCircle, Mail } from 'lucide-react';
import { useResolveAlert } from '../api/hooks.js';
import { formatMs, formatTime, formatValue, shortId } from '../lib/format.js';
import { styleFor } from '../lib/severity.js';
import { CopyButton } from './CopyButton.jsx';
import { useToast } from './Toast.jsx';

function Facts({ title, rows }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ResolveButton({ alert }) {
  const resolve = useResolveAlert();
  const toast = useToast();

  function onClick() {
    resolve.mutate(alert.id, {
      onSuccess: () => toast.push({ title: `${alert.api_name} resolved` }),
      onError: (err) =>
        toast.push({
          tone: 'error',
          title: err.status === 404 ? 'Alert no longer exists' : 'Could not resolve the alert',
          body: [err.message, err.requestId && `Request ${err.requestId}`].filter(Boolean).join(' · '),
        }),
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={resolve.isPending}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-60 dark:hover:text-emerald-400"
    >
      {resolve.isPending ? (
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      ) : (
        <CheckCheck aria-hidden="true" className="size-3.5" />
      )}
      Resolve
    </button>
  );
}

/** Expanded view of one alert: the AI/template text, the facts behind it and its lifecycle. */
export function AlertDetail({ alert, id }) {
  const obs = alert.last_observation ?? {};
  const invalid = obs.invalid_fields ?? [];
  const resolvedBy = alert.resolved_by === 'manual' ? 'manually' : 'automatically';

  return (
    <div id={id} className="border-t border-line bg-surface-2/40 px-4 py-3 sm:pl-[108px]">
      <p className="max-w-3xl text-sm leading-relaxed">{alert.message}</p>
      {alert.suggested_action && (
        <p className="mt-2 flex max-w-3xl gap-1.5 text-sm text-muted">
          <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>
            <span className="font-medium text-fg">Suggested action: </span>
            {alert.suggested_action}
          </span>
        </p>
      )}

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Facts
          title="Last observation"
          rows={[
            ['Status', formatValue(obs.status_code)],
            ['Latency', formatMs(obs.response_time_ms)],
            ['Records', formatValue(obs.records_returned)],
            ['Observed', formatTime(obs.observed_at)],
          ]}
        />
        <Facts
          title="History"
          rows={[
            ['Occurrences', formatValue(alert.stats?.occurrences)],
            ['Max latency', formatMs(alert.stats?.max_response_time_ms)],
            ['Min records', formatValue(alert.stats?.min_records_returned)],
            [
              'Peak severity',
              <span key="peak" className={styleFor(alert.peak_severity).text}>
                {styleFor(alert.peak_severity).label}
              </span>,
            ],
          ]}
        />
        <Facts
          title="Timeline"
          rows={[
            ['First seen', formatTime(alert.first_seen_at)],
            ['Last seen', formatTime(alert.last_seen_at)],
            ...(alert.status === 'resolved'
              ? [['Resolved', `${formatTime(alert.resolved_at)} (${resolvedBy})`]]
              : []),
          ]}
        />
      </div>

      {invalid.length > 0 && (
        <div className="mt-3 text-xs">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
            Invalid fields
          </h3>
          <ul className="space-y-0.5">
            {invalid.map((f) => (
              <li key={f.field}>
                <code className="font-mono text-fg">{f.field}</code>{' '}
                <span className="text-muted">{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2.5 text-xs text-muted">
        <span>
          Text:{' '}
          <span className="font-medium text-fg">
            {alert.message_source === 'llm' ? `AI · ${alert.message_model ?? 'LLM'}` : 'Template'}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Mail aria-hidden="true" className="size-3.5" />
          {alert.notified_at ? `Emailed ${formatTime(alert.notified_at)}` : 'Not emailed'}
        </span>
        <span className="inline-flex items-center gap-1">
          id <code className="font-mono text-fg">{shortId(alert.id)}</code>
          <CopyButton value={alert.id} label="alert id" />
        </span>
        {alert.status === 'active' && (
          <span className="ml-auto">
            <ResolveButton alert={alert} />
          </span>
        )}
      </div>
    </div>
  );
}
