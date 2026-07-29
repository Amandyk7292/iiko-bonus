import { expect, test } from '@playwright/test';

const branchA = '11111111-1111-4111-8111-111111111111';
const branchB = '22222222-2222-4222-8222-222222222222';

const summary = {
  success: true,
  updatedAt: '2026-07-23T10:00:00.000Z',
  capabilities: {
    orders: true,
    kitchen: true,
    dispatch: true,
    support: true,
    whatsapp: true,
    inventory: true,
  },
  counts: {
    newOrders: 4,
    activeOrders: 8,
    kitchenOverdue: 1,
    deliveryAttention: 2,
    paymentIssues: 1,
    supportNew: 3,
    supportOverdue: 1,
    supportMine: 2,
    whatsappUnread: 5,
    whatsappDialogs: 2,
    stoppedProducts: 1,
  },
  orders: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      number: 1842,
      amount: 1140,
      branchId: branchA,
      branch: 'ЖК Premium Plaza',
      paymentStatus: 'paid',
      orderStatus: 'new',
      kitchenStatus: null,
      deliveryStatus: null,
      promisedReadyAt: '2026-07-23T09:30:00.000Z',
      createdAt: '2026-07-23T09:00:00.000Z',
      lastError: null,
    },
  ],
  support: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      category: 'refund',
      status: 'new',
      priority: 'high',
      assignedTo: null,
      dueAt: '2026-07-23T09:30:00.000Z',
      lastMessageAt: '2026-07-23T09:00:00.000Z',
      createdAt: '2026-07-23T08:30:00.000Z',
      orderNumber: 1842,
      branchId: branchA,
      branch: 'ЖК Premium Plaza',
      customer: {
        name: 'Меруерт',
        phone: '+77001234567',
      },
      preview: 'Клиент запросил возврат',
    },
  ],
  whatsapp: [],
};

test('operations center scopes every request and exposes realtime state', async ({
  page,
}, testInfo) => {
  const scopedRequests: string[] = [];

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'owner', role: 'owner', branchIds: [] },
        }),
      });
    }
    if (url.pathname === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          locations: [
            { id: branchA, name: 'Арнау', address: 'Улы Дала, 67', city: 'Астана', active: true },
            {
              id: branchB,
              name: 'Панорама',
              address: 'Улы Дала, 41/2',
              city: 'Астана',
              active: true,
            },
          ],
          selectedBranchId: null,
        }),
      });
    }
    if (url.pathname === '/admin/api/operations/summary') {
      scopedRequests.push(request.headers()['x-bulka-branch-id'] || '');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(summary),
      });
    }
    if (url.pathname === '/admin/api/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: '',
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not mocked' }),
    });
  });

  await page.goto('/admin/operations');
  await expect(page.getByRole('heading', { name: 'Операционный центр' })).toBeVisible();
  await expect(page.getByText('Новые заказы', { exact: true })).toBeVisible();
  await expect(page.getByText('Поддержка', { exact: true })).toBeVisible();
  await expect(page.getByText('Переподключение', { exact: true })).toBeVisible();
  await expect(page.getByText('Обновлено сейчас', { exact: true })).toBeVisible();

  const operationRows = page.locator('.operations-list > a');
  await expect(operationRows).toHaveCount(2);
  const rowStyles = await operationRows.evaluateAll((elements) =>
    elements.map((element) => {
      const styles = getComputedStyle(element);
      return {
        display: styles.display,
        gridTemplateColumns: styles.gridTemplateColumns,
        minHeight: styles.minHeight,
        paddingLeft: styles.paddingLeft,
        paddingRight: styles.paddingRight,
        textDecorationLine: styles.textDecorationLine,
      };
    }),
  );
  for (const styles of rowStyles) {
    expect(styles.display).toBe('grid');
    expect(styles.gridTemplateColumns).not.toBe('none');
    expect(Number.parseFloat(styles.minHeight)).toBeGreaterThanOrEqual(70);
    expect(styles.paddingLeft).toBe('18px');
    expect(styles.paddingRight).toBe('18px');
    expect(styles.textDecorationLine).toBe('none');
  }

  await page.getByLabel('Филиал для всех разделов').selectOption(branchB);
  await expect
    .poll(() => scopedRequests.filter((branch) => branch === branchB).length)
    .toBeGreaterThan(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('operations.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
