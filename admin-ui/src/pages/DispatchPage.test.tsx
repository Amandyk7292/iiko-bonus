import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import type { DispatchOrder, ExternalDelivery, YandexDeliveryConfiguration } from '../lib/api';
import DispatchPage from './DispatchPage';

const apiMocks = vi.hoisted(() => ({
  getDispatch: vi.fn(),
  autoAssignCourier: vi.fn(),
  quoteYandexDelivery: vi.fn(),
  requestYandexDelivery: vi.fn(),
  syncYandexDelivery: vi.fn(),
  getYandexCancellationInfo: vi.fn(),
  cancelYandexDelivery: vi.fn(),
  resolveYandexCreateReconciliation: vi.fn(),
  resolveYandexDeliveryItems: vi.fn(),
  setCourierAvailability: vi.fn(),
}));
const feedback = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: vi.fn(),
}));
vi.mock('../components/DispatchMap', () => ({
  default: () => <div data-testid="dispatch-map" />,
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => feedback,
}));

const businessConfig = (
  overrides: Partial<YandexDeliveryConfiguration> = {},
): YandexDeliveryConfiguration => ({
  enabled: true,
  configured: true,
  canManage: true,
  canQuote: true,
  canCreate: true,
  missing: [],
  apiMode: 'business_v2',
  providerLabel: 'Яндекс Go для бизнеса',
  taxiClass: 'express',
  restaurantDeliveryConfirmed: true,
  ...overrides,
});

const businessDelivery = (overrides: Partial<ExternalDelivery> = {}): ExternalDelivery => ({
  id: 'delivery-job-1',
  provider: 'yandex',
  apiFamily: 'business_v2',
  claimId: null,
  status: 'quoted',
  active: true,
  statusLabel: 'Цена рассчитана',
  deliveryStatus: 'unassigned',
  quotedPrice: 1250,
  price: null,
  fixedPrice: true,
  currency: 'KZT',
  canCancel: true,
  terminal: false,
  quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  quoteFingerprint: 'a'.repeat(64),
  ...overrides,
});

const dispatchOrder = (externalDelivery: ExternalDelivery | null): DispatchOrder => ({
  id: 'order-1',
  number: 100101,
  amount: 8200,
  branchLatitude: 43.65,
  branchLongitude: 51.19,
  deliveryLatitude: 43.66,
  deliveryLongitude: 51.2,
  deliveryAddress: '14-й микрорайон, 20',
  courierId: null,
  kitchenStatus: 'preparing',
  courierDispatchRequestedAt: '2026-08-13T10:00:00.000Z',
  routeDistanceKm: 3.2,
  routeEtaMinutes: 12,
  externalDelivery,
});

function renderPage(config = businessConfig(), order = dispatchOrder(businessDelivery())) {
  apiMocks.getDispatch.mockResolvedValue({
    success: true,
    couriers: [],
    orders: [order],
    yandexDelivery: config,
  });
  return render(
    <I18nProvider>
      <DispatchPage />
    </I18nProvider>,
  );
}

