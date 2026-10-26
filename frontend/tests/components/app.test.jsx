import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.jsx';
import { ApiError } from '../../src/api/client.js';
import { alertOf, fakeApi, pageOf, renderWithProviders } from '../helpers.jsx';

const networkError = () =>
  new ApiError({ status: 0, code: 'NETWORK', message: "Can't reach the API at http://api.test" });

describe('App states', () => {
  it('shows skeletons while the first load is in flight', () => {
    const api = fakeApi({ listAlerts: vi.fn(() => new Promise(() => {})) });
    renderWithProviders(<App />, { api });
    expect(screen.getByLabelText('Loading alerts')).toBeInTheDocument();
  });

  it('shows the healthy empty state with no active alerts', async () => {
    renderWithProviders(<App />);
    expect(await screen.findByText('All monitored APIs are healthy')).toBeInTheDocument();
  });

  it('shows a filtered empty state with a way to clear filters', async () => {
    window.history.replaceState(null, '', '/?severity=low');
    const { api } = renderWithProviders(<App />);
    expect(await screen.findByText('No alerts match these filters')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Clear filters/ })[0]);
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(api.listAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: [] }),
      expect.anything(),
    );
  });

  it('shows a resolved-tab empty state', async () => {
    window.history.replaceState(null, '', '/?status=resolved');
    renderWithProviders(<App />);
    expect(await screen.findByText('No resolved alerts yet')).toBeInTheDocument();
  });

  it('explains how to start the backend when it is unreachable on first load', async () => {
    const api = fakeApi({
      listAlerts: vi.fn(async () => {
        throw networkError();
      }),
    });
    renderWithProviders(<App />, { api });
    expect(await screen.findByText("Can't reach the API at http://api.test")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.listAlerts).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the last data with a reconnecting banner when polling starts failing', async () => {
    let fail = false;
    const api = fakeApi({
      listAlerts: vi.fn(async () => {
        if (fail) throw networkError();
        return pageOf([alertOf()], { counts: { critical: 1 } });
      }),
    });
    const { queryClient } = renderWithProviders(<App />, { api });
    expect(await screen.findByText('AppointmentAPI')).toBeInTheDocument();

    fail = true;
    await queryClient.refetchQueries({ queryKey: ['alerts'] });
    expect(await screen.findByText(/Can't reach the API\. Showing data from/)).toBeInTheDocument();
    expect(screen.getByText('AppointmentAPI')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  it('warns when the database is down', async () => {
    const api = fakeApi({
      getHealth: vi.fn(async () => ({ status: 'degraded', db: 'down', llm: 'enabled' })),
    });
    renderWithProviders(<App />, { api });
    expect(await screen.findByText('Database unavailable (down). Alerts may be stale.')).toBeInTheDocument();
  });
});

describe('App with alerts', () => {
  it('renders tiles, rows and pagination, and expands a row', async () => {
    const api = fakeApi({
      listAlerts: vi.fn(async () =>
        pageOf(
          [
            alertOf(),
            alertOf({
              id: 'b2',
              api_name: 'BillingAPI',
              title: 'BillingAPI: auth failures',
              severity: 'high',
            }),
          ],
          {
            counts: { critical: 1, high: 1 },
          },
        ),
      ),
    });
    renderWithProviders(<App />, { api });
    const list = await screen.findByRole('list', { name: 'Alerts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 APIs affected')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–2 of 2');

    await userEvent.click(within(list).getAllByRole('button', { expanded: false })[0]);
    expect(screen.getByText(/failed with server error status 500/)).toBeInTheDocument();
  });

  it('filters by severity from a tile and keeps it in the URL', async () => {
    const { api } = renderWithProviders(<App />);
    await screen.findByText('All monitored APIs are healthy');
    const tiles = screen.getByRole('region', { name: 'Alert summary' });
    await userEvent.click(within(tiles).getByRole('button', { name: /^Critical/ }));
    await waitFor(() => expect(window.location.search).toBe('?severity=critical'));
    expect(api.listAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: ['critical'] }),
      expect.anything(),
    );
  });

  it('opens the submit panel from the header and refreshes the list after a submit', async () => {
    const { api } = renderWithProviders(<App />);
    await screen.findByText('All monitored APIs are healthy');
    const callsBefore = api.listAlerts.mock.calls.length;

    await userEvent.click(screen.getAllByRole('button', { name: /Submit batch/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Submit batch' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));

    expect(await within(dialog).findByRole('region', { name: 'Batch result' })).toBeInTheDocument();
    await waitFor(() => expect(api.listAlerts.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe('Header health', () => {
  it('shows DB and LLM state from /health', async () => {
    renderWithProviders(<App />);
    await waitFor(() => expect(screen.getByTitle('MongoDB connection')).toHaveTextContent('DBup'));
  });

  it('does not keep showing "up" once the health check fails', async () => {
    let fail = false;
    const api = fakeApi({
      getHealth: vi.fn(async () => {
        if (fail) throw networkError();
        return { status: 'ok', db: 'up', llm: 'enabled', uptime_s: 1 };
      }),
    });
    const { queryClient } = renderWithProviders(<App />, { api });
    await waitFor(() => expect(screen.getByTitle('MongoDB connection')).toHaveTextContent('DBup'));
    fail = true;
    await queryClient.refetchQueries({ queryKey: ['health'] });
    await waitFor(() => expect(screen.getByTitle('MongoDB connection')).toHaveTextContent('DBunknown'));
  });
});
