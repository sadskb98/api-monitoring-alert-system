/** Ordered lowest -> highest, matching the backend (backend/src/lib/severity.js). */
export const SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

/** Most severe first, for tiles and filter chips. */
export const SEVERITIES_DESC = Object.freeze([...SEVERITIES].reverse());

export const severityRank = (severity) => SEVERITIES.indexOf(severity);

/**
 * Tailwind classes per severity. Severity is always shown as color + label + bar, never color alone.
 * Class strings are written out in full so Tailwind can find them.
 */
export const SEVERITY_STYLES = Object.freeze({
  critical: {
    label: 'Critical',
    bar: 'bg-red-600 dark:bg-red-500',
    text: 'text-red-700 dark:text-red-400',
    pill: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30',
    selected: 'ring-red-600/60 bg-red-50/60 dark:bg-red-500/10',
  },
  high: {
    label: 'High',
    bar: 'bg-orange-600 dark:bg-orange-500',
    text: 'text-orange-700 dark:text-orange-400',
    pill: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/30',
    selected: 'ring-orange-600/60 bg-orange-50/60 dark:bg-orange-500/10',
  },
  medium: {
    label: 'Medium',
    bar: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    pill: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30',
    selected: 'ring-amber-600/60 bg-amber-50/60 dark:bg-amber-500/10',
  },
  low: {
    label: 'Low',
    bar: 'bg-slate-400 dark:bg-slate-500',
    text: 'text-slate-600 dark:text-slate-300',
    pill: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/30',
    selected: 'ring-slate-500/60 bg-slate-100/60 dark:bg-slate-500/10',
  },
});

export const RESOLVED_STYLE = Object.freeze({
  bar: 'bg-emerald-600 dark:bg-emerald-500',
  pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30',
});

export const styleFor = (severity) => SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low;
