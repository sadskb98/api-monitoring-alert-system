import { Activity, Plus } from 'lucide-react';
import { useNow } from '../lib/hooks.js';
import { relativeTime } from '../lib/format.js';

const DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  off: 'bg-slate-400 dark:bg-slate-500',
};

function StatusPill({ label, value, tone, title }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted"
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[tone]}`} />
      <span className="font-medium text-fg">{label}</span>
      {value}
    </span>
  );
}

const DB_TONES = { up: 'ok', connecting: 'warn', disconnecting: 'warn', down: 'bad' };

/** Backend health from GET /health: database state and whether the LLM is configured. */
export function HealthPills({ health }) {
  // A failed health check means the backend is unreachable: don't keep showing the last "up".
  const report = health.isError ? null : health.data;
  const db = health.isError ? 'unknown' : (report?.db ?? '…');
  const llm = health.isError ? 'unknown' : report?.llm;
  return (
    <div className="flex items-center gap-2">
      <StatusPill label="DB" value={db} tone={DB_TONES[db] ?? 'off'} title="MongoDB connection" />
      <StatusPill
        label="LLM"
        value={llm === 'disabled' ? 'templates only' : (llm ?? '…')}
        tone={llm === 'enabled' ? 'ok' : 'off'}
        title={
          llm === 'disabled'
            ? 'GEMINI_API_KEY not set: alert text uses deterministic templates'
            : 'Alert text written by Gemini, with template fallback'
        }
      />
    </div>
  );
}

/** Polling status: live (pulsing), paused (tab hidden) or failing. */
export function LiveIndicator({ state, updatedAt }) {
  const now = useNow(1000);
  const label = { live: 'Live', paused: 'Paused', error: 'Reconnecting', loading: 'Connecting' }[state];
  const tone = { live: 'ok', paused: 'off', error: 'bad', loading: 'off' }[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" aria-live="off">
      <span aria-hidden="true" className="relative flex size-2">
        {state === 'live' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
        )}
        <span className={`relative inline-flex size-2 rounded-full ${DOT[tone]}`} />
      </span>
      <span className="font-medium text-fg">{label}</span>
      {updatedAt > 0 && <span>· updated {relativeTime(updatedAt, now)}</span>}
    </span>
  );
}

export function Header({ health, liveState, updatedAt, fetching, onSubmitClick }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-slate-900 text-red-400 dark:bg-slate-800">
            <Activity aria-hidden="true" className="size-4" strokeWidth={2.5} />
          </span>
          <h1 className="text-sm font-semibold tracking-tight">API Monitor</h1>
        </div>
        <div className="hidden md:block">
          <LiveIndicator state={liveState} updatedAt={updatedAt} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden lg:block">
            <HealthPills health={health} />
          </div>
          <button
            type="button"
            onClick={onSubmitClick}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            <Plus aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
            Submit batch
          </button>
        </div>
      </div>
      <div className="relative h-0.5 overflow-hidden">
        {fetching && (
          <span className="progress-indeterminate absolute inset-y-0 left-0 w-1/4 bg-indigo-500/70" />
        )}
      </div>
    </header>
  );
}
