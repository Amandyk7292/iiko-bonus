import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BrowserRouter } from '../lib/router';
import { I18nProvider } from '../lib/i18n';
import type { AdminOrder } from '../lib/api';
import CustomersPage from './CustomersPage';
import OrdersPage from './OrdersPage';

const api = vi.hoisted(() => ({ getCustomers: vi.fn(), getOrders: vi.fn() }));
const realtime = vi.hoisted(() => ({ refreshOrders: () => {} }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: (events: string[], refresh: () => void) => {
    if (events.includes('order.updated')) realtime.refreshOrders = refresh;
  },
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const customerResult = (name: string) => ({ customers: [{ id: name, name }], total: 1 });
const orderResult = (number: number) => ({
  orders: [
    {
      id: `order-${number}`,
      number,
      paymentStatus: 'paid',
      orderStatus: 'accepted',
      orderType: 'pickup',
      amount: 100,
      subtotal: 100,
      discount: 0,
      branch: 'Тестовый филиал',
      earnedBonus: 3,
      items: [],
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:00:00Z',
    } satisfies AdminOrder,
  ],
  total: 1,
});

function show(page: 'customers' | 'orders') {
  window.history.replaceState({}, '', `/admin/${page}`);
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        {page === 'customers' ? <CustomersPage user={null} /> : <OrdersPage role="viewer" />}
      </I18nProvider>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('adminLocale', 'ru');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('invalidates customer results during the next search debounce and keeps export disabled', async () => {
  const previous = deferred<ReturnType<typeof customerResult>>();
  const latest = deferred<ReturnType<typeof customerResult>>();
  api.getCustomers
    .mockResolvedValueOnce(customerResult('Исходный гость'))
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(latest.promise);
  show('customers');
  await screen.findByText('Исходный гость');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'предыдущий' } });
  await waitFor(() => expect(api.getCustomers).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'новый' } });
  await act(async () => previous.resolve(customerResult('Старый ответ')));
  expect(screen.queryByText('Старый ответ')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Экспорт страницы' })).toBeDisabled();
  await waitFor(() => expect(api.getCustomers).toHaveBeenCalledTimes(3));
  await act(async () => latest.resolve(customerResult('Новый гость')));
  expect(screen.getByText('Новый гость')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Экспорт страницы' })).toBeEnabled();
});

it('ignores a failed old customer search after the latest search succeeds', async () => {
  const previous = deferred<ReturnType<typeof customerResult>>();
  const latest = deferred<ReturnType<typeof customerResult>>();
  api.getCustomers
    .mockResolvedValueOnce(customerResult('Исходный гость'))
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(latest.promise);
  show('customers');
  await screen.findByText('Исходный гость');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'предыдущий' } });
  await waitFor(() => expect(api.getCustomers).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'новый' } });
  await waitFor(() => expect(api.getCustomers).toHaveBeenCalledTimes(3));
  await act(async () => latest.resolve(customerResult('Новый гость')));
  await act(async () => previous.reject(new Error('Устаревшая ошибка клиентов')));
  expect(screen.getByText('Новый гость')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['success', 'failure'] as const)(
  'ignores a late order search %s after a newer search succeeds',
  async (outcome) => {
    const previous = deferred<ReturnType<typeof orderResult>>();
    const latest = deferred<ReturnType<typeof orderResult>>();
    api.getOrders
      .mockResolvedValueOnce(orderResult(100))
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(latest.promise);
    show('orders');
    await screen.findByText('№100');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '200' } });
    await waitFor(() => expect(api.getOrders).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '300' } });
    await waitFor(() => expect(api.getOrders).toHaveBeenCalledTimes(3));
    await act(async () => latest.resolve(orderResult(300)));
    await act(async () => {
      if (outcome === 'success') previous.resolve(orderResult(200));
      else previous.reject(new Error('Устаревшая ошибка заказов'));
    });
    expect(screen.getByText('№300')).toBeInTheDocument();
    expect(screen.queryByText('№200')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled();
  },
);

it('finishes the loading state when realtime supersedes the first order request', async () => {
  const initial = deferred<ReturnType<typeof orderResult>>();
  const refresh = deferred<ReturnType<typeof orderResult>>();
  api.getOrders.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refresh.promise);
  show('orders');
  await waitFor(() => expect(api.getOrders).toHaveBeenCalledTimes(1));
  act(() => realtime.refreshOrders());
  await act(async () => refresh.resolve(orderResult(300)));
  expect(screen.getByText('№300')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled();
  await act(async () => initial.reject(new Error('Устаревшая ошибка заказов')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps an actionable error when a realtime takeover of initial loading fails', async () => {
  const initial = deferred<ReturnType<typeof orderResult>>();
  const refresh = deferred<ReturnType<typeof orderResult>>();
  api.getOrders.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refresh.promise);
  show('orders');
  await waitFor(() => expect(api.getOrders).toHaveBeenCalledTimes(1));
  act(() => realtime.refreshOrders());
  await act(async () => refresh.reject(new Error('Заказы недоступны')));
  expect(screen.getByText('Заказы недоступны')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
  await act(async () => initial.resolve(orderResult(100)));
  expect(screen.getByText('Заказы недоступны')).toBeInTheDocument();
  expect(screen.queryByText('№100')).not.toBeInTheDocument();
});

it.each(['customers', 'orders'] as const)(
  'keeps the %s search focused and editable while refining an empty result',
  async (page) => {
    const pending = deferred<never>();
    const load = page === 'customers' ? api.getCustomers : api.getOrders;
    load.mockResolvedValueOnce({ customers: [], orders: [], total: 0 });
    load.mockReturnValue(pending.promise);
    show(page);
    const search = await screen.findByRole('searchbox');
    search.focus();
    fireEvent.change(search, { target: { value: 'новый поиск' } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('searchbox')).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue('новый поиск');
    fireEvent.change(search, { target: { value: 'другой поиск' } });
    expect(search).toHaveValue('другой поиск');
  },
);
