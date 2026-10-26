import { ChevronLeft, ChevronRight } from 'lucide-react';

const BUTTON =
  'inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs font-medium text-muted hover:text-fg disabled:pointer-events-none disabled:opacity-40';

export function Pagination({ page, limit, total, onPage }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-line px-4 py-2">
      <p className="text-xs text-muted">
        Showing <span className="font-medium text-fg">{from}</span>–
        <span className="font-medium text-fg">{to}</span> of{' '}
        <span className="font-medium text-fg">{total}</span>
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" className={BUTTON} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden="true" className="size-3.5" /> Prev
          </button>
          <span className="px-1 text-xs text-muted">
            {page} / {pages}
          </span>
          <button type="button" className={BUTTON} disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next <ChevronRight aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
    </nav>
  );
}
