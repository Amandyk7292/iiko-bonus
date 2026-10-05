import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import CashierSyncStatus from './CashierSyncStatus';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/api', () => ({ request: mocks.request }));
const status = { state: 'ok', lastSuccessAt: '2026-10-05T05:00:00Z',
  lastAttemptAt: '2026-10-05T05:00:00Z', lastFailureAt: null, failureSince: null,
  consecutiveFailures: 0, cashierCount: 71 };
const view = (active = true) => <I18nProvider><CashierSyncStatus active={active} /></I18nProvider>;
describe('cashier directory synchronization status', () => {
  beforeEach(() => { localStorage.setItem('adminLocale', 'ru'); mocks.request.mockReset(); });
  it('shows persisted successful time and a visible failure alert, then clears it after recovery', async () => {
    mocks.request.mockResolvedValueOnce({ success: true, status: { ...status, state: 'error' } });
    render(view());
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить базу сотрудников');
    expect(document.querySelector('time')).toHaveAttribute('dateTime', status.lastSuccessAt);
    expect(document.querySelector('time')).toHaveTextContent('10:00');
    mocks.request.mockResolvedValueOnce({ success: true, status });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить состояние' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Обновлена');
  });
  it('retains last successful update on network failure and never presents failure as a fresh update', async () => {
    mocks.request.mockResolvedValueOnce({ success: true, status });
    render(view());
    await screen.findByText('Обновлена');
    mocks.request.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить состояние' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить');
    expect(document.querySelector('time')).toHaveAttribute('dateTime', status.lastSuccessAt);
  });
  it('does not poll inactive sections and ignores a response after deactivation', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { rerender } = render(view(false));
    expect(mocks.request).not.toHaveBeenCalled();
    rerender(view());
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    rerender(view(false));
    await act(async () => resolve({ success: true, status: { ...status, state: 'error' } }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
