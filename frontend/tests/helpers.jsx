import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { ApiProvider } from '../src/api/hooks.js';
import { ToastProvider } from '../src/components/Toast.jsx';

const NOW = new Date();
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();

export function alertOf(overrides = {}) {
  return {
    id: '65f2a1b2c3d4e5f6a7b8c9d0',
    fingerprint: 'appointmentapi',
    api_name: 'AppointmentAPI',
    anomalies: [
      { rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' },
      { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
    ],
    severity: 'critical',
    peak_severity: 'critical',
    status: 'active',
    title: 'AppointmentAPI: server errors, critical latency',
    message:
      'AppointmentAPI failed with server error status 500, returned 0 records and responded in 5500 ms.',
    suggested_action: 'Check service logs.',
    message_source: 'llm',
    message_model: 'gemini-3.7-flash',
    last_observation: {
      response_time_ms: 5500,
      status_code: 500,
      records_returned: 0,
      observed_at: minutesAgo(2),
      invalid_fields: [],
    },
    stats: { occurrences: 3, max_response_time_ms: 5500, min_records_returned: 0 },
    first_seen_at: minutesAgo(10),
    last_seen_at: minutesAgo(2),
    resolved_at: null,
    resolved_by: null,
    notified_at: null,
    ...overrides,
  };
}

export function pageOf(alerts, { counts = {}, page = 1, limit = 25, total = alerts.length } = {}) {
  return {
    data: alerts,
    meta: { total, page, limit, counts_by_severity: { low: 0, medium: 0, high: 0, critical: 0, ...counts } },
  };
}

export const batchResultOf = (overrides = {}) => ({
  batch_id: '6adee33e3b33d60aace3d4d6',
  request_id: 'req-123',
  received: 2,
  accepted: 2,
  rejected: [],
  findings: 1,
  alerts: { created: 1, escalated: 0, updated: 0, resolved: 0 },
  llm: { status: 'ok', model: 'gemini-3.7-flash', attempts: 1, latency_ms: 1840 },
  items: [
    {
      alert_id: 'a1',
      api_name: 'AppointmentAPI',
      action: 'created',
      status: 'active',
      severity: 'critical',
      anomalies: [],
      title: 't',
      message: 'm',
      suggested_action: null,
      message_source: 'llm',
      message_model: 'gemini-3.7-flash',
    },
  ],
  ...overrides,
});

export function fakeApi(overrides = {}) {
  return {
    baseUrl: 'http://api.test',
    listAlerts: vi.fn(async () => pageOf([])),
    getHealth: vi.fn(async () => ({ status: 'ok', db: 'up', llm: 'enabled', uptime_s: 10 })),
    submitBatch: vi.fn(async () => batchResultOf()),
    resolveAlert: vi.fn(async (id) => alertOf({ id, status: 'resolved', resolved_by: 'manual' })),
    ...overrides,
  };
}

/** Render with the same providers as main.jsx, a fake API and no query retries. */
export function renderWithProviders(ui, { api = fakeApi() } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <ToastProvider>{ui}</ToastProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...result, api, queryClient };
}
