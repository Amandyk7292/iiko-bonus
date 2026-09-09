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
  it('cashier can cancel an order but cannot dispatch or move it to other statuses', async () => {
    const user = userEvent.setup();
    apiMocks.updateOrderStatus.mockResolvedValue({ success: true, order: { ...order, orderStatus: 'cancelled', paymentStatus: 'refunded' } });
    renderPage('cashier');
    await screen.findByText('№100039');
    expect(screen.queryByRole('button', { name: 'Яндекс Go' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Изменить статус' }));
    expect(screen.getByRole('option', { name: 'Готовится' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'Отменён' }));
    await user.type(await screen.findByLabelText('Причина отмены (увидит клиент)'), 'Нет товара');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(apiMocks.updateOrderStatus).toHaveBeenCalledWith(order.id, 'cancelled', 'Нет товара'));
  });
  it('separates merchandise, discounts and the customer delivery fee from courier costs', async () => {
    apiMocks.getOrders.mockResolvedValue({
      orders: [
        { ...order, amount: 2506, subtotal: 35, deliveryFee: 2471, providerDeliveryPrice: 3000 },
        {
          ...order,
          id: 'free',
          number: 100044,
          amount: 10000,
          subtotal: 10000,
          deliveryFee: 0,
          orderType: 'preorder',
          preorderFulfillmentType: 'delivery',
        },
        {
          ...order,
          id: 'discount',
          number: 100045,
          amount: 1060.3,
          subtotal: 990,
          discount: 29.7,
          deliveryFee: 100,
        },
      ],
      total: 3,
    });
    renderPage();
    const row = (await screen.findByText('№100039')).closest('tr')!;
    const amounts = within(row).getByLabelText('Расчёт заказа');
    expect(amounts).toHaveTextContent(/Товары35 ₸Доставка2\s?471 ₸Итого2\s?506 ₸/);
    expect(amounts).not.toHaveTextContent(/3\s?000 ₸/);
    const free = within(screen.getByText('№100044').closest('tr')!).getByLabelText('Расчёт заказа');
    expect(free).toHaveTextContent('Доставка0 ₸');
    const discount = within(screen.getByText('№100045').closest('tr')!).getByLabelText(
      'Расчёт заказа',
    );
    expect(discount).toHaveTextContent(/Товары990 ₸Скидка−29,7 ₸Доставка100 ₸Итого1\s?060,3 ₸/);
  });

  it('shows pickup and preorder fulfillment, and past status steps without allowing reversal', async () => {
    localStorage.setItem('adminLocale', 'ru');
    const user = userEvent.setup();
    apiMocks.getOrders.mockResolvedValue({
      orders: [
        { ...order, id: 'pickup', number: 10, orderType: 'pickup', orderStatus: 'ready' },
        {
          ...order,
          id: 'preorder',
          number: 11,
          orderType: 'preorder',
          preorderFulfillmentType: 'delivery',
          pickupTime: '2026-09-10T12:00:00Z',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    renderPage();
    const pickup = (await screen.findByText('№10')).closest('tr')!;
    const preorder = screen.getByText('№11').closest('tr')!;
    expect(within(pickup).getByText('Самовывоз')).toBeInTheDocument();
    expect(within(preorder).getByText('Предзаказ')).toBeInTheDocument();
    expect(within(preorder).getAllByText('Доставка')).toHaveLength(2);
    expect(within(pickup).getByText('Самовывоз')).toHaveClass('fulfillment-pickup');
    expect(within(preorder).getByText('Предзаказ')).toHaveClass('fulfillment-preorder');
    expect(within(preorder).getAllByText('Доставка')[0]).toHaveClass('fulfillment-delivery');
    expect(within(preorder).getByRole('button', { name: 'Яндекс Go' })).toBeInTheDocument();
    await user.click(within(pickup).getByRole('combobox', { name: 'Изменить статус' }));
    expect(screen.getByRole('option', { name: 'Принят' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Готовится' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Завершён' })).not.toHaveAttribute('aria-disabled');
    await user.click(screen.getByRole('option', { name: 'Принят' }));
    expect(apiMocks.updateOrderStatus).not.toHaveBeenCalled();
  });
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

  it('closes cancellation while the bank confirms a refund and prevents another submission', async () => {
    const user = userEvent.setup();
    apiMocks.updateOrderStatus.mockResolvedValue({
      success: true,
      refundPending: true,
      order: { ...order, refundStatus: 'unknown' },
    });
    renderPage();
    await screen.findByText('№100039');
    await user.click(screen.getByRole('combobox', { name: 'Изменить статус' }));
    await user.click(screen.getByRole('option', { name: 'Отменён' }));
    await user.type(
      await screen.findByLabelText('Причина отмены (увидит клиент)'),
      'Тестовый заказ',
    );
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText('Возврат сверяется')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: 'Изменить статус' })).not.toBeInTheDocument();
    expect(apiMocks.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      'Возврат ожидает подтверждения банка. Статус обновится автоматически. Повторять возврат не нужно.',
      'info',
    );
    expect(screen.queryByText('Возвращён')).not.toBeInTheDocument();
  });

  it('keeps a declined refund visible as an error without reporting success', async () => {
    const user = userEvent.setup();
    apiMocks.updateOrderStatus.mockRejectedValue(new Error('Банк отклонил возврат'));
    renderPage();
    await screen.findByText('№100039');
    await user.click(screen.getByRole('combobox', { name: 'Изменить статус' }));
    await user.click(screen.getByRole('option', { name: 'Отменён' }));
    await user.type(
      await screen.findByLabelText('Причина отмены (увидит клиент)'),
      'Тестовый заказ',
    );
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Банк отклонил возврат', 'error'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Возврат сверяется')).not.toBeInTheDocument();
    expect(apiMocks.updateOrderStatus).toHaveBeenCalledTimes(1);
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
