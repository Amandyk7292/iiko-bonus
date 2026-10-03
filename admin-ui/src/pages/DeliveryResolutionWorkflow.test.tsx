import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from '../lib/router';
import { I18nProvider } from '../lib/i18n';
import KitchenPage from './KitchenPage';
import OrdersPage from './OrdersPage';

const api = vi.hoisted(() => ({
  getOrders: vi.fn(),
  getKitchenOrders: vi.fn(),
  reviewDeliveryResolution: vi.fn(),
  updateKitchenStatus: vi.fn(),
  updateOrderStatus: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const alarm = vi.hoisted(() => ({
  connectionStatus: 'online',
  playOrderAlarm: vi.fn(() => true),
  stopOrderAlarm: vi.fn(),
  setSoundEnabled: vi.fn(),
  unlockSound: vi.fn(),
  soundEnabled: true,
  soundReady: true,
}));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: vi.fn(),
  useAdminRealtime: () => alarm,
}));
vi.mock('../components/Feedback', () => ({ useFeedback: () => ({ toast }) }));

const pending = {
  id: 'ready-delivery',
  number: 100071,
  paymentStatus: 'paid',
  orderStatus: 'ready',
  kitchenStatus: 'ready',
  orderType: 'delivery',
  fulfillmentType: 'delivery',
  effectiveFulfillmentType: 'delivery',
  amount: 4200,
  subtotal: 3900,
  deliveryFee: 300,
  discount: 0,
  earnedBonus: 39,
  branch: 'ЖК Дукат',
  items: [{ name: 'Круассан', quantity: 2 }],
  createdAt: '2026-10-03T05:00:00Z',
  updatedAt: '2026-10-03T05:40:00Z',
  acceptedAt: '2026-10-03T05:01:00Z',
  acceptedBy: 'Айжан',
  deliveryResolution: {
    id: 'a8710c5c-a61c-45db-8aa1-6ac854c7db0a',
    status: 'pickup_pending_approval',
    reason: 'courier_not_found',
    requestedAt: '2026-10-03T05:40:00Z',
    pickupTime: '2026-10-03T12:00:00Z',
  },
};
const accepted = {
  ...pending,
  orderType: 'pickup',
  fulfillmentType: 'pickup',
  effectiveFulfillmentType: 'pickup',
  deliveryResolution: { ...pending.deliveryResolution, status: 'pickup_accepted' },
};
function open(page: 'orders' | 'kitchen', role = 'cashier') {
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        {page === 'orders' ? <OrdersPage role={role} /> : <KitchenPage />}
      </I18nProvider>
    </BrowserRouter>,
  );
}
beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  vi.clearAllMocks();
  api.getOrders.mockResolvedValue({ orders: [pending], total: 1 });
  api.getKitchenOrders.mockResolvedValue({ orders: [pending] });
  api.reviewDeliveryResolution.mockReset();
});

