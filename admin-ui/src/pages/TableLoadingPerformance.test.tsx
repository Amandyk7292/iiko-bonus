import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import type { AdminUser } from '../lib/api';
import CustomersPage from './CustomersPage';
import OrdersPage from './OrdersPage';
import TransactionsPage from './TransactionsPage';

const api = vi.hoisted(() => ({
  getCustomers: vi.fn(),
  getOrders: vi.fn(),
  getTransactions: vi.fn(),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api,
}));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));
vi.mock('../components/DeliveryAvailabilityNotice', () => ({ default: () => null }));
vi.mock('../components/DeliveryBudget', () => ({ default: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/admin/');
});
afterEach(() => vi.useRealTimers());

describe.each(['customers', 'orders', 'transactions'] as const)(
  '%s loading responsiveness',
  (page) => {
    const load = () =>
      page === 'customers'
        ? api.getCustomers
        : page === 'orders'
          ? api.getOrders
          : api.getTransactions;
    const delay = page === 'transactions' ? 350 : 250;
    const show = () =>
      render(
        <BrowserRouter basename="/admin">
          <I18nProvider>
            {page === 'customers' ? (
              <CustomersPage user={{ actions: ['customers:read'] } as AdminUser} />
            ) : page === 'orders' ? (
              <OrdersPage />
            ) : (
              <TransactionsPage />
            )}
          </I18nProvider>
        </BrowserRouter>,
      );
    const empty = () => ({ [page]: [], total: 100 });
    const populated = () => ({
      [page]:
        page === 'customers'
          ? [{ id: 'current', name: 'Гость', balance: 0 }]
          : page === 'orders'
            ? [
                {
                  id: 'current',
                  number: 1,
                  amount: 100,
                  items: [],
                  orderType: 'pickup',
                  paymentStatus: 'paid',
                  orderStatus: 'accepted',
                  branch: 'Точка',
                  createdAt: '2026-10-03T08:00:00Z',
                  updatedAt: '2026-10-03T08:00:00Z',
                },
              ]
            : [
                {
                  id: 'current',
                  type: 'deposit',
                  amount: 100,
                  timestamp: '2026-10-03T08:00:00Z',
                  customers: { name: 'Гость', phone: '77000000000' },
                },
              ],
      total: 100,
    });

    it('starts on opening and pagination immediately without the search delay', async () => {
      load().mockResolvedValue(populated());
      show();
      expect(load()).toHaveBeenCalledTimes(1);
      await act(async () => {});
      fireEvent.click(
        screen.getByRole('button', {
          name: page === 'transactions' ? 'Далее' : 'Следующая страница',
        }),
      );
      expect(load()).toHaveBeenCalledTimes(2);
      expect(load().mock.calls[1][0].page).toBe(2);
      expect(load().mock.calls[0][1].aborted).toBe(true);
      await act(async () => {});
    });

    it('debounces typing, aborts the old read immediately and ignores its late answer', async () => {
      let answer!: (value: unknown) => void;
      load()
        .mockResolvedValueOnce(populated())
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValue(empty());
      const view = show();
      await act(async () => {});
      const search = screen.getByRole('searchbox');
      fireEvent.change(search, { target: { value: 'старый' } });
      await act(async () => vi.advanceTimersByTimeAsync(delay));
      const oldSignal = load().mock.calls[1][1] as AbortSignal;
      fireEvent.change(search, { target: { value: 'Г' } });
      fireEvent.change(search, { target: { value: 'Гость' } });
      expect(oldSignal.aborted).toBe(true);
      expect(load()).toHaveBeenCalledTimes(2);
      await act(async () => answer({ [page]: [], total: 999 }));
      await act(async () => vi.advanceTimersByTimeAsync(delay - 1));
      expect(load()).toHaveBeenCalledTimes(2);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(load()).toHaveBeenCalledTimes(3);
      expect(load().mock.calls[2][0].search).toBe('Гость');
      const currentSignal = load().mock.calls[2][1] as AbortSignal;
      view.unmount();
      expect(currentSignal.aborted).toBe(true);
    });
  },
);