describe('DispatchPage Yandex Business controls', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    vi.clearAllMocks();
    feedback.confirm.mockResolvedValue(true);
    apiMocks.requestYandexDelivery.mockResolvedValue({
      success: true,
      delivery: businessDelivery({ status: 'searching', active: true }),
    });
    apiMocks.syncYandexDelivery.mockResolvedValue({ success: true, delivery: null });
    apiMocks.cancelYandexDelivery.mockResolvedValue({
      success: true,
      delivery: businessDelivery({ status: 'cancelled', terminal: true }),
    });
    apiMocks.resolveYandexDeliveryItems.mockResolvedValue({
      success: true,
      delivery: businessDelivery({ status: 'cancelled', terminal: true }),
    });
    apiMocks.resolveYandexCreateReconciliation.mockResolvedValue({
      success: true,
      delivery: businessDelivery({ status: 'searching', claimId: 'yandex-order-1' }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lets an owner/admin capability confirm the exact fixed price and sends the bound quote', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Вызвать ·/ }));

    expect(feedback.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Вызвать курьера Яндекс Go для бизнеса',
        body: expect.stringContaining('1 250 ₸'),
        confirmLabel: expect.stringContaining('1 250 ₸'),
      }),
    );
    await waitFor(() =>
      expect(apiMocks.requestYandexDelivery).toHaveBeenCalledWith('order-1', {
        deliveryJobId: 'delivery-job-1',
        maxPriceKzt: 1250,
        quoteFingerprint: 'a'.repeat(64),
      }),
    );
  });

  it('keeps the Business fixed-price contract when global mode has switched back to Cargo', async () => {
    const cargoConfig = businessConfig({
      apiMode: 'cargo_v2',
      providerLabel: 'Яндекс.Доставка',
      taxiClass: 'courier',
    });
    const staleRender = renderPage(
      cargoConfig,
      dispatchOrder(businessDelivery({ fixedPrice: false })),
    );

    const staleRequest = await screen.findByRole('button', { name: /Вызвать ·/ });
    expect(staleRequest).toBeDisabled();
    expect(staleRequest).toHaveAccessibleDescription(
      'Сначала получите свежую фиксированную цену Яндекс Go для бизнеса.',
    );
    expect(apiMocks.requestYandexDelivery).not.toHaveBeenCalled();
    staleRender.unmount();

    const user = userEvent.setup();
    renderPage(cargoConfig, dispatchOrder(businessDelivery()));
    await user.click(await screen.findByRole('button', { name: /Вызвать ·/ }));

    await waitFor(() =>
      expect(apiMocks.requestYandexDelivery).toHaveBeenCalledWith('order-1', {
        deliveryJobId: 'delivery-job-1',
        maxPriceKzt: 1250,
        quoteFingerprint: 'a'.repeat(64),
      }),
    );
  });

  it('does not create a paid request when the confirmation is declined', async () => {
    const user = userEvent.setup();
    feedback.confirm.mockResolvedValueOnce(false);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Вызвать ·/ }));

    expect(feedback.confirm).toHaveBeenCalledOnce();
    expect(apiMocks.requestYandexDelivery).not.toHaveBeenCalled();
  });

  it('keeps quote available to a quote-only role without exposing the create action', async () => {
    renderPage(businessConfig({ canManage: false, canCreate: false }));

    expect(await screen.findByRole('button', { name: 'Цена' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Вызвать/ })).not.toBeInTheDocument();
  });

  it('shows exhausted creation as an alert to a lower role without exposing remediation', async () => {
    renderPage(
      businessConfig({ canManage: false, canCreate: false }),
      dispatchOrder(
        businessDelivery({
          status: 'creating_exhausted',
          statusLabel: 'Требуется проверка кабинета',
          createReconciliationExhausted: true,
          attentionRequired: true,
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Яндекс не подтвердил создание заявки/);
    expect(alert).toHaveTextContent(/только владельцу или администратору с MFA/);
    expect(
      screen.queryByRole('button', { name: 'Указать ID заказа Яндекса' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Подтвердить, что заказ не создан' }),
    ).not.toBeInTheDocument();
  });

  it('requires the explicit canCreate capability even when legacy canManage is true', async () => {
    renderPage(
      businessConfig({ canManage: true, canCreate: undefined }),
      dispatchOrder(
        businessDelivery({
          status: 'creating_exhausted',
          createReconciliationExhausted: true,
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/только владельцу или администратору/);
    expect(
      screen.queryByRole('button', { name: 'Указать ID заказа Яндекса' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Подтвердить, что заказ не создан' }),
    ).not.toBeInTheDocument();
  });

  it('attaches the exact cabinet order ID with an audited reason and refreshes', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('  yandex.order:123  ')
      .mockReturnValueOnce('  Найдено владельцем в кабинете в 14:30  ');
    renderPage(
      businessConfig(),
      dispatchOrder(
        businessDelivery({
          status: 'creating_exhausted',
          statusLabel: 'Требуется проверка кабинета',
          createReconciliationExhausted: true,
          attentionRequired: true,
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    const attach = await screen.findByRole('button', { name: 'Указать ID заказа Яндекса' });
    expect(attach).toHaveAccessibleDescription(/заявка может уже существовать/);
    await user.click(attach);

    await waitFor(() =>
      expect(apiMocks.resolveYandexCreateReconciliation).toHaveBeenCalledWith('order-1', {
        deliveryJobId: 'delivery-job-1',
        resolution: 'attach',
        externalOrderId: 'yandex.order:123',
        reason: 'Найдено владельцем в кабинете в 14:30',
      }),
    );
    expect(feedback.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('yandex.order:123'),
        destructive: false,
      }),
    );
    await waitFor(() => expect(apiMocks.getDispatch).toHaveBeenCalledTimes(2));
  });

  it('requires a destructive confirmation before recording that no Yandex order exists', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue(
      'Владелец проверил все активные заказы в кабинете в 14:35',
    );
    renderPage(
      businessConfig(),
      dispatchOrder(
        businessDelivery({
          status: 'creating_exhausted',
          statusLabel: 'Требуется проверка кабинета',
          createReconciliationExhausted: true,
          attentionRequired: true,
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    await user.click(
      await screen.findByRole('button', { name: 'Подтвердить, что заказ не создан' }),
    );

    await waitFor(() =>
      expect(apiMocks.resolveYandexCreateReconciliation).toHaveBeenCalledWith('order-1', {
        deliveryJobId: 'delivery-job-1',
        resolution: 'not_created',
        reason: 'Владелец проверил все активные заказы в кабинете в 14:35',
      }),
    );
    expect(feedback.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Подтвердить, что заявка в Яндексе не создана?',
        destructive: true,
      }),
    );
    await waitFor(() => expect(apiMocks.getDispatch).toHaveBeenCalledTimes(2));
  });

  it('keeps the exhausted-create action busy until reconciliation finishes', async () => {
    const user = userEvent.setup();
    let finishRequest!: (value: unknown) => void;
    apiMocks.resolveYandexCreateReconciliation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('yandex-order-456')
      .mockReturnValueOnce('Найдено администратором в кабинете');
    renderPage(
      businessConfig(),
      dispatchOrder(
        businessDelivery({
          status: 'creating_exhausted',
          createReconciliationExhausted: true,
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    const attach = await screen.findByRole('button', { name: 'Указать ID заказа Яндекса' });
    await user.click(attach);
    await waitFor(() => expect(apiMocks.resolveYandexCreateReconciliation).toHaveBeenCalledOnce());
    expect(attach).toBeDisabled();
    expect(attach).toHaveAttribute('aria-busy', 'true');

    finishRequest({ success: true, delivery: businessDelivery({ status: 'searching' }) });
    await waitFor(() => expect(apiMocks.getDispatch).toHaveBeenCalledTimes(2));
  });

  it('does not expose post-pickup resolution actions to a lower role', async () => {
    const unresolved = businessDelivery({
      status: 'cancelled_items_unresolved',
      statusLabel: 'Нужно уточнить, где заказ',
      deliveryStatus: 'picked_up',
      quoteExpiresAt: null,
      quotedPrice: null,
      fixedPrice: null,
      canCancel: false,
      lastError: 'Не удалось достоверно определить результат доставки',
    });
    renderPage(businessConfig({ canManage: false, canCreate: false }), dispatchOrder(unresolved));

    expect(
      await screen.findByText(/Яндекс завершил заявку без достоверного результата/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Заказ вернулся в филиал' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Заказ доставлен клиенту' }),
    ).not.toBeInTheDocument();
  });

  it('requires a non-empty reason before post-pickup resolution', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    renderPage(
      businessConfig(),
      dispatchOrder(
        businessDelivery({
          status: 'cancelled_items_unresolved',
          statusLabel: 'Нужно уточнить, где заказ',
          deliveryStatus: 'picked_up',
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    await user.click(await screen.findByRole('button', { name: 'Заказ вернулся в филиал' }));

    await waitFor(() =>
      expect(feedback.toast).toHaveBeenCalledWith(
        'Укажите причину и источник подтверждения. Без этого ручное решение не сохранится.',
        'error',
      ),
    );
    expect(feedback.confirm).not.toHaveBeenCalled();
    expect(apiMocks.resolveYandexDeliveryItems).not.toHaveBeenCalled();
  });

  it.each([
    ['returned', 'Заказ вернулся в филиал', 'Курьер вернул пакет администратору'],
    ['delivered', 'Заказ доставлен клиенту', 'Клиент подтвердил получение по телефону'],
  ] as const)(
    'sends the exact %s resolution payload and refreshes the dispatch data',
    async (resolution, actionLabel, reason) => {
      const user = userEvent.setup();
      vi.spyOn(window, 'prompt').mockReturnValue(reason);
      renderPage(
        businessConfig(),
        dispatchOrder(
          businessDelivery({
            status: 'cancelled_items_unresolved',
            statusLabel: 'Нужно уточнить, где заказ',
            deliveryStatus: 'picked_up',
            quoteExpiresAt: null,
            canCancel: false,
          }),
        ),
      );

      await user.click(await screen.findByRole('button', { name: actionLabel }));

      await waitFor(() =>
        expect(apiMocks.resolveYandexDeliveryItems).toHaveBeenCalledWith('order-1', {
          deliveryJobId: 'delivery-job-1',
          resolution,
          reason,
        }),
      );
      expect(feedback.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining(reason) }),
      );
      await waitFor(() => expect(apiMocks.getDispatch).toHaveBeenCalledTimes(2));
    },
  );

  it('does not mutate delivery state when post-pickup confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('Клиент сообщил оператору о получении');
    feedback.confirm.mockResolvedValueOnce(false);
    renderPage(
      businessConfig(),
      dispatchOrder(
        businessDelivery({
          status: 'cancelled_items_unresolved',
          statusLabel: 'Нужно уточнить, где заказ',
          deliveryStatus: 'picked_up',
          quoteExpiresAt: null,
          canCancel: false,
        }),
      ),
    );

    const delivered = await screen.findByRole('button', { name: 'Заказ доставлен клиенту' });
    await user.click(delivered);

    await waitFor(() => expect(feedback.confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(delivered).toBeEnabled());
    expect(apiMocks.resolveYandexDeliveryItems).not.toHaveBeenCalled();
    expect(apiMocks.getDispatch).toHaveBeenCalledOnce();
  });

  it('keeps a quoted reservation cancellable and never offers a conflicting own courier', async () => {
    const user = userEvent.setup();
    apiMocks.getYandexCancellationInfo.mockResolvedValue({
      success: true,
      cancellation: { cancelState: 'free', price: 0, currency: 'KZT' },
    });
    renderPage();

    expect(await screen.findByRole('button', { name: /Вызвать ·/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назначить своего' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отменить Яндекс.Доставку' }));

    await waitFor(() =>
      expect(apiMocks.cancelYandexDelivery).toHaveBeenCalledWith('order-1', false),
    );
  });

  it.each([
    ['non-fixed', businessDelivery({ fixedPrice: false })],
    ['expired', businessDelivery({ quoteExpiresAt: new Date(Date.now() - 1_000).toISOString() })],
  ])('disables create for a %s quote and explains the reason accessibly', async (_, delivery) => {
    renderPage(businessConfig(), dispatchOrder(delivery));

    const request = await screen.findByRole('button', { name: /Вызвать ·/ });
    expect(request).toBeDisabled();
    expect(request).toHaveAccessibleDescription(
      delivery.fixedPrice === false
        ? 'Сначала получите свежую фиксированную цену Яндекс Go для бизнеса.'
        : 'Расчёт цены устарел. Рассчитайте стоимость ещё раз.',
    );
  });

  it('updates the quote countdown and disables create as soon as the quote expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T10:00:00.000Z'));
    const delivery = businessDelivery({
      quoteExpiresAt: '2026-08-13T10:00:02.000Z',
    });
    renderPage(businessConfig(), dispatchOrder(delivery));

    await act(async () => undefined);
    expect(screen.getByText('Цена действительна ещё 00:02')).toBeInTheDocument();
    const request = screen.getByRole('button', { name: /Вызвать ·/ });
    expect(request).toBeEnabled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('Цена действительна ещё 00:01')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));
    expect(
      screen.getByText('Срок действия цены истёк — рассчитайте её снова.'),
    ).toBeInTheDocument();
    expect(request).toBeDisabled();
  });

  it('hides sync and cancellation controls when the role cannot quote', async () => {
    const active = businessDelivery({
      status: 'searching',
      active: true,
      canCancel: true,
      quoteExpiresAt: null,
    });
    renderPage(
      businessConfig({ canManage: false, canQuote: false, canCreate: false }),
      dispatchOrder(active),
    );

    expect(await screen.findByText('Цена рассчитана')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Обновить статус Яндекс.Доставки' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Отменить Яндекс.Доставку' }),
    ).not.toBeInTheDocument();
  });

  it.each(['paid', 'minimal'] as const)(
    'requires owner/admin capability before a %s cancellation',
    async (cancelState) => {
      const user = userEvent.setup();
      const active = businessDelivery({
        status: 'searching',
        active: true,
        canCancel: true,
        quoteExpiresAt: null,
      });
      apiMocks.getYandexCancellationInfo.mockResolvedValue({
        success: true,
        cancellation: {
          cancelState,
          price: cancelState === 'paid' ? 500 : null,
          currency: 'KZT',
        },
      });
      renderPage(businessConfig({ canManage: false, canCreate: false }), dispatchOrder(active));

      await user.click(await screen.findByRole('button', { name: 'Отменить Яндекс.Доставку' }));

      await waitFor(() =>
        expect(feedback.toast).toHaveBeenCalledWith(
          'Платную отмену может подтвердить только владелец или администратор. Обратитесь к нему.',
          'error',
        ),
      );
      expect(feedback.confirm).not.toHaveBeenCalled();
      expect(apiMocks.cancelYandexDelivery).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['paid', 500],
    ['minimal', null],
  ] as const)(
    'lets an owner/admin capability explicitly confirm a %s cancellation',
    async (cancelState, price) => {
      const user = userEvent.setup();
      const active = businessDelivery({
        status: 'searching',
        active: true,
        canCancel: true,
        quoteExpiresAt: null,
      });
      apiMocks.getYandexCancellationInfo.mockResolvedValue({
        success: true,
        cancellation: {
          cancelState,
          price,
          currency: 'KZT',
          title: price == null ? 'Минимальная стоимость' : null,
          message: price == null ? 'Сумма будет рассчитана Яндексом' : null,
        },
      });
      renderPage(businessConfig(), dispatchOrder(active));

      await user.click(await screen.findByRole('button', { name: 'Отменить Яндекс.Доставку' }));

      await waitFor(() =>
        expect(apiMocks.cancelYandexDelivery).toHaveBeenCalledWith('order-1', true),
      );
      expect(feedback.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    },
  );
});
