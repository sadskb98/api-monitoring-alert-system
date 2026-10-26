import { CircleCheck, FilterX, History, RefreshCw, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAlerts, useApi, useHealth, useSubmitBatch } from './api/hooks.js';
import { AlertFilters } from './components/AlertFilters.jsx';
import { AlertList } from './components/AlertList.jsx';
import { Header } from './components/Header.jsx';
import { Pagination } from './components/Pagination.jsx';
import { DEFAULT_BATCH_TEXT } from './components/samples.js';
import { Banner, EmptyState, ListSkeleton } from './components/States.jsx';
import { SubmitBatchPanel } from './components/SubmitBatchPanel.jsx';
import { SummaryTiles } from './components/SummaryTiles.jsx';
import { hasNarrowingFilters, toggleSeverity } from './lib/filters.js';
import { relativeTime } from './lib/format.js';
import { useChangeHighlights, useDocumentVisible, useNow, useUrlFilters } from './lib/hooks.js';

const BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs font-medium hover:border-line-strong';

function StaleBanner({ updatedAt, onRetry }) {
  const now = useNow(1000);
  return (
    <Banner
      tone="warn"
      action={
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold underline underline-offset-2"
        >
          Retry now
        </button>
      }
    >
      Can&apos;t reach the API. Showing data from {relativeTime(updatedAt, now)}; reconnecting…
    </Banner>
  );
}

function AlertsBody({ alerts, filters, resetFilters, onSubmitClick, expandedId, onToggle, highlighted }) {
  const api = useApi();
  const list = alerts.data?.data;

  if (alerts.isPending) return <ListSkeleton rows={5} />;

  if (!list) {
    const network = alerts.error?.code === 'NETWORK';
    return (
      <EmptyState
        icon={WifiOff}
        title={network ? `Can't reach the API at ${api.baseUrl}` : "Couldn't load alerts"}
        body={
          network ? (
            <>
              Start the backend (<code className="font-mono">npm run dev</code> in{' '}
              <code className="font-mono">backend/</code>). Retrying every 10 seconds.
            </>
          ) : (
            alerts.error?.message
          )
        }
        action={
          <button type="button" className={BUTTON} onClick={() => alerts.refetch()}>
            <RefreshCw aria-hidden="true" className="size-3.5" /> Retry
          </button>
        }
      />
    );
  }

  if (list.length === 0) {
    if (hasNarrowingFilters(filters)) {
      return (
        <EmptyState
          icon={FilterX}
          title="No alerts match these filters"
          action={
            <button type="button" className={BUTTON} onClick={resetFilters}>
              Clear filters
            </button>
          }
        />
      );
    }
    if (filters.status === 'resolved') {
      return (
        <EmptyState
          icon={History}
          title="No resolved alerts yet"
          body="Alerts appear here once an API recovers or an alert is resolved manually."
        />
      );
    }
    return (
      <EmptyState
        icon={CircleCheck}
        tone="success"
        title={filters.status === 'active' ? 'All monitored APIs are healthy' : 'No alerts yet'}
        body="No active alerts. Submit a batch of API responses to run anomaly detection."
        action={
          <button type="button" className={BUTTON} onClick={onSubmitClick}>
            Submit a batch
          </button>
        }
      />
    );
  }

  return (
    <div className={alerts.isError ? 'opacity-60' : ''}>
      <AlertList alerts={list} expandedId={expandedId} onToggle={onToggle} highlighted={highlighted} />
    </div>
  );
}

export function App() {
  const { filters, setFilters, resetFilters } = useUrlFilters();
  const alerts = useAlerts(filters);
  const health = useHealth();
  const submit = useSubmitBatch();
  const visible = useDocumentVisible();
  const [batchText, setBatchText] = useState(DEFAULT_BATCH_TEXT);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const page = alerts.data;
  const highlighted = useChangeHighlights(page?.data, JSON.stringify(filters), {
    enabled: !alerts.isPlaceholderData,
  });

  // After alerts resolve, the current page can fall past the end: step back to the last page.
  useEffect(() => {
    if (!page || alerts.isPlaceholderData) return;
    const lastPage = Math.max(1, Math.ceil(page.meta.total / page.meta.limit));
    if (filters.page > lastPage) setFilters({ page: lastPage });
  }, [page, alerts.isPlaceholderData, filters.page, setFilters]);

  const openPanel = useCallback(() => setSubmitOpen(true), []);
  const closePanel = useCallback(() => setSubmitOpen(false), []);
  const toggleExpanded = useCallback((id) => setExpandedId((current) => (current === id ? null : id)), []);

  const liveState = alerts.isError ? 'error' : !visible ? 'paused' : alerts.isPending ? 'loading' : 'live';
  const db = health.data?.db;

  return (
    <div className="min-h-dvh">
      <Header
        health={health}
        liveState={liveState}
        updatedAt={alerts.dataUpdatedAt}
        fetching={alerts.isFetching && !alerts.isPending}
        onSubmitClick={openPanel}
      />

      <main className="mx-auto max-w-[1440px] space-y-3 px-4 py-3 sm:px-6">
        {db && db !== 'up' && (
          <Banner tone="danger">Database unavailable ({db}). Alerts may be stale.</Banner>
        )}
        {alerts.isError && page && (
          <StaleBanner updatedAt={alerts.dataUpdatedAt} onRetry={() => alerts.refetch()} />
        )}

        <SummaryTiles
          counts={page?.meta.counts_by_severity}
          status={filters.status}
          selected={filters.severity}
          onToggle={(severity) => setFilters({ severity: toggleSeverity(filters.severity, severity) })}
        />

        <section aria-label="Alerts" className="overflow-hidden rounded-md border border-line bg-surface">
          <AlertFilters filters={filters} setFilters={setFilters} resetFilters={resetFilters} />
          <AlertsBody
            alerts={alerts}
            filters={filters}
            resetFilters={resetFilters}
            onSubmitClick={openPanel}
            expandedId={expandedId}
            onToggle={toggleExpanded}
            highlighted={highlighted}
          />
          {page && page.data.length > 0 && (
            <Pagination
              page={page.meta.page}
              limit={page.meta.limit}
              total={page.meta.total}
              onPage={(p) => setFilters({ page: p })}
            />
          )}
        </section>
      </main>

      <SubmitBatchPanel
        open={submitOpen}
        onClose={closePanel}
        text={batchText}
        onTextChange={setBatchText}
        submit={submit}
      />
    </div>
  );
}
