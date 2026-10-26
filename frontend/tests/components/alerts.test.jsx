import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlertList } from '../../src/components/AlertList.jsx';
import { SummaryTiles } from '../../src/components/SummaryTiles.jsx';
import { ApiError } from '../../src/api/client.js';
import { alertOf, fakeApi, renderWithProviders } from '../helpers.jsx';

function renderList(alerts, { expandedId = null, api } = {}) {
  const onToggle = vi.fn();
  const utils = renderWithProviders(
    <AlertList alerts={alerts} expandedId={expandedId} onToggle={onToggle} highlighted={new Set()} />,
    { api },
  );
  return { ...utils, onToggle };
}

describe('AlertList / AlertRow', () => {
  it('shows severity, API, title without the repeated name, rules, AI badge, occurrences and age', () => {
    renderList([alertOf()]);
    const row = screen.getByRole('button', { expanded: false });
    expect(row).toHaveTextContent('Critical');
    expect(row).toHaveTextContent('AppointmentAPI');
    expect(row).toHaveTextContent('Server errors, critical latency');
    expect(row).toHaveTextContent('HTTP_5XX');
    expect(row).toHaveTextContent('LATENCY_CRITICAL');
    expect(row).toHaveTextContent('×3');
    expect(row).toHaveTextContent('2m ago');
    expect(screen.getAllByText('AI')[0]).toHaveAttribute('title', 'Alert text written by gemini-3.7-flash');
  });

  it('labels template text', () => {
    renderList([alertOf({ message_source: 'template', message_model: null })]);
    expect(screen.getAllByText('Template').length).toBeGreaterThan(0);
  });

  it('marks resolved alerts and how they were resolved', () => {
    renderList([
      alertOf({ id: 'r1', status: 'resolved', resolved_by: 'auto', resolved_at: new Date().toISOString() }),
      alertOf({ id: 'r2', status: 'resolved', resolved_by: 'manual', resolved_at: new Date().toISOString() }),
    ]);
    expect(screen.getAllByText('Auto-resolved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Resolved manually').length).toBeGreaterThan(0);
  });

  it('toggles a row', async () => {
    const { onToggle } = renderList([alertOf({ id: 'x1' })]);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('AlertDetail', () => {
  it('shows the message, suggested action, facts and text source', () => {
    renderList([alertOf()], { expandedId: '65f2a1b2c3d4e5f6a7b8c9d0' });
    expect(screen.getByText(/failed with server error status 500/)).toBeInTheDocument();
    expect(screen.getByText('Check service logs.')).toBeInTheDocument();
    expect(screen.getAllByText('5500 ms')).toHaveLength(2); // last observation + max latency
    expect(screen.getByText('AI · gemini-3.7-flash')).toBeInTheDocument();
    expect(screen.getByText('Not emailed')).toBeInTheDocument();
  });

  it('lists invalid fields for INVALID_PAYLOAD alerts', () => {
    const alert = alertOf({
      id: 'inv',
      anomalies: [{ rule: 'INVALID_PAYLOAD', category: 'DATA', severity: 'high' }],
      last_observation: {
        response_time_ms: null,
        status_code: 200,
        records_returned: 12,
        observed_at: new Date().toISOString(),
        invalid_fields: [{ field: 'response_time_ms', message: 'Expected a number' }],
      },
    });
    renderList([alert], { expandedId: 'inv' });
    expect(screen.getByText('Invalid fields')).toBeInTheDocument();
    expect(screen.getByText('Expected a number')).toBeInTheDocument();
  });

  it('resolves an active alert and confirms with a toast', async () => {
    const { api } = renderList([alertOf()], { expandedId: '65f2a1b2c3d4e5f6a7b8c9d0' });
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(api.resolveAlert).toHaveBeenCalledWith('65f2a1b2c3d4e5f6a7b8c9d0');
    expect(await screen.findByText('AppointmentAPI resolved')).toBeInTheDocument();
  });

  it('shows the error and request id when resolving fails', async () => {
    const api = fakeApi({
      resolveAlert: vi.fn(async () => {
        throw new ApiError({ status: 500, code: 'INTERNAL', message: 'Boom', requestId: 'req-7' });
      }),
    });
    renderList([alertOf()], { expandedId: '65f2a1b2c3d4e5f6a7b8c9d0', api });
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('Could not resolve the alert')).toBeInTheDocument();
    expect(screen.getByText('Boom · Request req-7')).toBeInTheDocument();
  });

  it('has no Resolve button for resolved alerts', () => {
    renderList(
      [alertOf({ status: 'resolved', resolved_by: 'auto', resolved_at: new Date().toISOString() })],
      {
        expandedId: '65f2a1b2c3d4e5f6a7b8c9d0',
      },
    );
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(screen.getByText(/\(automatically\)/)).toBeInTheDocument();
  });
});

describe('SummaryTiles', () => {
  const counts = { critical: 1, high: 2, medium: 0, low: 0 };

  it('shows each severity count and the total', () => {
    renderWithProviders(<SummaryTiles counts={counts} status="active" selected={[]} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /Critical\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /High\s*2/ })).toBeInTheDocument();
    expect(screen.getByText('Active alerts')).toBeInTheDocument();
    expect(screen.getByText('3 APIs affected')).toBeInTheDocument();
  });

  it('toggles the severity filter and reflects the selection', async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <SummaryTiles counts={counts} status="active" selected={['high']} onToggle={onToggle} />,
    );
    expect(screen.getByRole('button', { name: /High/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Critical/ }));
    expect(onToggle).toHaveBeenCalledWith('critical');
  });

  it('shows skeletons while counts are loading', () => {
    renderWithProviders(
      <SummaryTiles counts={undefined} status="resolved" selected={[]} onToggle={() => {}} />,
    );
    expect(screen.getByText('Resolved alerts')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('row highlight', () => {
  it('applies the flash class to highlighted rows', async () => {
    renderWithProviders(
      <AlertList
        alerts={[alertOf({ id: 'h1' })]}
        expandedId={null}
        onToggle={() => {}}
        highlighted={new Set(['h1'])}
      />,
    );
    await waitFor(() => expect(screen.getByRole('listitem')).toHaveClass('row-flash'));
  });
});
