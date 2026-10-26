import { FileText, Sparkles } from 'lucide-react';
import { ruleDescription } from '../lib/rules.js';
import { RESOLVED_STYLE, styleFor } from '../lib/severity.js';

const PILL =
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

export function SeverityBadge({ severity, className = '' }) {
  const style = styleFor(severity);
  return (
    <span className={`${PILL} uppercase tracking-wide ${style.pill} ${className}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${style.bar}`} />
      {style.label}
    </span>
  );
}

/** Who wrote the alert text: the LLM (with model) or the deterministic template. */
export function SourceBadge({ source, model }) {
  if (source === 'llm') {
    return (
      <span
        title={`Alert text written by ${model ?? 'the LLM'}`}
        className={`${PILL} font-medium text-indigo-700 ring-indigo-500/40 dark:text-indigo-300 dark:ring-indigo-400/40`}
      >
        <Sparkles aria-hidden="true" className="size-3" />
        AI
      </span>
    );
  }
  return (
    <span
      title="LLM unavailable or disabled; deterministic template"
      className={`${PILL} font-medium text-muted ring-line-strong`}
    >
      <FileText aria-hidden="true" className="size-3" />
      Template
    </span>
  );
}

export function RuleChip({ rule }) {
  return (
    <span
      title={ruleDescription(rule)}
      className="rounded bg-surface-2 px-1 py-px font-mono text-[10.5px] leading-4 text-muted"
    >
      {rule}
    </span>
  );
}

export function ResolvedBadge({ by }) {
  return (
    <span className={`${PILL} ${RESOLVED_STYLE.pill}`}>
      {by === 'manual' ? 'Resolved manually' : 'Auto-resolved'}
    </span>
  );
}
