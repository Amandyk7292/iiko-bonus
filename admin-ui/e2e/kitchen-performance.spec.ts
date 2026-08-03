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
  await expect(firstTicket.getByRole('button', { name: 'Готово' })).toBeVisible();

  await firstTicket.getByRole('button', { name: 'Готово' }).click();

  const movedTicket = page.locator('.kitchen-ready .kitchen-ticket').filter({ hasText: '№3001' });
  await expect(movedTicket.getByRole('button', { name: 'Передан' })).toBeVisible();
  await expect(secondTicket.getByRole('button', { name: 'Готово' })).toBeEnabled();
  expect(patchSettled).toBe(false);
  await expect.poll(() => patchSettled).toBe(true);
});
