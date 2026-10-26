import { CircleAlert, TriangleAlert } from 'lucide-react';

export function EmptyState({ icon: Icon, tone = 'neutral', title, body, action }) {
  const iconTone =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
      : 'bg-surface-2 text-subtle';
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && (
        <span className={`mb-3 flex size-10 items-center justify-center rounded-full ${iconTone}`}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <h2 className="text-sm font-semibold">{title}</h2>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const BANNER_TONES = {
  warn: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  danger:
    'border-red-300/70 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
};

export function Banner({ tone = 'warn', children, action }) {
  const Icon = tone === 'danger' ? CircleAlert : TriangleAlert;
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${BANNER_TONES[tone]}`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded bg-surface-2 ${className}`} />;
}

export function ListSkeleton({ rows = 5 }) {
  return (
    <ul aria-label="Loading alerts" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
          <Skeleton className="h-5 w-16" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-24" />
        </li>
      ))}
    </ul>
  );
}
