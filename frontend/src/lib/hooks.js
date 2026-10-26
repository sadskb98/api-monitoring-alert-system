import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_FILTERS, parseFilters, serializeFilters, updateFilters } from './filters.js';

/** Filters kept in the URL query string, so a view survives a refresh and can be shared. */
export function useUrlFilters() {
  const [filters, setState] = useState(() => parseFilters(window.location.search));

  useEffect(() => {
    const url = `${window.location.pathname}${serializeFilters(filters)}`;
    if (url !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', url);
  }, [filters]);

  useEffect(() => {
    const onPopState = () => setState(parseFilters(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setFilters = useCallback((patch) => setState((prev) => updateFilters(prev, patch)), []);
  const resetFilters = useCallback(
    () => setState((prev) => ({ ...DEFAULT_FILTERS, status: prev.status, sort: prev.sort })),
    [],
  );
  return { filters, setFilters, resetFilters };
}

/** Current time, re-rendering every `intervalMs` (for "updated 3s ago" labels). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Seconds elapsed while `active` is true (resets each time it turns on). */
export function useElapsed(active, intervalMs = 100) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const start = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - start), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return elapsedMs;
}

/** Whether the tab is visible (polling pauses while hidden). */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/** Value that only updates after `delayMs` without changes (search input -> query). */
export function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Pure: alert ids that are new, or more severe / have new rules, compared with the previous poll. */
export function changedAlertIds(previous, current) {
  const before = new Map(previous.map((a) => [a.id, a]));
  const changed = [];
  for (const alert of current) {
    const old = before.get(alert.id);
    if (!old) {
      changed.push(alert.id);
      continue;
    }
    const oldRules = new Set(old.anomalies.map((a) => a.rule));
    const newRule = alert.anomalies.some((a) => !oldRules.has(a.rule));
    if (newRule || alert.severity !== old.severity || alert.status !== old.status) changed.push(alert.id);
  }
  return changed;
}

/**
 * Ids to highlight briefly after a poll brings new or escalated alerts.
 * Comparisons only happen within the same view (`viewKey`), so changing filters or pages never flashes.
 */
export function useChangeHighlights(alerts, viewKey, { durationMs = 3000, enabled = true } = {}) {
  const previous = useRef({ viewKey: null, alerts: null });
  const timer = useRef(null);
  const [highlighted, setHighlighted] = useState(() => new Set());

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!enabled || !alerts) return;
    const prev = previous.current;
    previous.current = { viewKey, alerts };
    if (prev.viewKey !== viewKey || prev.alerts === null || prev.alerts === alerts) return;
    const ids = changedAlertIds(prev.alerts, alerts);
    if (ids.length === 0) return;
    setHighlighted(new Set(ids));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlighted(new Set()), durationMs);
  }, [alerts, viewKey, enabled, durationMs]);

  return highlighted;
}
