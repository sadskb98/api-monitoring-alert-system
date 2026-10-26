import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/client.js';
import { useSubmitBatch } from '../../src/api/hooks.js';
import { SubmitBatchPanel } from '../../src/components/SubmitBatchPanel.jsx';
import { DEFAULT_BATCH_TEXT, SAMPLES } from '../../src/components/samples.js';
import { batchResultOf, fakeApi, renderWithProviders } from '../helpers.jsx';

function Harness({ onClose = () => {} }) {
  const [text, setText] = useState(DEFAULT_BATCH_TEXT);
  const submit = useSubmitBatch();
  return <SubmitBatchPanel open onClose={onClose} text={text} onTextChange={setText} submit={submit} />;
}

const editor = () => screen.getByRole('textbox', { name: 'Batch JSON' });
const submitButton = () => screen.getByRole('button', { name: 'Submit' });

describe('SubmitBatchPanel', () => {
  it('starts with the spec example and a valid status', () => {
    renderWithProviders(<Harness />);
    expect(editor()).toHaveValue(DEFAULT_BATCH_TEXT);
    expect(screen.getByText('Valid JSON · 2 records')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('disables Submit while the JSON is invalid', () => {
    renderWithProviders(<Harness />);
    fireEvent.change(editor(), { target: { value: '[{"api_name": ' } });
    expect(screen.getByText(/^Invalid JSON:/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('loads a sample into the editor', async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Mixed' }));
    expect(editor()).toHaveValue(SAMPLES.find((s) => s.id === 'mixed').text);
    expect(screen.getByText('Valid JSON · 7 records')).toBeInTheDocument();
  });

  it('submits the editor text and shows the result', async () => {
    const { api } = renderWithProviders(<Harness />);
    await userEvent.click(submitButton());
    expect(api.submitBatch).toHaveBeenCalledWith(DEFAULT_BATCH_TEXT);

    const result = await screen.findByRole('region', { name: 'Batch result' });
    expect(result).toHaveTextContent('2received');
    expect(result).toHaveTextContent('1created');
    expect(result).toHaveTextContent('Alert text: AI-generated');
    expect(result).toHaveTextContent('gemini-3.7-flash · 1840 ms');
    expect(result).toHaveTextContent('AppointmentAPI');
  });

  it('submits with Ctrl+Enter', async () => {
    const { api } = renderWithProviders(<Harness />);
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.submitBatch).toHaveBeenCalledTimes(1));
  });

  it('lists rejected records from a partially valid batch', async () => {
    const api = fakeApi({
      submitBatch: vi.fn(async () =>
        batchResultOf({
          received: 7,
          accepted: 6,
          rejected: [{ index: 6, issues: [{ path: 'api_name', message: 'Required' }] }],
        }),
      ),
    });
    renderWithProviders(<Harness />, { api });
    await userEvent.click(submitButton());
    expect(await screen.findByText('Rejected records (1)')).toBeInTheDocument();
    expect(screen.getByText('#6')).toBeInTheDocument();
    expect(screen.getByText('api_name')).toBeInTheDocument();
  });

  it('shows a 400 with its per-record issues and request id', async () => {
    const api = fakeApi({
      submitBatch: vi.fn(async () => {
        throw new ApiError({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'No valid observations in batch',
          details: [{ index: 0, issues: [{ path: 'api_name', message: 'Required' }] }],
          requestId: 'req-42',
        });
      }),
    });
    renderWithProviders(<Harness />, { api });
    await userEvent.click(submitButton());
    expect(await screen.findByText('No valid observations in batch')).toBeInTheDocument();
    expect(screen.getByText('VALIDATION_ERROR · HTTP 400 · request req-42')).toBeInTheDocument();
    expect(screen.getByText('#0')).toBeInTheDocument();
  });

  it('shows a network error', async () => {
    const api = fakeApi({
      submitBatch: vi.fn(async () => {
        throw new ApiError({ status: 0, code: 'NETWORK', message: "Can't reach the API at http://api.test" });
      }),
    });
    renderWithProviders(<Harness />, { api });
    await userEvent.click(submitButton());
    expect(await screen.findByText("Can't reach the API at http://api.test")).toBeInTheDocument();
  });

  it('shows elapsed time and locks the editor while processing', async () => {
    let release;
    const api = fakeApi({
      submitBatch: vi.fn(() => new Promise((resolve) => (release = () => resolve(batchResultOf())))),
    });
    renderWithProviders(<Harness />, { api });
    await userEvent.click(submitButton());
    expect(await screen.findByText(/Processing…/)).toBeInTheDocument();
    expect(editor()).toHaveAttribute('readonly');
    release();
    expect(await screen.findByRole('region', { name: 'Batch result' })).toBeInTheDocument();
  });

  it('loads an uploaded .json file into the editor', async () => {
    renderWithProviders(<Harness />);
    const file = new File(['[{"api_name":"Uploaded"}]'], 'batch.json', { type: 'application/json' });
    await userEvent.upload(screen.getByTestId('batch-file'), file);
    expect(await screen.findByText('Valid JSON · 1 record')).toBeInTheDocument();
    expect(editor()).toHaveValue('[{"api_name":"Uploaded"}]');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    renderWithProviders(<Harness onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