describe('delivery replacement approval', () => {
  for (const page of ['orders', 'kitchen'] as const) {
    it(`${page} waits for confirmed approval and sends one review with its resolution identity`, async () => {
      const user = userEvent.setup();
      let complete!: (result: unknown) => void;
      api.reviewDeliveryResolution.mockReturnValue(
        new Promise((resolve) => {
          complete = resolve;
        }),
      );
      open(page);
      expect(await screen.findByText('Замена доставки')).toBeInTheDocument();
      expect(
        screen.getByText('Клиент выбрал самовывоз', {
          selector: '.delivery-resolution-notice span',
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Самовывоз подтверждён')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Передать курьеру' })).not.toBeInTheDocument();
      expect(screen.queryByText('Принял: Айжан')).not.toBeInTheDocument();
      if (page === 'orders')
        expect(screen.getByRole('combobox', { name: 'Изменить статус' })).toBeDisabled();
      const approve = screen.getByRole('button', { name: 'Принять самовывоз' });
      await user.dblClick(approve);
      expect(api.reviewDeliveryResolution).toHaveBeenCalledTimes(1);
      expect(api.reviewDeliveryResolution).toHaveBeenCalledWith(
        pending.id,
        'accept',
        pending.deliveryResolution.id,
      );
      expect(screen.queryByText('Самовывоз подтверждён')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Отклонить самовывоз' })).toBeDisabled();
      if (page === 'kitchen') expect(alarm.stopOrderAlarm).not.toHaveBeenCalled();
      api.getOrders.mockResolvedValue({ orders: [accepted], total: 1 });
      api.getKitchenOrders.mockResolvedValue({ orders: [accepted] });
      await act(async () => complete({ success: true, order: accepted }));
      expect(await screen.findByText('Самовывоз подтверждён')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Принять самовывоз' })).not.toBeInTheDocument();
      if (page === 'kitchen')
        expect(screen.getByRole('button', { name: 'Выдать клиенту' })).toBeInTheDocument();
      expect(api.updateOrderStatus).not.toHaveBeenCalled();
      expect(api.updateKitchenStatus).not.toHaveBeenCalled();
    });
  }

  it('cashier rejection confirms cancellation and reflects the existing pending refund state', async () => {
    const user = userEvent.setup();
    const rejected = {
      ...pending,
      orderStatus: 'cancelled',
      kitchenStatus: 'cancelled',
      refundStatus: 'processing',
      deliveryResolution: { ...pending.deliveryResolution, status: 'pickup_rejected' },
    };
    api.reviewDeliveryResolution.mockResolvedValue({ order: rejected });
    open('orders');
    await user.click(await screen.findByRole('button', { name: 'Отклонить самовывоз' }));
    const dialog = screen.getByRole('dialog', { name: 'Отклонить самовывоз' });
    expect(
      within(dialog).getByText('Заказ будет отменён. Оплата будет возвращена.'),
    ).toBeInTheDocument();
    expect(api.reviewDeliveryResolution).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() =>
      expect(api.reviewDeliveryResolution).toHaveBeenCalledWith(
        pending.id,
        'reject',
        pending.deliveryResolution.id,
      ),
    );
    expect(await screen.findByText('Самовывоз отклонён')).toBeInTheDocument();
    expect(screen.getByText('Возврат сверяется')).toBeInTheDocument();
    expect(api.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('reconciles a conflict with another cashier and does not claim a failed acceptance', async () => {
    const user = userEvent.setup();
    api.reviewDeliveryResolution.mockRejectedValue(new Error('Запрос уже обработан'));
    open('orders');
    await screen.findByRole('button', { name: 'Принять самовывоз' });
    api.getOrders.mockResolvedValue({ orders: [accepted], total: 1 });
    await user.click(screen.getByRole('button', { name: 'Принять самовывоз' }));
    expect(await screen.findByText('Самовывоз подтверждён')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith('Запрос уже обработан', 'error');
    expect(api.reviewDeliveryResolution).toHaveBeenCalledTimes(1);
  });

  it('viewer sees the request without cashier controls; provider cancellation remains unapproved', async () => {
    api.getOrders.mockResolvedValue({
      orders: [
        {
          ...pending,
          deliveryResolution: { ...pending.deliveryResolution, status: 'pickup_cancelling' },
        },
      ],
      total: 1,
    });
    open('orders', 'viewer');
    expect(await screen.findByText('Самовывоз запрошен')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Принять самовывоз' })).not.toBeInTheDocument();
    expect(screen.queryByText('Самовывоз подтверждён')).not.toBeInTheDocument();
  });
  for (const role of ['viewer', 'operator', 'editor']) {
    it(`${role} cannot review a cashier pickup request`, async () => {
      open('orders', role);
      expect(await screen.findByText('Клиент выбрал самовывоз')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Принять самовывоз' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Отклонить самовывоз' })).not.toBeInTheDocument();
    });
  }
  for (const status of [
    'pending',
    'pickup_cancelling',
    'cancel_cancelling',
    'pickup_accepting',
    'pickup_rejecting',
    'cancel_refunding',
  ]) {
    it(`blocks repeated review and ordinary handoff while ${status}`, async () => {
      const processing = {
        ...pending,
        deliveryResolution: { ...pending.deliveryResolution, status },
      };
      api.getKitchenOrders.mockResolvedValue({ orders: [processing] });
      open('kitchen');
      await screen.findByText('№100071');
      expect(screen.queryByRole('button', { name: 'Принять самовывоз' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Передать курьеру' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Принять заказ' })).not.toBeInTheDocument();
      expect(screen.queryByText('Самовывоз подтверждён')).not.toBeInTheDocument();
    });
  }
});
