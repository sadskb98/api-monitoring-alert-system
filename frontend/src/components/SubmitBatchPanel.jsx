import { CircleCheck, CircleX, LoaderCircle, Upload, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { checkBatchText } from '../lib/batch.js';
import { useElapsed } from '../lib/hooks.js';
import { BatchResult, RejectedList } from './BatchResult.jsx';
import { SAMPLES } from './samples.js';
import { Banner } from './States.jsx';

function SubmitError({ error }) {
  const rejected = Array.isArray(error.details) ? error.details : null;
  return (
    <Banner tone="danger">
      <p className="font-medium">{error.message}</p>
      <p className="mt-0.5 text-xs opacity-80">
        {error.code}
        {error.status ? ` · HTTP ${error.status}` : ''}
        {error.requestId ? ` · request ${error.requestId}` : ''}
      </p>
      {rejected && (
        <div className="mt-2">
          <RejectedList rejected={rejected} />
        </div>
      )}
    </Banner>
  );
}

/**
 * Slide-over for POST /monitor. The editor text and the mutation live in the parent,
 * so closing and reopening the panel keeps the batch and its last result.
 */
export function SubmitBatchPanel({ open, onClose, text, onTextChange, submit }) {
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const check = checkBatchText(text);
  const pending = submit.isPending;
  const elapsedMs = useElapsed(pending);

  useEffect(() => {
    if (!open) return undefined;
    textareaRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const send = () => {
    if (check.ok && !pending) submit.mutate(text);
  };

  async function loadFile(file) {
    if (!file) return;
    onTextChange(await file.text());
    submit.reset();
  }

  return (
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-title"
        className="absolute inset-y-0 right-0 flex h-dvh w-full flex-col border-l border-line bg-surface shadow-2xl sm:w-[480px]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 id="submit-title" className="text-sm font-semibold">
            Submit batch
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-muted">
            Sends the JSON below to <code className="font-mono">POST /monitor</code> (the same pipeline as{' '}
            <code className="font-mono">npm run ingest</code>).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                title={sample.hint}
                disabled={pending}
                onClick={() => {
                  onTextChange(sample.text);
                  submit.reset();
                }}
                className={`h-7 rounded-md border px-2.5 text-xs font-medium disabled:opacity-50 ${
                  text === sample.text
                    ? 'border-indigo-500/60 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                    : 'border-line text-muted hover:text-fg'
                }`}
              >
                {sample.label}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-line-strong px-2.5 text-xs font-medium text-muted hover:text-fg disabled:opacity-50"
            >
              <Upload aria-hidden="true" className="size-3.5" />
              Upload .json
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="batch-file"
              onChange={(e) => {
                loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            readOnly={pending}
            spellCheck={false}
            aria-label="Batch JSON"
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              loadFile(e.dataTransfer.files?.[0]);
            }}
            className="block h-64 w-full resize-y rounded-md border border-line bg-surface-2/40 p-3 font-mono text-xs leading-5 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none read-only:opacity-70"
          />

          {submit.error && <SubmitError error={submit.error} />}
          {submit.data && !submit.error && <BatchResult result={submit.data} />}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
          <p
            className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs ${check.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
          >
            {check.ok ? (
              <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <CircleX aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span className="truncate" title={check.ok ? undefined : check.message}>
              {check.ok ? `Valid JSON · ${check.count} record${check.count === 1 ? '' : 's'}` : check.message}
            </span>
          </p>
          <span className="hidden text-[11px] text-subtle sm:inline">Ctrl/⌘ + Enter</span>
          <button
            type="button"
            onClick={send}
            disabled={!check.ok || pending}
            className="inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {pending ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                Processing… {(elapsedMs / 1000).toFixed(1)}s
              </>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
