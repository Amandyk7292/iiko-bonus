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

test('branch name and full address can be edited independently of map coordinates', async () => {
  let updates;
  const database = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        update(value) {
          updates = value;
          return this;
        },
        maybeSingle: async () => ({ data: { ...activeRow, ...updates }, error: null }),
      };
    },
  };
  await withLocationService(database, async (service) => {
    const result = await service.updateBulkaLocation(activeRow.id, {
      name: '  Новый филиал  ',
      address: '  Актау, 19-й микрорайон, 17/2  ',
    });
    assert.equal(result.name, 'Новый филиал');
    assert.equal(result.address, 'Актау, 19-й микрорайон, 17/2');
    assert.equal(updates.latitude, undefined);
    assert.equal(updates.longitude, undefined);
    await assert.rejects(service.updateBulkaLocation(activeRow.id, { address: ' ' }));
  });
});

test('delivery can be enabled with coordinates and no zones or tariff settings', async () => {
  let updates;
  const database = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        update(value) {
          updates = value;
          return this;
        },
        maybeSingle: async () => ({ data: { ...activeRow, ...updates }, error: null }),
      };
    },
  };
  await withLocationService(database, async (service) => {
    const result = await service.updateBulkaLocation(activeRow.id, { deliveryEnabled: true });
    assert.equal(result.deliveryEnabled, true);
    assert.equal('deliveryZones' in result, false);
    assert.equal('delivery_fee' in updates, false);
    assert.equal(service.updateActiveLocationDeliveryZones, undefined);
  });
});

test('delivery still needs real branch coordinates', async () => {
  const database = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: { ...activeRow, latitude: null, longitude: null },
          error: null,
        }),
      };
    },
  };
  await withLocationService(database, async (service) => {
    await assert.rejects(
      service.updateBulkaLocation(activeRow.id, { deliveryEnabled: true }),
      /координаты/,
    );
  });
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
  assert.equal('delivery_zones' in inserted, false);
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
    path.join(__dirname, '../supabase/migrations/20260726012000_location_city_management.sql'),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.bulka_cities/);
  assert.match(sql, /add column if not exists city_id uuid/);
  assert.match(sql, /update public\.bulka_locations location[\s\S]*set city_id = city\.id/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.bulka_cities from public, anon, authenticated/);
});
