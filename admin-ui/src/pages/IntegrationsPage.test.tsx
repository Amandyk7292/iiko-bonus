import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import type { PaymentDiagnostics } from '../lib/payment-diagnostics';
import IntegrationsPage from './IntegrationsPage';

const apiMocks = vi.hoisted(() => ({
  getIntegrationHealth: vi.fn(),
  setForteWidgetEnabled: vi.fn(),
  runPaymentProbe: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: apiMocks,
}));

const checkedAt = '2026-08-04T18:00:00.000Z';

const payments = (overrides: Partial<PaymentDiagnostics> = {}): PaymentDiagnostics => ({
  canManage: true,
  checkedAt,
  mode: {
    widgetEnabled: true,
    effectiveIntegration: 'widget',
    fallbackActive: false,
    fallbackReason: null,
    updatedAt: checkedAt,
  },
  providers: {
    kaspi: {
      enabled: true,
      configured: true,
      available: true,
      checkedAt,
      message: 'Kaspi доступен',
    },
    forteHosted: {
      enabled: false,
      configured: false,
      available: null,
      checkedAt: null,
      message: 'Hosted выключен',
    },
    forteWidget: {
      enabled: true,
      configured: true,
      available: null,
      checkedAt,
      message: 'Ожидает безопасной проверки',
    },
  },
  webhooks: {
    kaspi: {
      configured: true,
      lastSuccessAt: '2026-08-04T17:59:00.000Z',
      lastFailureAt: '2026-08-04T17:00:00.000Z',
      lastErrorCode: null,
    },
    forteWidget: {
      configured: true,
      lastSuccessAt: '2026-08-04T16:00:00.000Z',
      lastFailureAt: '2026-08-04T17:30:00.000Z',
      lastErrorCode: 'PROVIDER_TIMEOUT',
    },
  },
  cleanup: {
    checkedAt,
    inspected: 4,
    expired: 2,
    cancelled: 2,
    released: 2,
    errors: 0,
  },
  latestErrors: [
    {
      id: 'error-1',
      orderNumber: 100039,
      provider: 'Forte Widget',
      status: 'unknown',
      message: 'Ответ банка будет сверён повторно',
      occurredAt: checkedAt,
    },
  ],
  ...overrides,
});

const services = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    state: 'healthy',
    summary: 'Подключён',
    detail: 'Сообщения доставляются',
    updatedAt: checkedAt,
  },
  {
    id: 'iiko',
    name: 'iiko',
    state: 'attention',
    summary: 'Нужна проверка',
    detail: '',
    updatedAt: null,
  },
  {
    id: 'push',
    name: 'Push',
    state: 'disabled',
    summary: 'Выключен',
    detail: '',
    updatedAt: null,
  },
  {
    id: 'delivery',
    name: 'Доставка',
    state: 'error',
    summary: 'Ошибка',
    detail: 'Токен недоступен',
    updatedAt: checkedAt,
  },
];

const renderPage = () =>
  render(
    <I18nProvider>
      <IntegrationsPage />
    </I18nProvider>,
  );

