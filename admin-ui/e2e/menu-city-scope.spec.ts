import { expect, test } from '@playwright/test';

const locations = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Кабанбай',
    address: 'проспект Кабанбай батыра, 46а',
    city: 'Астана',
    active: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Улы Дала',
    address: 'проспект Улы Дала, 67',
    city: 'Астана',
    active: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Дукат',
    address: '17-й микрорайон, 1',
    city: 'Актау',
    active: true,
  },
];

test('menu switches the iiko scope by city and sends the selected branch', async ({ page }) => {
  const menuRequests: string[] = [];

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
        body: JSON.stringify({ success: true, locations, selectedBranchId: null }),
      });
    }
    if (path === '/admin/api/menu') {
      menuRequests.push(request.headers()['x-bulka-branch-id'] || '');
      const isAktau = menuRequests.at(-1) === locations[2].id;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profileKey: isAktau ? 'default' : 'astana',
          profiles: {
            default: { key: 'default', configured: true },
            astana: { key: 'astana', configured: true, city: 'Астана' },
          },
          rawMenu: {
            groups: [{ id: `${isAktau ? 'aktau' : 'astana'}-group`, name: 'Выпечка' }],
            products: [
              {
                id: `${isAktau ? 'aktau' : 'astana'}-croissant`,
                name: isAktau ? 'Круассан Актау' : 'Круассан Астана',
                parentGroup: `${isAktau ? 'aktau' : 'astana'}-group`,
                price: 1800,
              },
            ],
          },
          overrides: { products: [], categories: [], customProducts: [] },
        }),
      });
    }
    if (path === '/admin/api/operations/summary') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          updatedAt: '2026-08-02T08:00:00.000Z',
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
        }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/menu');
  await expect(page.getByRole('heading', { name: 'Меню по городам' })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать меню города Астана, 2 филиала' }).click();
  await expect(page.getByText('Круассан Астана')).toBeVisible();
  await expect(page.locator('select[aria-label="Город для настройки меню"]')).toHaveValue('астана');

  await page.getByRole('button', { name: 'Редактировать меню города Актау, 1 филиал' }).click();
  await expect(page.getByText('Круассан Актау')).toBeVisible();
  await expect(page.locator('select[aria-label="Город для настройки меню"]')).toHaveValue('актау');
  expect([...new Set(menuRequests)]).toEqual([locations[0].id, locations[2].id]);
});
