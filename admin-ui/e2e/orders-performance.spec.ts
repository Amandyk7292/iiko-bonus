import { expect, test } from '@playwright/test';

const branchId = '11111111-1111-4111-8111-111111111111';
const firstOrderId = '22222222-2222-4222-8222-222222222222';
const secondOrderId = '33333333-3333-4333-8333-333333333333';
const now = '2026-08-03T18:00:00.000Z';

const adminOrder = (id: string, number: number) => ({
  id,
  number,
  paymentStatus: 'paid',
  orderStatus: 'preparing',
  amount: 2500,
  subtotal: 2500,
  discount: 0,
  branch: '19-й микрорайон',
  branchId,
  orderType: 'pickup',
  deliveryStatus: 'unassigned',
  items: [{ name: 'Круассан', quantity: 1, price: 2500 }],
  earnedBonus: 0,
  refundAmount: 0,
  createdAt: now,
  updatedAt: now,
  customer: { name: 'Клиент', phone: '+7 700 000 00 00' },
});

test('order status is optimistic and does not lock other order rows', async ({ page }) => {
  const firstOrder = adminOrder(firstOrderId, 4001);
  const secondOrder = adminOrder(secondOrderId, 4002);
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
    if (path === '/admin/api/orders' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          orders: [firstOrder, secondOrder],
          total: 2,
          page: 1,
          pageSize: 50,
        }),
      });
    }
    if (path === '/admin/api/couriers') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, couriers: [] }),
      });
    }
    if (path === `/admin/api/orders/${firstOrderId}/status`) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      patchSettled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          order: {
            ...firstOrder,
            orderStatus: 'ready',
            updatedAt: new Date().toISOString(),
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

  await page.goto('/admin/orders');
  const firstRow = page.locator('tbody tr').filter({ hasText: '№4001' });
  const secondRow = page.locator('tbody tr').filter({ hasText: '№4002' });
  const firstStatus = firstRow.getByRole('combobox', { name: 'Изменить статус' });
  const secondStatus = secondRow.getByRole('combobox', { name: 'Изменить статус' });

  await firstStatus.click();
  await page.getByRole('option', { name: 'Готов', exact: true }).click();

  await expect(firstStatus).toContainText('Готов');
  await expect(secondStatus).toBeEnabled();
  expect(patchSettled).toBe(false);
  await expect.poll(() => patchSettled).toBe(true);
});
