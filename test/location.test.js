const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = require.resolve('../src/config/supabase');
const servicePath = require.resolve('../src/services/location.service');

async function withLocationService(supabase, callback) {
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  delete require.cache[servicePath];
  try {
    return await callback(require(servicePath));
  } finally {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  }
}

const activeRow = {
  id: '36f3f0a5-b914-47f6-b768-67a9c84552c9',
  name: 'ЖК Central Park',
  city: 'Актау',
  address: '34 микрорайон',
  latitude: 43.6821,
  longitude: 51.1689,
  active: true,
  pickup_enabled: true,
  preorder_enabled: true,
  delivery_enabled: false,
  sort_order: 1,
};

test('bulk delivery zones are written to every active branch in one update', async () => {
  const calls = [];
  let fromCall = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'bulka_locations');
      fromCall += 1;
      if (fromCall === 1) {
        return {
          select() { return this; },
          eq(column, value) {
            calls.push(['select-active', column, value]);
            return Promise.resolve({ data: [activeRow], error: null });
          },
        };
      }
      return {
        update(values) { calls.push(['update', values]); return this; },
        eq(column, value) { calls.push(['update-active', column, value]); return this; },
        select() {
          return Promise.resolve({
            data: [{
              ...activeRow,
              delivery_enabled: true,
              delivery_radius_km: 5,
              delivery_fee: 700,
              delivery_min_order: 3000,
              delivery_zones: [{ id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: '#66BB6A' }],
            }],
            error: null,
          });
        },
      };
    },
  };

  await withLocationService(supabase, async ({ updateActiveLocationDeliveryZones }) => {
    const result = await updateActiveLocationDeliveryZones({
      enableDelivery: true,
      deliveryZones: [{ id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: '#66BB6A' }],
    });
    assert.equal(result.updatedCount, 1);
    assert.equal(result.locations[0].deliveryEnabled, true);
  });

  const update = calls.find(([name]) => name === 'update')[1];
  assert.equal(update.delivery_enabled, true);
  assert.equal(update.delivery_radius_km, 5);
  assert.deepEqual(update.delivery_zones, [
    { id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: '#66BB6A' },
  ]);
  assert.deepEqual(calls.filter(([name]) => name === 'update-active'), [
    ['update-active', 'active', true],
  ]);
});

test('bulk enable is rejected before update when an active branch has no coordinates', async () => {
  let updateCalled = false;
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() {
          return Promise.resolve({ data: [{ ...activeRow, latitude: null, longitude: null }], error: null });
        },
        update() { updateCalled = true; return this; },
      };
    },
  };

  await withLocationService(supabase, async ({ updateActiveLocationDeliveryZones }) => {
    await assert.rejects(
      updateActiveLocationDeliveryZones({
        enableDelivery: true,
        deliveryZones: [{ id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: '#66BB6A' }],
      }),
      /Сначала укажите координаты филиалов/,
    );
  });
  assert.equal(updateCalled, false);
});

test('a city is created with a normalized name and map center', async () => {
  let inserted;
  const cityId = '11111111-1111-4111-8111-111111111111';
  const supabase = {
    from(table) {
      assert.equal(table, 'bulka_cities');
      return {
        insert(value) {
          inserted = value;
          return this;
        },
        select() {
          return this;
        },
        single() {
          return Promise.resolve({
            data: {
              id: cityId,
              ...inserted,
              created_at: '2026-07-26T00:00:00.000Z',
              updated_at: '2026-07-26T00:00:00.000Z',
            },
            error: null,
          });
        },
      };
    },
  };

  await withLocationService(supabase, async ({ createBulkaCity }) => {
    const city = await createBulkaCity({
      name: '  Алматы   ',
      latitude: 43.238949,
      longitude: 76.889709,
    });
    assert.equal(city.id, cityId);
    assert.equal(city.name, 'Алматы');
    assert.equal(city.latitude, 43.238949);
    assert.equal(city.longitude, 76.889709);
  });

  assert.deepEqual(inserted, {
    name: 'Алматы',
    center_latitude: 43.238949,
    center_longitude: 76.889709,
    active: true,
  });
});

test('a new branch is stored in the canonical location table and linked to its city', async () => {
  const cityId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  let inserted;
  const supabase = {
    from(table) {
      if (table === 'bulka_cities') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                id: cityId,
                name: 'Алматы',
                center_latitude: 43.238949,
                center_longitude: 76.889709,
                active: true,
              },
              error: null,
            });
          },
        };
      }
      assert.equal(table, 'bulka_locations');
      return {
        insert(value) {
          inserted = value;
          return this;
        },
        select() {
          return this;
        },
        single() {
          return Promise.resolve({ data: { id: locationId, ...inserted }, error: null });
        },
      };
    },
  };

  await withLocationService(supabase, async ({ createBulkaLocation }) => {
    const location = await createBulkaLocation({
      cityId,
      name: 'Bulka — Достык',
      address: 'проспект Достык, 52',
      latitude: 43.2338,
      longitude: 76.9565,
      hours: { daily: { open: '08:00', close: '22:00' } },
    });
    assert.equal(location.id, locationId);
    assert.equal(location.cityId, cityId);
    assert.equal(location.city, 'Алматы');
    assert.equal(location.deliveryEnabled, false);
  });

  assert.equal(inserted.city_id, cityId);
  assert.equal(inserted.city, 'Алматы');
  assert.equal(inserted.name, 'Bulka — Достык');
  assert.equal(inserted.address, 'проспект Достык, 52');
  assert.deepEqual(inserted.delivery_zones, [
    { id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: '#66BB6A' },
  ]);
});

test('a branch cannot be created far outside the selected city', async () => {
  let locationInsertCalled = false;
  const supabase = {
    from(table) {
      if (table === 'bulka_cities') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Астана',
                center_latitude: 51.1282,
                center_longitude: 71.4307,
                active: true,
              },
              error: null,
            });
          },
        };
      }
      locationInsertCalled = true;
      throw new Error(`Unexpected table ${table}`);
    },
  };

  await withLocationService(supabase, async ({ createBulkaLocation }) => {
    await assert.rejects(
      createBulkaLocation({
        cityId: '11111111-1111-4111-8111-111111111111',
        name: 'Чужой филиал',
        address: '17-й микрорайон, 1',
        latitude: 43.66944,
        longitude: 51.136929,
      }),
      /слишком далеко/,
    );
  });

  assert.equal(locationInsertCalled, false);
});

test('location city migration backfills current branches and remains service-role only', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '../supabase/migrations/20260726012000_location_city_management.sql',
    ),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.bulka_cities/);
  assert.match(sql, /add column if not exists city_id uuid/);
  assert.match(sql, /update public\.bulka_locations location[\s\S]*set city_id = city\.id/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.bulka_cities from public, anon, authenticated/);
});
