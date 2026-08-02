import { expect, test } from '@playwright/test';

const baseProvider = {
  enabled: true,
  configured: true,
  available: true,
  checkedAt: '2026-07-27T12:00:00.000Z',
  message: 'Сервис отвечает',
};

const diagnostics = () => ({
  canManage: true,
  checkedAt: '2026-07-27T12:00:00.000Z',
  mode: {
    widgetEnabled: false,
    effectiveIntegration: 'hosted_page',
    fallbackActive: false,
    fallbackReason: 'widget_disabled',
    updatedAt: null,
  },
  providers: {
    kaspi: { ...baseProvider },
    forteHosted: { ...baseProvider },
    forteWidget: {
      ...baseProvider,
      enabled: false,
      available: null,
      checkedAt: null,
      message: 'Проверка ещё не запускалась',
      errorCode: null,
      availableMethods: [],
    },
  },
  webhooks: {
    kaspi: {
      configured: true,
      lastSuccessAt: '2026-07-27T11:55:00.000Z',
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
    checkedAt: '2026-07-27T11:59:00.000Z',
    inspected: 3,
    expired: 1,
    cancelled: 1,
    released: 1,
    errors: 0,
  },
  latestErrors: [
    {
      id: 'payment-1',
      orderNumber: 100125,
      provider: 'Forte Widget',
      status: 'pending',
      message: 'Банк не вернул доступные способы оплаты',
      occurredAt: '2026-07-27T11:58:00.000Z',
    },
  ],
});

test('owner controls Widget and runs a safe probe without SSH', async ({ page }, testInfo) => {
  let payments = diagnostics();
  const mutations: Array<{ method: string; path: string; body: unknown }> = [];

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'owner', role: 'owner', branchIds: [], actions: ['*'] },
        }),
      });
    }
    if (url.pathname === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: [], selectedBranchId: null }),
      });
    }
    if (url.pathname === '/admin/api/integrations/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          checkedAt: '2026-07-27T12:00:00.000Z',
          services: [],
          payments,
        }),
      });
    }
    if (url.pathname === '/admin/api/integrations/payments/widget' && method === 'PUT') {
      const body = request.postDataJSON();
      mutations.push({ method, path: url.pathname, body });
      payments = {
        ...payments,
        mode: {
          ...payments.mode,
          widgetEnabled: true,
          fallbackActive: true,
          fallbackReason: 'widget_unhealthy',
        },
        providers: {
          ...payments.providers,
          forteWidget: {
            ...payments.providers.forteWidget,
            enabled: true,
            available: false,
            checkedAt: '2026-07-27T12:01:00.000Z',
            message: 'Банк не вернул доступные карты',
            errorCode: 'FORTE_WIDGET_NO_PAYMENT_METHODS',
          },
        },
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, payments }),
      });
    }
    if (url.pathname === '/admin/api/integrations/payments/probe' && method === 'POST') {
      mutations.push({ method, path: url.pathname, body: null });
      payments = {
        ...payments,
        mode: {
          ...payments.mode,
          effectiveIntegration: 'widget',
          fallbackActive: false,
          fallbackReason: null,
        },
        providers: {
          ...payments.providers,
          forteWidget: {
            ...payments.providers.forteWidget,
            available: true,
            checkedAt: '2026-07-27T12:02:00.000Z',
            message: 'Карты доступны, списания не было',
            errorCode: null,
            availableMethods: ['credit_card'],
          },
        },
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, payments }),
      });
    }
    if (url.pathname === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${method} ${url.pathname}` }),
    });
  });

  await page.goto('/admin/integrations');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Диагностика оплат' })).toBeVisible();
  await expect(page.getByText('Страница банка /flex', { exact: true }).first()).toBeVisible();

  const modeSwitch = page.getByRole('switch', {
    name: 'Использовать Forte Widget для новых оплат',
  });
  await expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
  await modeSwitch.click();
  await expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByText('Widget включён, но новые оплаты безопасно открываются через /flex.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Запустить проверку' }).click();
  await expect(page.getByText('Forte Widget', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Карты доступны, списания не было')).toBeVisible();
  await expect(
    page.getByText('Проверка завершена: Widget принимает карты, списания не было.'),
  ).toBeVisible();

  expect(mutations).toEqual([
    {
      method: 'PUT',
      path: '/admin/api/integrations/payments/widget',
      body: { enabled: true },
    },
    {
      method: 'POST',
      path: '/admin/api/integrations/payments/probe',
      body: null,
    },
  ]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('payment-diagnostics.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
