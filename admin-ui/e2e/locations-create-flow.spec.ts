import { expect, test } from '@playwright/test';

const astanaCity = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Астана',
  latitude: 51.1282,
  longitude: 71.4307,
  active: true,
  branchCount: 1,
};

const astanaLocation = {
  id: '11111111-1111-4111-8111-111111111111',
  cityId: astanaCity.id,
  name: 'Bulka — Улы Дала',
  address: 'проспект Улы Дала, 67',
  city: 'Астана',
  latitude: 51.09363,
  longitude: 71.44488,
  hours: { daily: { open: '08:30', close: '20:30' } },
  active: true,
  pickupEnabled: true,
  preorderEnabled: true,
  deliveryEnabled: false,
  deliveryRadiusKm: 5,
  deliveryFee: 700,
  deliveryMinOrder: 3000,
  deliveryZones: [
    { id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: '#66BB6A' },
  ],
  slotMinutes: 60,
  pickupSlotCapacity: 20,
  preorderSlotCapacity: 10,
  deliverySlotCapacity: 15,
};

test('owner creates a city on the map and then creates its first branch', async ({
  page,
}, testInfo) => {
  const cities: Array<Record<string, unknown>> = [{ ...astanaCity }];
  const locations: Array<Record<string, unknown>> = [{ ...astanaLocation }];
  const createdCityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const createdLocationId = '22222222-2222-4222-8222-222222222222';
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];

  await page.route('**/maps/yandex**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
        <html lang="ru"><body>
          <button id="pick-city">Выбрать Алматы</button>
          <button id="pick-branch">Выбрать филиал</button>
          <script>
            const send = value => parent.postMessage(JSON.stringify(value), location.origin);
            document.querySelector('#pick-city').addEventListener('click', () => {
              send({type:'point',latitude:43.238949,longitude:76.889709,source:'map'});
              send({type:'geocode',latitude:43.238949,longitude:76.889709,city:'Алматы',address:'Алматы, Казахстан',source:'map'});
            });
            document.querySelector('#pick-branch').addEventListener('click', () => {
              send({type:'point',latitude:43.2338,longitude:76.9565,source:'map'});
              send({type:'geocode',latitude:43.2338,longitude:76.9565,city:'Алматы',address:'проспект Достык, 52',source:'map'});
            });
            send({type:'ready'});
          </script>
        </body></html>`,
    });
  });

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
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
    if (path === '/admin/api/locations/cities' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, cities }),
      });
    }
    if (path === '/admin/api/locations/cities' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ path, body });
      const city = {
        id: createdCityId,
        name: String(body.name),
        latitude: Number(body.latitude),
        longitude: Number(body.longitude),
        active: true,
        branchCount: 0,
      };
      cities.push(city);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, city }),
      });
    }
    if (path === '/admin/api/locations' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations }),
      });
    }
    if (path === '/admin/api/locations' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ path, body });
      const location = {
        id: createdLocationId,
        cityId: createdCityId,
        name: String(body.name),
        address: String(body.address),
        city: 'Алматы',
        latitude: Number(body.latitude),
        longitude: Number(body.longitude),
        hours: body.hours,
        active: body.active,
        pickupEnabled: body.pickupEnabled,
        preorderEnabled: body.preorderEnabled,
        deliveryEnabled: body.deliveryEnabled,
        deliveryRadiusKm: 5,
        deliveryFee: 700,
        deliveryMinOrder: 3000,
        deliveryZones: body.deliveryZones,
        slotMinutes: 60,
        pickupSlotCapacity: 20,
        preorderSlotCapacity: 10,
        deliverySlotCapacity: 15,
      };
      locations.push(location);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, location }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${method} ${path}` }),
    });
  });

  await page.goto('/admin/locations');
  await page.getByRole('button', { name: 'Новый город' }).click();

  const cityDialog = page.getByRole('dialog', { name: 'Новый город' });
  await expect(cityDialog).toBeVisible();
  await cityDialog
    .frameLocator('iframe[title="Центр города на карте"]')
    .locator('#pick-city')
    .click();
  await expect(cityDialog.getByLabel('Название города')).toHaveValue('Алматы');
  await cityDialog.getByRole('button', { name: 'Создать город' }).click();

  const pointDialog = page.getByRole('dialog', { name: 'Новый филиал' });
  await expect(pointDialog).toBeVisible();
  await expect(pointDialog.getByLabel('Название города')).toHaveValue(createdCityId);
  await pointDialog.getByLabel('Название филиала').fill('Bulka — Достык');
  await pointDialog
    .frameLocator('iframe[title="Точка на карте"]')
    .locator('#pick-branch')
    .click();
  await expect(pointDialog.getByLabel('Точный адрес')).toHaveValue('проспект Достык, 52');
  await pointDialog.getByRole('button', { name: 'Создать филиал' }).click();

  await expect(pointDialog).toBeHidden();
  await expect(page).toHaveURL(/city=%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B/);
  await expect(page.getByRole('button', { name: 'Алматы' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.locations-table').getByText('Bulka — Достык')).toBeVisible();
  await expect(page.locator('.locations-table').getByText('проспект Достык, 52')).toBeVisible();

  expect(mutations).toHaveLength(2);
  expect(mutations[0]).toEqual({
    path: '/admin/api/locations/cities',
    body: { name: 'Алматы', latitude: 43.238949, longitude: 76.889709 },
  });
  expect(mutations[1].body).toMatchObject({
    cityId: createdCityId,
    name: 'Bulka — Достык',
    address: 'проспект Достык, 52',
    latitude: 43.2338,
    longitude: 76.9565,
  });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('locations-create-flow.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
