import { expect, test } from '@playwright/test';

const locations = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bulka — Кабанбай батыра, 46а',
    address: 'проспект Кабанбай батыра, 46а',
    city: 'Астана',
    latitude: 51.11513,
    longitude: 71.41368,
    hours: { daily: { open: '08:30', close: '20:30' } },
    active: true,
    pickupEnabled: true,
    preorderEnabled: true,
    deliveryEnabled: false,
    deliveryRadiusKm: null,
    deliveryFee: null,
    deliveryMinOrder: null,
    deliveryZones: [],
    slotMinutes: 60,
    pickupSlotCapacity: 20,
    preorderSlotCapacity: 10,
    deliverySlotCapacity: 15,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Bulka — Улы Дала, 67',
    address: 'проспект Улы Дала, 67',
    city: 'Астана',
    latitude: 51.09363,
    longitude: 71.44488,
    hours: { daily: { open: '08:30', close: '20:30' } },
    active: true,
    pickupEnabled: true,
    preorderEnabled: true,
    deliveryEnabled: false,
    deliveryRadiusKm: null,
    deliveryFee: null,
    deliveryMinOrder: null,
    deliveryZones: [],
    slotMinutes: 60,
    pickupSlotCapacity: 20,
    preorderSlotCapacity: 10,
    deliverySlotCapacity: 15,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'ЖК Дукат',
    address: '17-й микрорайон, 1',
    city: 'Актау',
    latitude: 43.66944,
    longitude: 51.13693,
    hours: { daily: { open: '08:00', close: '24:00' } },
    active: true,
    pickupEnabled: true,
    preorderEnabled: true,
    deliveryEnabled: true,
    deliveryRadiusKm: 10,
    deliveryFee: 1500,
    deliveryMinOrder: 2000,
    deliveryZones: [],
    slotMinutes: 60,
    pickupSlotCapacity: 20,
    preorderSlotCapacity: 10,
    deliverySlotCapacity: 15,
  },
];

const cities = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Астана',
    latitude: 51.1282,
    longitude: 71.4307,
    active: true,
    branchCount: 2,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Актау',
    latitude: 43.6532,
    longitude: 51.1975,
    active: true,
    branchCount: 1,
  },
];

test('locations can be viewed one city at a time and the choice stays in the URL', async ({
  page,
}, testInfo) => {
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
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
    if (path === '/admin/api/locations') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations }),
      });
    }
    if (path === '/admin/api/locations/cities') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, cities }),
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

  await page.goto('/admin/locations');
  await expect(page.getByRole('heading', { name: 'Города и филиалы' })).toBeVisible();

  const astana = page.getByRole('button', { name: 'Астана' });
  const aktau = page.getByRole('button', { name: 'Актау' });
  const allCities = page.getByRole('button', { name: 'Все города' });
  const table = page.locator('.locations-table');

  await expect(astana).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/city=%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0/);
  await expect(table.getByText('Bulka — Кабанбай батыра, 46а')).toBeVisible();
  await expect(table.getByText('ЖК Дукат')).toHaveCount(0);

  await aktau.click();
  await expect(aktau).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/city=%D0%90%D0%BA%D1%82%D0%B0%D1%83/);
  await expect(table.getByText('ЖК Дукат')).toBeVisible();
  await expect(table.getByText('Bulka — Кабанбай батыра, 46а')).toHaveCount(0);

  await page.reload();
  await expect(aktau).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByText('ЖК Дукат')).toBeVisible();

  await allCities.click();
  await expect(allCities).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByText('ЖК Дукат')).toBeVisible();
  await expect(table.getByText('Bulka — Кабанбай батыра, 46а')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('locations-city-filter.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
