import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { AdminRealtimeProvider, useAdminRealtime } from './admin-realtime';

vi.mock('./api', () => ({ api: { getOperationsSummary: vi.fn() } }));

class FakeEventSource {
  static CLOSED = 2;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function Probe() {
  const { summary, refreshSummary } = useAdminRealtime();
  return (
    <>
      <output>{JSON.stringify(summary)}</output>
      <button onClick={() => void refreshSummary()}>Refresh</button>
    </>
  );
}

type Summary = Awaited<ReturnType<typeof api.getOperationsSummary>>;
const summary = (marker: string) =>
  ({ counts: {}, capabilities: {}, orders: [], marker }) as unknown as Summary;
const host = (branchId: string) => (
  <AdminRealtimeProvider branchId={branchId} role="manager">
    <Probe />
  </AdminRealtimeProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', FakeEventSource);
  localStorage.setItem('adminOrderSoundEnabled', 'false');
});

it('loads the newly selected branch immediately and ignores a late previous branch response', async () => {
  let finishOld!: (value: Summary) => void;
  let finishNew!: (value: Summary) => void;
  vi.mocked(api.getOperationsSummary)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  const view = render(host('branch-a'));
  view.rerender(host('branch-b'));
  expect(api.getOperationsSummary).toHaveBeenCalledTimes(2);
  await act(async () => finishOld(summary('old-branch')));
  expect(screen.getByRole('status')).toHaveTextContent('null');
  // Completion of the old request must not clear the new request's lock.
  fireEvent.click(screen.getByText('Refresh'));
  expect(api.getOperationsSummary).toHaveBeenCalledTimes(2);
  await act(async () => finishNew(summary('new-branch')));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('new-branch'));
});

it('keeps new branch results when an old response finishes last', async () => {
  let finishOld!: (value: Summary) => void;
  vi.mocked(api.getOperationsSummary)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce(summary('new-branch'));
  const view = render(host('branch-a'));
  view.rerender(host('branch-b'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('new-branch'));
  await act(async () => finishOld(summary('old-branch')));
  expect(screen.getByRole('status')).toHaveTextContent('new-branch');
});
