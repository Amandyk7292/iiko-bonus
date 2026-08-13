import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import KitchenPage from './KitchenPage';

const apiMocks = vi.hoisted(() => ({
  getKitchenOrders: vi.fn(),
  updateKitchenStatus: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const realtimeMocks = vi.hoisted(() => ({
  connectionStatus: 'online' as string,
  playOrderAlarm: vi.fn(() => true),
  setSoundEnabled: vi.fn(),
  unlockSound: vi.fn(async () => true),
  soundEnabled: true,
  soundReady: true,
  useAdminRealtimeEvents: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: realtimeMocks.useAdminRealtimeEvents,
  useAdminRealtime: () => realtimeMocks,
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast }),
}));

const queuedOrder = {
  id: 'queued-1',
  number: 100041,
  branch: 'ЖК Дукат',
  kitchenStatus: 'queued',
  createdAt: '2026-08-05T08:00:00.000Z',
  preparationMinutes: 15,
  items: [{ id: 'item-1', name: 'Круассан', quantity: 2 }],
  substitutionPreference: 'call_customer',
};

const preparingOrder = {
  ...queuedOrder,
  id: 'preparing-1',
  number: 100042,
  kitchenStatus: 'preparing',
  kitchenStartedAt: '2026-08-05T08:05:00.000Z',
};

const readyOrder = {
  ...queuedOrder,
  id: 'ready-1',
  number: 100043,
  kitchenStatus: 'ready',
};

const renderPage = () =>
  render(
    <I18nProvider>
      <KitchenPage />
    </I18nProvider>,
  );

describe('Kitchen optimistic workflow', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    vi.clearAllMocks();
    apiMocks.getKitchenOrders.mockReset();
    apiMocks.updateKitchenStatus.mockReset();
    realtimeMocks.soundEnabled = true;
    realtimeMocks.soundReady = true;
    realtimeMocks.connectionStatus = 'online';
    apiMocks.getKitchenOrders.mockResolvedValue({
      orders: [queuedOrder, preparingOrder, readyOrder],
    });
  });

  it('keeps the alarm active until acceptance is server-confirmed while other orders remain independent', async () => {
    const user = userEvent.setup();
    let resolveStart!: (value: unknown) => void;
    const startRequest = new Promise((resolve) => {
      resolveStart = resolve;
    });
    apiMocks.updateKitchenStatus.mockImplementation(
      (id: string, status: string, minutes?: number) => {
        if (id === 'queued-1') return startRequest;
        const source = id === 'preparing-1' ? preparingOrder : readyOrder;
        return Promise.resolve({
          success: true,
          order: { ...source, kitchenStatus: status, preparationMinutes: minutes },
        });
      },
    );
    renderPage();

    const queuedTicket = (await screen.findByText('№100041')).closest('article');
    expect(queuedTicket).not.toBeNull();
    await user.click(within(queuedTicket!).getByRole('button', { name: 'Принять заказ' }));
    const minutes = await screen.findByLabelText('Время приготовления, минут');
    expect(minutes).not.toHaveFocus();
    await user.clear(minutes);
    await user.type(minutes, '12');
    const dialog = screen.getByRole('dialog');
    const acceptButton = within(dialog).getByRole('button', { name: 'Принять заказ' });
    expect(acceptButton).toBeDisabled();
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: /Заказ пробит вручную в iikoFront/,
      }),
    );
    await user.click(acceptButton);

    expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith('queued-1', 'preparing', 12, true);
    expect(screen.getByRole('alert')).toHaveTextContent('Не приняты оплаченные заказы: 1');
    let queuedColumn = screen.getByText('Новые заказы').closest<HTMLElement>('.kitchen-column');
    expect(within(queuedColumn!).getByText('№100041')).toBeInTheDocument();

    await user.click(
      within(screen.getByText('№100042').closest('article')!).getByRole('button', {
        name: 'Заказ готов',
      }),
    );
    await waitFor(() =>
      expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith('preparing-1', 'ready', undefined),
    );

    await user.click(
      within(screen.getByText('№100043').closest('article')!).getByRole('button', {
        name: 'Выдать клиенту',
      }),
    );
    await waitFor(() =>
      expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith(
        'ready-1',
        'handed_over',
        undefined,
      ),
    );
    expect(screen.queryByText('№100043')).not.toBeInTheDocument();

    await act(async () => {
      resolveStart({
        success: true,
        order: { ...queuedOrder, kitchenStatus: 'preparing', preparationMinutes: 12 },
      });
      await startRequest;
    });
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const preparingColumn = screen.getByText('Готовится').closest<HTMLElement>('.kitchen-column');
      expect(within(preparingColumn!).getByText('№100041')).toBeInTheDocument();
    });
    queuedColumn = screen.getByText('Новые заказы').closest<HTMLElement>('.kitchen-column');
    expect(within(queuedColumn!).queryByText('№100041')).not.toBeInTheDocument();
  });

  it('rolls an optimistic transition back when the server rejects it', async () => {
    const user = userEvent.setup();
    apiMocks.updateKitchenStatus.mockRejectedValueOnce(new Error('kitchen conflict'));
    renderPage();

    const ticket = (await screen.findByText('№100042')).closest('article');
    await user.click(within(ticket!).getByRole('button', { name: 'Заказ готов' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('kitchen conflict', 'error'));
    const preparingColumn = screen.getByText('Готовится').closest<HTMLElement>('.kitchen-column');
    expect(within(preparingColumn!).getByText('№100042')).toBeInTheDocument();
  });

  it('shows a retry state when the queue cannot load', async () => {
    const user = userEvent.setup();
    apiMocks.getKitchenOrders
      .mockRejectedValueOnce(new Error('queue offline'))
      .mockResolvedValueOnce({ orders: [] });
    renderPage();

    expect(await screen.findByText('queue offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Экран кухни' })).toBeInTheDocument();
  });

  it('explains delivery dispatch and requires manual iikoFront entry before acceptance', async () => {
    const user = userEvent.setup();
    const deliveryOrder = {
      ...queuedOrder,
      id: 'delivery-1',
      number: 100044,
      fulfillmentType: 'delivery',
      courierDispatchStatus: 'failed',
      courierDispatchProvider: 'yandex',
      courierDispatchError: 'Временная ошибка провайдера',
    };
    apiMocks.getKitchenOrders.mockResolvedValueOnce({ orders: [deliveryOrder] });
    apiMocks.updateKitchenStatus.mockResolvedValueOnce({
      success: true,
      order: { ...deliveryOrder, kitchenStatus: 'preparing' },
    });
    renderPage();

    const ticket = (await screen.findByText('№100044')).closest('article');
    expect(within(ticket!).getByText('Доставка')).toBeInTheDocument();
    expect(within(ticket!).getByText('Не удалось вызвать автокурьера')).toBeInTheDocument();
    expect(within(ticket!).getByText('Служба: Яндекс Go')).toBeInTheDocument();
    expect(within(ticket!).getByText('Временная ошибка провайдера')).toBeInTheDocument();

    await user.click(within(ticket!).getByRole('button', { name: 'Принять заказ' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('После принятия начнётся поиск автокурьера'),
    ).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Принять заказ' });
    expect(submit).toBeDisabled();
    await user.click(
      within(dialog).getByRole('checkbox', { name: /Заказ пробит вручную в iikoFront/ }),
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(apiMocks.updateKitchenStatus).toHaveBeenCalledWith(
        'delivery-1',
        'preparing',
        15,
        true,
      ),
    );
  });

  it('uses an explicit car-courier handoff label for delivery', async () => {
    const deliveryReady = {
      ...readyOrder,
      id: 'delivery-ready',
      number: 100045,
      fulfillmentType: 'delivery',
      courierDispatchStatus: 'succeeded',
      courierDispatchProvider: 'bulka',
    };
    apiMocks.getKitchenOrders.mockResolvedValueOnce({ orders: [deliveryReady] });
    apiMocks.updateKitchenStatus.mockResolvedValueOnce({ success: true, order: deliveryReady });
    renderPage();

    const ticket = (await screen.findByText('№100045')).closest('article');
    expect(
      within(ticket!).getByRole('button', { name: 'Передать автокурьеру' }),
    ).toBeInTheDocument();
  });

  it('highlights the oldest unaccepted order and exposes an explicit sound unlock control', async () => {
    const user = userEvent.setup();
    realtimeMocks.soundReady = false;
    apiMocks.getKitchenOrders.mockResolvedValueOnce({
      orders: [
        { ...queuedOrder, acceptanceRequestedAt: '2026-08-05T08:10:00.000Z' },
        {
          ...queuedOrder,
          id: 'queued-oldest',
          number: 100039,
          acceptanceRequestedAt: '2026-08-05T08:00:00.000Z',
        },
      ],
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не приняты оплаченные заказы: 2');
    expect(alert).toHaveTextContent('Первым ждёт заказ №100039');
    await user.click(within(alert).getByRole('button', { name: 'Разблокировать звук' }));
    expect(realtimeMocks.unlockSound).toHaveBeenCalledTimes(1);
  });

  it('rings immediately and every 25 seconds while an order remains unaccepted', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    renderPage();

    await screen.findByRole('alert');
    await waitFor(() => expect(realtimeMocks.playOrderAlarm).toHaveBeenCalledTimes(1));
    const alarmCall = intervalSpy.mock.calls.find(([, delay]) => delay === 25_000);
    expect(alarmCall).toBeDefined();
    act(() => {
      (alarmCall?.[0] as () => void)();
    });
    expect(realtimeMocks.playOrderAlarm).toHaveBeenCalledTimes(2);
  });

  it('reloads on realtime reconnect and clears the alarm across iPads', async () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    apiMocks.getKitchenOrders
      .mockResolvedValueOnce({ orders: [queuedOrder] })
      .mockResolvedValueOnce({ orders: [{ ...queuedOrder, kitchenStatus: 'preparing' }] });
    renderPage();

    await screen.findByRole('alert');
    const alarmTimer = intervalSpy.mock.results[
      intervalSpy.mock.calls.findIndex(([, delay]) => delay === 25_000)
    ]?.value;
    const realtimeSubscription = realtimeMocks.useAdminRealtimeEvents.mock.calls.at(-1);
    expect(realtimeSubscription?.[0]).toContain('connected');
    act(() => {
      realtimeSubscription?.[1]({ type: 'connected' });
    });

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(clearIntervalSpy).toHaveBeenCalledWith(alarmTimer);
  });

  it('coalesces refresh bursts and keeps the latest success when the trailing silent load fails', async () => {
    let resolveInitial!: (value: unknown) => void;
    const initialRequest = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    apiMocks.getKitchenOrders
      .mockReset()
      .mockReturnValueOnce(initialRequest)
      .mockRejectedValueOnce(new Error('silent refresh failed'));
    renderPage();

    act(() => window.dispatchEvent(new Event('online')));
    act(() => window.dispatchEvent(new Event('online')));
    expect(apiMocks.getKitchenOrders).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveInitial({ orders: [queuedOrder] });
      await initialRequest;
    });
    await waitFor(() => expect(apiMocks.getKitchenOrders).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не приняты оплаченные заказы: 1');
    expect(screen.getByText('№100041')).toBeInTheDocument();
    expect(screen.queryByText('silent refresh failed')).not.toBeInTheDocument();
  });

  it('reconciles a lost acceptance response without restoring the queued alarm', async () => {
    const user = userEvent.setup();
    apiMocks.getKitchenOrders
      .mockResolvedValueOnce({ orders: [queuedOrder] })
      .mockResolvedValueOnce({
        orders: [
          {
            ...queuedOrder,
            kitchenStatus: 'preparing',
            acceptedAt: '2026-08-05T08:05:30.000Z',
            acceptedBy: 'Айжан',
          },
        ],
      });
    apiMocks.updateKitchenStatus.mockRejectedValueOnce(new Error('response lost'));
    renderPage();

    const ticket = (await screen.findByText('№100041')).closest('article');
    await user.click(within(ticket!).getByRole('button', { name: 'Принять заказ' }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('checkbox', { name: /Заказ пробит вручную в iikoFront/ }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Принять заказ' }));

    await waitFor(() => expect(apiMocks.getKitchenOrders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Принял: Айжан')).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it('does not let a delayed acceptance response regress a fresher ready state', async () => {
    const user = userEvent.setup();
    let resolveAcceptance!: (value: unknown) => void;
    const acceptanceRequest = new Promise((resolve) => {
      resolveAcceptance = resolve;
    });
    apiMocks.getKitchenOrders
      .mockResolvedValueOnce({ orders: [queuedOrder] })
      .mockResolvedValueOnce({ orders: [{ ...queuedOrder, kitchenStatus: 'ready' }] });
    apiMocks.updateKitchenStatus.mockReturnValueOnce(acceptanceRequest);
    renderPage();

    const ticket = (await screen.findByText('№100041')).closest('article');
    await user.click(within(ticket!).getByRole('button', { name: 'Принять заказ' }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('checkbox', { name: /Заказ пробит вручную в iikoFront/ }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Принять заказ' }));

    const realtimeSubscription = realtimeMocks.useAdminRealtimeEvents.mock.calls.at(-1);
    act(() => realtimeSubscription?.[1]({ type: 'order.updated' }));
    await waitFor(() => {
      const readyColumn = screen.getByText('Готово').closest<HTMLElement>('.kitchen-column');
      expect(within(readyColumn!).getByText('№100041')).toBeInTheDocument();
    });

    await act(async () => {
      resolveAcceptance({
        success: true,
        order: { ...queuedOrder, kitchenStatus: 'preparing' },
      });
      await acceptanceRequest;
    });
    const readyColumn = screen.getByText('Готово').closest<HTMLElement>('.kitchen-column');
    expect(within(readyColumn!).getByText('№100041')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows server acceptance audit metadata without exposing the raw installation id', async () => {
    apiMocks.getKitchenOrders.mockResolvedValueOnce({
      orders: [
        {
          ...preparingOrder,
          acceptedAt: '2026-08-05T08:05:30.000Z',
          acceptedBy: 'Айжан',
          acceptedDeviceLabel: 'Kitchen iPad',
          acceptedInstallationId: 'must-not-render',
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('Принял: Айжан')).toBeInTheDocument();
    expect(screen.getByText(/Kitchen iPad/)).toBeInTheDocument();
    expect(screen.queryByText(/must-not-render/)).not.toBeInTheDocument();
  });

  it('keeps the visual alarm and marks acceptance unconfirmed while realtime is offline', async () => {
    realtimeMocks.connectionStatus = 'offline';
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Нет связи с сервером — принятие заказа не подтверждено.');
    expect(within(alert).getByRole('button', { name: 'Принять заказ' })).toBeEnabled();
  });
});
