import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminRealtimeProvider } from '../lib/admin-realtime';
import { BrowserRouter } from '../lib/router';
import { I18nProvider } from '../lib/i18n';
import { api } from '../lib/api';
import OperationsPage from './OperationsPage';

vi.mock('../lib/api', () => ({ api: { getOperationsSummary: vi.fn() } }));

class FakeEventSource {
  static CLOSED = 2;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

type Summary = Awaited<ReturnType<typeof api.getOperationsSummary>>;
const summary = (number = 100039): Summary => ({
  success: true,
  updatedAt: '2026-09-07T10:00:00Z',
  capabilities: {
    orders: true,
    kitchen: false,
    dispatch: false,
    support: false,
    whatsapp: false,
    inventory: false,
  },
  counts: {
    newOrders: 1,
    activeOrders: 1,
    kitchenOverdue: 0,
    deliveryAttention: 0,
    paymentIssues: 0,
    supportNew: 0,
    supportOverdue: 0,
    supportMine: 0,
    whatsappUnread: 0,
    whatsappDialogs: 0,
    stoppedProducts: 0,
  },
  orders: [
    {
      id: `order-${number}`,
      number,
      amount: 100,
      branchId: 'branch-a',
      branch: 'Тестовый филиал',
      paymentStatus: 'paid',
      orderStatus: 'new',
      kitchenStatus: null,
      deliveryStatus: null,
      promisedReadyAt: null,
      createdAt: '2026-09-07T09:00:00Z',
      lastError: null,
    },
  ],
  support: [],
  whatsapp: [],
});

function deferred() {
  let resolve!: (value: Summary) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Summary>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const host = (branchId = 'branch-a') => (
  <BrowserRouter basename="/admin">
    <I18nProvider>
      <AdminRealtimeProvider role="admin" branchId={branchId}>
        <OperationsPage />
      </AdminRealtimeProvider>
    </I18nProvider>
  </BrowserRouter>
);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('EventSource', FakeEventSource);
  localStorage.setItem('adminLocale', 'ru');
  localStorage.setItem('adminOrderSoundEnabled', 'false');
  window.history.replaceState({}, '', '/admin/operations');
});

it.each(['Failed to fetch', 'HTTP 500'])(
  'replaces initial %s failure with an error and loads successfully after manual retry',
  async (message) => {
    const retry = deferred();
    vi.mocked(api.getOperationsSummary)
      .mockRejectedValueOnce(new Error(message))
      .mockReturnValueOnce(retry.promise);
    render(host());
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    await act(async () => retry.resolve(summary()));
    expect(screen.getByText('Заказ №100039')).toBeInTheDocument();
    expect(screen.getByText('Новый')).toBeInTheDocument();
    expect(screen.queryByText('new')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled();
    expect(api.getOperationsSummary).toHaveBeenCalledTimes(2);
  },
);

it('retains the last summary with a warning until a failed refresh is retried successfully', async () => {
  const retry = deferred();
  vi.mocked(api.getOperationsSummary)
    .mockResolvedValueOnce(summary())
    .mockRejectedValueOnce(new Error('HTTP 500'))
    .mockReturnValueOnce(retry.promise);
  render(host());
  await screen.findByText('Заказ №100039');
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Не удалось обновить сводку. Показаны последние загруженные данные.',
  );
  expect(screen.getByText('Заказ №100039')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  await act(async () => retry.resolve(summary(100040)));
  expect(screen.getByText('Заказ №100040')).toBeInTheDocument();
  expect(screen.queryByText('Заказ №100039')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('treats a malformed summary response as an actionable error instead of loading forever', async () => {
  vi.mocked(api.getOperationsSummary).mockResolvedValueOnce(null as unknown as Summary);
  render(host());
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные');
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
});

it('ignores an old branch failure after a different branch has loaded', async () => {
  const old = deferred();
  vi.mocked(api.getOperationsSummary)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(summary(100040));
  const view = render(host('branch-a'));
  view.rerender(host('branch-b'));
  await screen.findByText('Заказ №100040');
  await act(async () => old.reject(new Error('Old branch offline')));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Заказ №100040')).toBeInTheDocument();
});

it('uses a readable fallback for unrecognized order statuses', async () => {
  const response = summary();
  response.orders[0].orderStatus = 'unrecognized_provider_state';
  vi.mocked(api.getOperationsSummary).mockResolvedValueOnce(response);
  render(host());
  expect(await screen.findByText('Неизвестно')).toBeInTheDocument();
  expect(screen.queryByText('unrecognized_provider_state')).not.toBeInTheDocument();
});

it('opens delivery attention in orders instead of the retired dispatch workspace', async () => {
  const response = summary();
  response.capabilities.dispatch = true;
  response.counts.deliveryAttention = 1;
  vi.mocked(api.getOperationsSummary).mockResolvedValueOnce(response);
  render(host());
  expect(await screen.findByRole('link', { name: /^Доставка/ })).toHaveAttribute(
    'href',
    '/admin/orders',
  );
});
