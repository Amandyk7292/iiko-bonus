import { expect, test } from '@playwright/test';

const branchId = '11111111-1111-4111-8111-111111111111';
const firstOrderId = '22222222-2222-4222-8222-222222222222';
const secondOrderId = '33333333-3333-4333-8333-333333333333';
const now = '2026-08-03T18:00:00.000Z';

const kitchenOrder = (id: string, number: number) => ({
  id,
  number,
  branchId,
  branch: '19-й микрорайон',
  items: [{ id: `item-${number}`, name: 'Круассан', quantity: 1 }],
  comment: null,
  substitutionPreference: 'call_customer',
  fulfillmentType: 'pickup',
  fulfillmentStatus: 'preparing',
  kitchenStatus: 'preparing',
  createdAt: now,
  promisedReadyAt: '2026-08-03T18:30:00.000Z',
  kitchenStartedAt: now,
  kitchenReadyAt: null,
  handedToCourierAt: null,
  preparationMinutes: 30,
  courierId: null,
  deliveryStatus: 'unassigned',
  customerArrivedAt: null,
});

test('kitchen moves one order immediately while other orders remain actionable', async ({
  page,
}) => {
  const firstOrder = kitchenOrder(firstOrderId, 3001);
  const secondOrder = kitchenOrder(secondOrderId, 3002);
  let patchSettled = false;

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'owner', role: 'owner', branchIds: [] } }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          locations: [
            {
              id: branchId,
              name: '19-й микрорайон',
              address: 'Актау',
              city: 'Актау',
              active: true,
            },
          ],
          selectedBranchId: branchId,
        }),
      });
    }
    if (path === '/admin/api/kitchen' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [firstOrder, secondOrder] }),
      });
    }
    if (path === `/admin/api/kitchen/${firstOrderId}/status`) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      patchSettled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          order: {
            ...firstOrder,
            fulfillmentStatus: 'ready',
            kitchenStatus: 'ready',
            kitchenReadyAt: new Date().toISOString(),
          },
        }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not mocked' }),
    });
  });

  await page.goto('/admin/kitchen');
  const firstTicket = page.locator('.kitchen-ticket').filter({ hasText: '№3001' });
  const secondTicket = page.locator('.kitchen-ticket').filter({ hasText: '№3002' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(firstTicket.getByRole('button', { name: 'Заказ готов' })).toBeVisible();
  expect(
    await page
      .locator('.kitchen-board')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      ),
  ).toBe(3);

  await firstTicket.getByRole('button', { name: 'Заказ готов' }).click();

  const movedTicket = page.locator('.kitchen-ready .kitchen-ticket').filter({ hasText: '№3001' });
  await expect(movedTicket.getByRole('button', { name: 'Выдать клиенту' })).toBeVisible();
  await expect(secondTicket.getByRole('button', { name: 'Заказ готов' })).toBeEnabled();
  expect(patchSettled).toBe(false);
  await expect.poll(() => patchSettled).toBe(true);
});

test('cashier iPad shell keeps branch, connection and sound controls visible without overflow', async ({
  page,
}) => {
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'cashier.aktau', role: 'cashier', branchIds: [branchId] },
        }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          locations: [
            {
              id: branchId,
              name: '19-й микрорайон',
              address: 'Актау',
              city: 'Актау',
              active: true,
            },
          ],
          selectedBranchId: branchId,
        }),
      });
    }
    if (path === '/admin/api/kitchen') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [] }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${request.method()} ${path}` }),
    });
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/admin/access');
  await expect(page).toHaveURL(/\/admin\/kitchen$/);
  await expect(page.getByText('19-й микрорайон', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: /Связь с заказами:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Звук (включён|выключен)/ })).toBeVisible();
  await expect(page.locator('.kitchen-board')).toBeVisible();

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const controls = [
        document.querySelector('.cashier-branch'),
        document.querySelector('.cashier-connection'),
        document.querySelector('.cashier-sound-toggle'),
        document.querySelector('.topbar-logout'),
      ].filter((element): element is Element => Boolean(element));
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controlsInsideViewport: controls.every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth && rect.width >= 44;
        }),
        columns: getComputedStyle(document.querySelector('.kitchen-board')!)
          .gridTemplateColumns.split(' ')
          .filter(Boolean).length,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.controlsInsideViewport).toBe(true);
    if (viewport.width >= 900) expect(layout.columns).toBe(3);
  }
});

test('unaccepted paid order keeps the iPad alarm visible until the server confirms acceptance', async ({
  page,
}) => {
  const queuedOrder = {
    ...kitchenOrder(firstOrderId, 3003),
    fulfillmentStatus: 'new',
    kitchenStatus: 'queued',
    kitchenStartedAt: null,
    acceptanceRequestedAt: '2026-08-03T17:58:00.000Z',
    acceptedAt: null,
    acceptedBy: null,
    acceptedDeviceLabel: null,
  };
  let currentOrder = queuedOrder;
  let releaseAcceptance!: () => void;
  const acceptanceGate = new Promise<void>((resolve) => {
    releaseAcceptance = resolve;
  });

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'cashier.aktau', role: 'cashier', branchIds: [branchId] },
        }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          locations: [
            {
              id: branchId,
              name: '19-й микрорайон',
              address: 'Актау',
              city: 'Актау',
              active: true,
            },
          ],
          selectedBranchId: branchId,
        }),
      });
    }
    if (path === '/admin/api/kitchen' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [currentOrder] }),
      });
    }
    if (path === `/admin/api/kitchen/${firstOrderId}/status` && request.method() === 'PATCH') {
      expect(request.postDataJSON()).toEqual({
        status: 'preparing',
        preparationMinutes: 30,
        iikoManualEntryConfirmed: true,
      });
      await acceptanceGate;
      currentOrder = {
        ...queuedOrder,
        fulfillmentStatus: 'preparing',
        kitchenStatus: 'preparing',
        kitchenStartedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedBy: 'cashier.aktau',
        acceptedDeviceLabel: 'iPad ••••EN01',
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, order: currentOrder }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${request.method()} ${path}` }),
    });
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/admin/kitchen?embedded=app');

  const alarm = page.getByRole('alert').filter({ hasText: 'Не приняты оплаченные заказы: 1' });
  await expect(alarm).toBeVisible();
  const acceptButton = alarm.getByRole('button', { name: 'Принять заказ' });
  expect((await acceptButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await acceptButton.click();

  const dialog = page.getByRole('dialog');
  await dialog.getByText('Заказ пробит вручную в iikoFront').click();
  await dialog.getByRole('button', { name: 'Принять заказ' }).click();
  await expect(alarm).toContainText('Сохраняем принятие на сервере');

  releaseAcceptance();
  await expect(alarm).toHaveCount(0);
  await expect(page.getByText('Принял: cashier.aktau')).toBeVisible();
  await expect(page.getByText(/iPad ••••EN01/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});
