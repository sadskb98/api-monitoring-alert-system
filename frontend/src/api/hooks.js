import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext } from 'react';

export const POLL_MS = 10_000;

const ApiContext = createContext(null);

export function ApiProvider({ client, children }) {
  return createElement(ApiContext.Provider, { value: client }, children);
}

export function useApi() {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}

/** Retry network and 5xx failures (twice, with TanStack's backoff); 4xx answers are final. */
const shouldRetry = (failureCount, error) =>
  failureCount < 2 && !(error?.status >= 400 && error?.status < 500);

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true, refetchIntervalInBackground: false },
      mutations: { retry: false },
    },
  });
}

/** Alerts for the current filters, polled every POLL_MS while the tab is visible. */
export function useAlerts(filters) {
  const api = useApi();
  return useQuery({
    queryKey: ['alerts', filters],
    queryFn: ({ signal }) => api.listAlerts(filters, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });
}

export function useHealth() {
  const api = useApi();
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.getHealth({ signal }),
    refetchInterval: POLL_MS,
  });
}

/** POST /monitor; refreshes the alert list right away instead of waiting for the next poll. */
export function useSubmitBatch() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text) => api.submitBatch(text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useResolveAlert() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.resolveAlert(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
}
