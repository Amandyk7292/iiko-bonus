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
    apiMocks.getCouriers.mockResolvedValue({
      couriers: [
        {
          id: 'courier-1',
          name: 'Айбек',
          phone: '77010000001',
          vehicle: 'Авто',
          transportType: 'car',
          active: true,
        },
      ],
    });
  });

  it('assigns a courier and submits cancellation with a customer-visible reason', async () => {
    const user = userEvent.setup();
    apiMocks.assignCourier.mockResolvedValue({
      success: true,
      order: {
        ...order,
        deliveryStatus: 'assigned',
        courier: {
          id: 'courier-1',
          name: 'Айбек',
          phone: '77010000001',
          vehicle: 'Авто',
          transportType: 'car',
          isAutomobile: true,
        },
      },
    });
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

    await user.click(screen.getByRole('combobox', { name: 'Назначить курьера' }));
    await user.click(screen.getByRole('option', { name: 'Айбек · Авто' }));
    await waitFor(() =>
      expect(apiMocks.assignCourier).toHaveBeenCalledWith(
        'order-100039',
        'courier-1',
        expect.any(String),
      ),
    );
    expect(await screen.findByText('Айбек · Автокурьер · Авто · 77010000001')).toBeInTheDocument();

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

  it('keeps order and refund mutations unavailable to a viewer', async () => {
    renderPage('viewer');

    const row = (await screen.findByText('№100039')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Принят')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Изменить статус' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Назначить курьера' })).not.toBeInTheDocument();
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