describe('Payment provider diagnostics', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    apiMocks.getIntegrationHealth.mockReset().mockResolvedValue({
      services,
      payments: payments(),
      checkedAt,
    });
    apiMocks.setForteWidgetEnabled.mockReset();
    apiMocks.runPaymentProbe.mockReset();
  });

  it('renders provider, webhook, cleanup and fallback state without charging', async () => {
    const fallback = payments({
      mode: {
        widgetEnabled: false,
        effectiveIntegration: 'hosted_page',
        fallbackActive: true,
        fallbackReason: 'widget_unavailable',
        updatedAt: checkedAt,
      },
    });
    apiMocks.setForteWidgetEnabled.mockResolvedValue({ payments: fallback });
    apiMocks.runPaymentProbe.mockResolvedValue({
      payments: payments({
        providers: {
          ...payments().providers,
          forteWidget: {
            ...payments().providers.forteWidget,
            available: true,
            message: 'Widget принимает карты',
          },
        },
      }),
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Диагностика оплат' })).toBeInTheDocument();
    expect(screen.getByText('Kaspi доступен')).toBeInTheDocument();
    expect(screen.getByText('Hosted выключен')).toBeInTheDocument();
    expect(screen.getByText('PROVIDER_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText(/Отменено: 2/)).toBeInTheDocument();
    expect(screen.getByText(/заказ №100039/)).toBeInTheDocument();
    expect(screen.getByText('Сообщения доставляются')).toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', { name: 'Использовать Forte Widget для новых оплат' }),
    );
    await waitFor(() => expect(apiMocks.setForteWidgetEnabled).toHaveBeenCalledWith(false));
    expect(
      await screen.findByText('Widget включён, но новые оплаты безопасно открываются через /flex.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Запустить проверку' }));
    await waitFor(() => expect(apiMocks.runPaymentProbe).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('Проверка завершена: Widget принимает карты, списания не было.'),
    ).toBeInTheDocument();
  });

  it('keeps provider mutations disabled for a read-only role', async () => {
    apiMocks.getIntegrationHealth.mockResolvedValue({
      services: [],
      payments: payments({
        canManage: false,
        mode: {
          widgetEnabled: false,
          effectiveIntegration: null,
          fallbackActive: false,
          fallbackReason: 'not_configured',
          updatedAt: null,
        },
        providers: {
          kaspi: {
            enabled: true,
            configured: false,
            available: false,
            checkedAt: null,
            message: 'Kaspi не настроен',
          },
          forteHosted: payments().providers.forteHosted,
          forteWidget: payments().providers.forteWidget,
        },
        webhooks: {
          kaspi: {
            configured: false,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastErrorCode: null,
          },
          forteWidget: {
            configured: true,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastErrorCode: null,
          },
        },
        cleanup: {
          checkedAt: null,
          inspected: 0,
          expired: 0,
          cancelled: 0,
          released: 0,
          errors: 0,
        },
        latestErrors: [],
      }),
      checkedAt,
    });
    renderPage();

    expect((await screen.findAllByText('Оплата недоступна')).length).toBeGreaterThan(0);
    expect(screen.getByText('Kaspi не настроен')).toBeInTheDocument();
    expect(screen.getByText('Webhook не настроен')).toBeInTheDocument();
    expect(screen.getByText('Фоновая очистка ещё не запускалась')).toBeInTheDocument();
    expect(screen.getByText('Ошибок оплаты нет')).toBeInTheDocument();
    expect(screen.getByText('Доступно владельцу и администратору.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Запустить проверку' })).toBeDisabled();
  });

  it('hides Kaspi controls when the integration flag is disabled', async () => {
    const disabledKaspi = payments({
      providers: {
        ...payments().providers,
        kaspi: {
          enabled: false,
          configured: false,
          available: null,
          checkedAt: null,
          message: 'Выключен',
        },
      },
    });
    apiMocks.getIntegrationHealth.mockResolvedValue({
      services,
      payments: disabledKaspi,
      checkedAt,
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Диагностика оплат' })).toBeInTheDocument();
    expect(screen.queryByText('Kaspi Pay')).not.toBeInTheDocument();
    expect(screen.queryByText('Kaspi доступен')).not.toBeInTheDocument();
  });

  it('shows a retry state when provider diagnostics cannot load', async () => {
    apiMocks.getIntegrationHealth.mockRejectedValueOnce(new Error('diagnostics offline'));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('diagnostics offline')).toBeInTheDocument();
    apiMocks.getIntegrationHealth.mockResolvedValue({
      services,
      payments: payments(),
      checkedAt,
    });
    await user.click(screen.getByRole('button', { name: /Повтор/ }));
    expect(await screen.findByRole('heading', { name: 'Диагностика оплат' })).toBeInTheDocument();
  });
});
