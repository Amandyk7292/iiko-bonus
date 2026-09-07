import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import type { AdminOrder } from '../lib/api';
import OrdersPage from './OrdersPage';

const apiMocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  getCouriers: vi.fn(),
  assignCourier: vi.fn(),
  updateDeliveryStatus: vi.fn(),
  updateOrderStatus: vi.fn(),
  getDeliveryProof: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: vi.fn(),
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast }),
}));
vi.mock('./DispatchPage', () => ({
  OrderYandexDelivery: ({ orderId }: { orderId: string }) => (
    <div data-testid="yandex-order">{orderId}</div>
  ),
}));

const order: AdminOrder = {
  id: 'order-100039',
  number: 100039,
  paymentStatus: 'paid',
  paymentProvider: 'forte',
  orderStatus: 'accepted',
  amount: 3500,
  subtotal: 3500,
  discount: 0,
  branch: 'ЖК Дукат',
  branchId: 'branch-1',
  orderType: 'delivery',
  deliveryStatus: 'unassigned',
  items: [{ name: 'Плюшка Московская', quantity: 1, price: 3500 }],
  earnedBonus: 35,
  createdAt: '2026-08-05T08:00:00.000Z',
  updatedAt: '2026-08-05T08:00:00.000Z',
  customer: { name: 'Амандық', phone: '77762003590' },
};

const renderPage = (role = 'branch_manager') => {
  window.history.replaceState({}, '', '/admin/orders');
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <OrdersPage role={role} />
      </I18nProvider>
    </BrowserRouter>,
  );
};

describe('Orders workspace permissions and refund flow', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    vi.clearAllMocks();
    apiMocks.getOrders.mockResolvedValue({ orders: [order], total: 1, page: 1, pageSize: 50 });
  });

  it('submits cancellation with a customer-visible reason without internal courier assignment', async () => {
    const user = userEvent.setup();
    apiMocks.updateOrderStatus.mockResolvedValue({
      success: true,
      order: {
        ...order,
        paymentStatus: 'refunded',
        orderStatus: 'cancelled',
        cancellationReason: 'Товара нет в наличии',
      },
    });
    renderPage();

    const row = (await screen.findByText('№100039')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Амандық')).toBeInTheDocument();

    expect(screen.queryByRole('combobox', { name: 'Назначить курьера' })).not.toBeInTheDocument();
    expect(apiMocks.getCouriers).not.toHaveBeenCalled();
    expect(apiMocks.assignCourier).not.toHaveBeenCalled();

    await user.click(screen.getByRole('combobox', { name: 'Изменить статус' }));
    await user.click(screen.getByRole('option', { name: 'Отменён' }));
    const reason = await screen.findByLabelText('Причина отмены (увидит клиент)');
    await user.type(reason, '  Товара нет в наличии  ');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(apiMocks.updateOrderStatus).toHaveBeenCalledWith(
        'order-100039',
        'cancelled',
        'Товара нет в наличии',
      ),
    );
    expect(await screen.findByText('Возвращён')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      'Заказ отменён, возврат отправлен через исходный способ оплаты',
    );
  });

  it('opens the selected order Yandex workflow and keeps courier history read-only', async () => {
    apiMocks.getOrders.mockResolvedValue({
      orders: [
        {
          ...order,
          deliveryProvider: 'yandex',
          deliveryStatus: 'assigned',
          courier: {
            id: 'courier-1',
            name: 'Айбек',
            phone: '77010000001',
            transportType: 'car',
            vehicle: 'Авто',
          },
        },
      ],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText('Айбек · Автокурьер · Авто · 77010000001')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Курьер назначен' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Яндекс Go' }));
    expect(await screen.findByTestId('yandex-order')).toHaveTextContent('order-100039');
    expect(apiMocks.getCouriers).not.toHaveBeenCalled();
    expect(apiMocks.updateDeliveryStatus).not.toHaveBeenCalled();
  });

  it('keeps order and refund mutations unavailable to a viewer', async () => {
    apiMocks.getOrders.mockResolvedValue({
      orders: [{ ...order, trackingUrl: 'https://example.com/tracking/100039' }],
      total: 1,
    });
    renderPage('viewer');

    const row = (await screen.findByText('№100039')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Принят')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Изменить статус' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Назначить курьера' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Яндекс Go' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('yandex-order')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Отследить' })).toHaveAttribute(
      'href',
      'https://example.com/tracking/100039',
    );
  });

  it('offers an explicit retry after a list failure', async () => {
    const user = userEvent.setup();
    apiMocks.getOrders
      .mockRejectedValueOnce(new Error('orders offline'))
      .mockResolvedValueOnce({ orders: [], total: 0, page: 1, pageSize: 50 });
    renderPage();

    expect(await screen.findByText('orders offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Заказов пока нет')).toBeInTheDocument();
  });
});
