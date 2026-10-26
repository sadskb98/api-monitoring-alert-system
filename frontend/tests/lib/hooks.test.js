import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changedAlertIds, useChangeHighlights, useUrlFilters } from '../../src/lib/hooks.js';
import { alertOf } from '../helpers.jsx';

describe('changedAlertIds', () => {
  const a = alertOf({ id: 'a' });
  const b = alertOf({ id: 'b', severity: 'medium', anomalies: [{ rule: 'ZERO_RECORDS' }] });

  it('reports new alerts', () => {
    expect(changedAlertIds([a], [a, b])).toEqual(['b']);
  });

  it('reports escalations: higher severity or a new rule', () => {
    expect(changedAlertIds([b], [{ ...b, severity: 'high' }])).toEqual(['b']);
    expect(
      changedAlertIds([b], [{ ...b, anomalies: [...b.anomalies, { rule: 'LATENCY_WARNING' }] }]),
    ).toEqual(['b']);
  });

  it('ignores alerts that were only seen again', () => {
    expect(changedAlertIds([a, b], [{ ...a, stats: { occurrences: 9 } }, b])).toEqual([]);
  });
});

describe('useChangeHighlights', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('highlights changes between polls of the same view, then clears', () => {
    const first = [alertOf({ id: 'a' })];
    const second = [alertOf({ id: 'a' }), alertOf({ id: 'b' })];
    const { result, rerender } = renderHook(({ alerts, key }) => useChangeHighlights(alerts, key), {
      initialProps: { alerts: first, key: 'view' },
    });
    expect(result.current.size).toBe(0); // first load never flashes

    rerender({ alerts: second, key: 'view' });
    expect([...result.current]).toEqual(['b']);

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.size).toBe(0);
  });

  it('does not highlight when the view (filters/page) changes', () => {
    const { result, rerender } = renderHook(({ alerts, key }) => useChangeHighlights(alerts, key), {
      initialProps: { alerts: [alertOf({ id: 'a' })], key: 'active' },
    });
    rerender({ alerts: [alertOf({ id: 'z' })], key: 'resolved' });
    expect(result.current.size).toBe(0);
  });
});

describe('useUrlFilters', () => {
  it('reads filters from the URL and writes changes back', () => {
    window.history.replaceState(null, '', '/?status=resolved&page=2');
    const { result } = renderHook(() => useUrlFilters());
    expect(result.current.filters).toMatchObject({ status: 'resolved', page: 2 });

    act(() => result.current.setFilters({ severity: ['critical'] }));
    expect(window.location.search).toBe('?status=resolved&severity=critical');

    act(() => result.current.resetFilters());
    expect(window.location.search).toBe('?status=resolved');
  });
});
