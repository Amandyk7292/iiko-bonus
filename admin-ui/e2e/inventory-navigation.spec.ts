import { expect, test } from '@playwright/test';

const branchA = '11111111-1111-4111-8111-111111111111';
const branchB = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';

const locations = [
  { id: branchA, name: 'Арнау', address: 'Улы Дала, 67', city: 'Астана', active: true },
  { id: branchB, name: 'Панорама', address: 'Улы Дала, 41/2', city: 'Астана', active: true },
];

const inventoryItem = (branchId: string, quantity: number) => ({
  branch_id: branchId,
  product_id: productId,
  product_name: branchId === branchA ? 'Круассан Арнау' : 'Круассан Панорама',
  source_quantity: quantity,
  manual_stop: false,
  source: 'admin',
  last_synced_at: '2026-07-29T08:00:00.000Z',
  updated_at: '2026-07-29T08:00:00.000Z',
  bulka_locations: { name: branchId === branchA ? 'Арнау' : 'Панорама' },
});

const operationsSummary = {
  success: true,
  updatedAt: '2026-07-29T08:00:00.000Z',
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
    activeOrders: 0,
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

test('legacy inventory navigation reaches the menu and applies the stop list in the selected scope', async ({
  page,
}) => {
  const menuScopes: string[] = [];
  const changes: Record<string, unknown>[] = [];
  await page.addInitScript((id) => localStorage.setItem('adminSelectedBranchId', id), branchA);
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/api/menu') {
      menuScopes.push(request.headers()['x-bulka-branch-id']);
      return route.fulfill({
        json: {
          success: true,
          profileKey: 'default',
          rawMenu: {
            products: [{ id: productId, name: 'Круассан Арнау', price: 300 }],
            groups: [],
          },
          overrides: { products: [], categories: [], customProducts: [] },
        },
      });
    }
    if (url.pathname === '/admin/api/menu/product/override') {
      changes.push(request.postDataJSON());
      return route.fulfill({ json: { success: true } });
    }
    if (url.pathname === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'owner', role: 'owner', branchIds: [] } }),
      });
    }
    if (url.pathname === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations, selectedBranchId: null }),
      });
    }
    if (url.pathname === '/admin/api/operations/summary') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(operationsSummary),
      });
    }
    if (url.pathname === '/admin/api/locations') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations }),
      });
    }
    if (url.pathname === '/admin/api/inventory') {
      const selectedBranch = url.searchParams.get('branchId') || '';
      const inventory =
        selectedBranch === branchA
          ? [inventoryItem(branchA, 10)]
          : selectedBranch === branchB
            ? [inventoryItem(branchB, 3)]
            : [inventoryItem(branchA, 10), inventoryItem(branchB, 3)];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, inventory }),
      });
    }
    if (url.pathname === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not mocked' }),
    });
  });

  await page.goto('/admin/operations');
  await page.getByRole('link', { name: /Стоп-лист/ }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);
  await expect(page.getByRole('heading', { name: 'Круассан Арнау' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить в стоп-лист', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Убрать из стоп-листа', exact: true }),
  ).toBeVisible();
  expect(changes[0]).toMatchObject({
    iikoProductId: productId,
    overrides: { is_stop_listed: true },
  });
  expect(menuScopes).toContain(branchA);

  await page.goto(`/admin/inventory?branch=${branchB}`);
  await expect(page).toHaveURL(/\/admin\/menu$/);
  await expect(page.locator('input[name^="inventoryQuantity-"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Круассан Арнау' })).toBeVisible();
});
