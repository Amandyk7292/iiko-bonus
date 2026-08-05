import { expect, test, type Page, type Route } from '@playwright/test';

const locations = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Дукат',
    address: '17-й микрорайон, 1',
    city: 'Актау',
    active: true,
  },
];

const operationsSummary = {
  success: true,
  updatedAt: '2026-08-05T08:00:00.000Z',
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

const fulfillJson = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

async function installBaseMocks(
  page: Page,
  featureHandler: (route: Route, path: string) => Promise<boolean>,
) {
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await featureHandler(route, path)) return;
    if (path === '/admin/api/session') {
      return fulfillJson(route, {
        user: { username: 'owner', role: 'owner', branchIds: [] },
      });
    }
    if (path === '/admin/api/scope') {
      return fulfillJson(route, {
        success: true,
        locations,
        selectedBranchId: locations[0].id,
      });
    }
    if (path === '/admin/api/operations/summary') {
      return fulfillJson(route, operationsSummary);
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test('menu toggles update immediately and independent actions run in parallel', async ({
  page,
}) => {
  const mutations: Array<Record<string, unknown>> = [];
  await installBaseMocks(page, async (route, path) => {
    if (path === '/admin/api/menu') {
      await fulfillJson(route, {
        success: true,
        profileKey: 'default',
        profiles: { default: { key: 'default', configured: true, city: 'Актау' } },
        rawMenu: {
          groups: [{ id: 'buns', name: 'Булочки' }],
          products: [
            {
              id: 'berry-bun',
              name: 'Булочка Ягодянка',
              parentGroup: 'buns',
              price: 650,
            },
          ],
        },
        overrides: { products: [], categories: [], customProducts: [] },
      });
      return true;
    }
    if (
      path === '/admin/api/menu/product/override' ||
      path === '/admin/api/menu/category/override'
    ) {
      mutations.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await fulfillJson(route, { success: true });
      return true;
    }
    return false;
  });

  await page.goto('/admin/menu');
  await page.getByRole('button', { name: 'Редактировать меню города Актау, 1 филиал' }).click();
  await expect(page.getByText('Булочка Ягодянка')).toBeVisible();

  await page.getByRole('button', { name: 'Скрыть блюдо' }).click();
  await expect(page.getByRole('button', { name: 'Показать блюдо' })).toBeVisible({
    timeout: 300,
  });
  await expect(page.getByRole('button', { name: 'Добавить в стоп-лист' })).toBeEnabled();

  await page.getByRole('button', { name: 'Добавить в стоп-лист' }).click();
  await expect(page.getByRole('button', { name: 'Убрать из стоп-листа' })).toBeVisible({
    timeout: 300,
  });

  await page.getByRole('tab', { name: /Категории/ }).click();
  await page.getByRole('button', { name: /Включена/ }).click();
  await expect(page.getByRole('button', { name: /Категория скрыта/ })).toBeVisible({
    timeout: 300,
  });

  await expect.poll(() => mutations.length).toBe(3);
  expect(mutations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ overrides: { is_hidden: true } }),
      expect.objectContaining({ overrides: { is_stop_listed: true } }),
      expect.objectContaining({ overrides: { is_hidden: true } }),
    ]),
  );
});

test('courier switches update immediately without serializing different couriers', async ({
  page,
}) => {
  const mutations: Array<{ id: string; active: boolean }> = [];
  const couriers = [
    {
      id: 'courier-one',
      name: 'Курьер Один',
      phone: '+77000000001',
      vehicle: 'Велосипед',
      active: true,
      activeSessions: 1,
    },
    {
      id: 'courier-two',
      name: 'Курьер Два',
      phone: '+77000000002',
      vehicle: 'Скутер',
      active: true,
      activeSessions: 0,
    },
  ];
  await installBaseMocks(page, async (route, path) => {
    if (path === '/admin/api/couriers' && route.request().method() === 'GET') {
      await fulfillJson(route, { success: true, couriers });
      return true;
    }
    const match = path.match(/^\/admin\/api\/couriers\/([^/]+)\/active$/);
    if (match) {
      const body = route.request().postDataJSON() as { active: boolean };
      mutations.push({ id: match[1], active: body.active });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const courier = couriers.find((item) => item.id === match[1])!;
      await fulfillJson(route, {
        success: true,
        courier: { ...courier, active: body.active },
      });
      return true;
    }
    return false;
  });

  await page.goto('/admin/couriers');
  const cards = page.locator('.courier-card');
  await expect(cards).toHaveCount(2);
  const firstSwitch = cards.nth(0).getByRole('checkbox');
  const secondSwitch = cards.nth(1).getByRole('checkbox');

  await cards.nth(0).locator('.switch-row').click();
  await expect(firstSwitch).not.toBeChecked({ timeout: 300 });
  await expect(firstSwitch).toBeDisabled();
  await expect(secondSwitch).toBeEnabled();

  await cards.nth(1).locator('.switch-row').click();
  await expect(secondSwitch).not.toBeChecked({ timeout: 300 });
  await expect.poll(() => mutations.length).toBe(2);
  expect(mutations).toEqual([
    { id: 'courier-one', active: false },
    { id: 'courier-two', active: false },
  ]);
});

test('menu toggle rolls back when persistence fails', async ({ page }) => {
  await installBaseMocks(page, async (route, path) => {
    if (path === '/admin/api/menu') {
      await fulfillJson(route, {
        success: true,
        profileKey: 'default',
        profiles: { default: { key: 'default', configured: true, city: 'Актау' } },
        rawMenu: {
          groups: [{ id: 'buns', name: 'Булочки' }],
          products: [
            {
              id: 'berry-bun',
              name: 'Булочка Ягодянка',
              parentGroup: 'buns',
              price: 650,
            },
          ],
        },
        overrides: { products: [], categories: [], customProducts: [] },
      });
      return true;
    }
    if (path === '/admin/api/menu/product/override') {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'persistence failed' }),
      });
      return true;
    }
    return false;
  });

  await page.goto('/admin/menu');
  await page.getByRole('button', { name: 'Редактировать меню города Актау, 1 филиал' }).click();
  await page.getByRole('button', { name: 'Скрыть блюдо' }).click();
  await expect(page.getByRole('button', { name: 'Показать блюдо' })).toBeVisible({
    timeout: 300,
  });
  await expect(page.getByRole('button', { name: 'Скрыть блюдо' })).toBeVisible({
    timeout: 2_000,
  });
  await expect(page.getByText('Ошибка сохранения настроек')).toBeVisible();
});
