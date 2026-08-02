import { expect, test } from '@playwright/test';

const orderId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const now = '2026-08-02T08:00:00.000Z';

const order = {
  id: orderId,
  number: 2048,
  paymentStatus: 'paid',
  orderStatus: 'preparing',
  amount: 4500,
  subtotal: 4500,
  discount: 0,
  branch: 'Кабанбай',
  branchId,
  orderType: 'pickup',
  deliveryStatus: 'unassigned',
  items: [{ name: 'Круассан', quantity: 2, price: 2250 }],
  earnedBonus: 0,
  refundAmount: 0,
  createdAt: now,
  updatedAt: now,
  customer: { name: 'Айдана', phone: '+7 700 123 45 67' },
};

const summary = {
  success: true,
  updatedAt: now,
  capabilities: {
    orders: true,
    kitchen: true,
    dispatch: true,
    support: true,
    whatsapp: true,
    inventory: true,
  },
  counts: {
    newOrders: 0,
    activeOrders: 1,
    kitchenOverdue: 0,
    deliveryAttention: 0,
    paymentIssues: 0,
    supportNew: 0,
    supportOverdue: 0,
    supportMine: 0,
    whatsappUnread: 0,
    whatsappDialogs: 0,
    stoppedProducts: 0,
  },
  orders: [],
  support: [],
  whatsapp: [],
};

test('orders workspace hides partial refund and item replacement actions', async ({ page }) => {
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
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
        body: JSON.stringify({ success: true, locations: [], selectedBranchId: null }),
      });
    }
    if (path === '/admin/api/operations/summary') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(summary),
      });
    }
    if (path === '/admin/api/orders') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [order], total: 1, page: 1, pageSize: 50 }),
      });
    }
    if (path === '/admin/api/couriers') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, couriers: [] }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/orders');
  await expect(page.getByText('№2048', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'По позициям' })).toHaveCount(0);
  await expect(page.getByText(/Частичный возврат/)).toHaveCount(0);
  await expect(page.getByText('Заменить товар')).toHaveCount(0);
});
