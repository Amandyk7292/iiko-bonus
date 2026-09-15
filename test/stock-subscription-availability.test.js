const test = require('node:test');
const assert = require('node:assert/strict');

test('stock notifications agree with catalog for weights, preorders, stale snapshots and stops', async (t) => {
  let inventory = {
    product_id: 'product',
    source_quantity: 0.5,
    quantity_step: 0.001,
    unit: 'кг',
    manual_stop: false,
    source: 'front',
  };
  let reservations = [];
  let front = { configured: true, guardEnabled: true, connected: true };
  const cached = new Map();
  const stub = (file, exports) => {
    const id = require.resolve(file);
    cached.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  t.after(() => {
    for (const [id, value] of cached) {
      if (value) require.cache[id] = value;
      else delete require.cache[id];
    }
  });
  stub('../src/config/supabase', {
    supabase: {
      from(table) {
        let single = false,
          fields = '';
        return {
          select(value) {
            fields = value;
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return this;
          },
          maybeSingle() {
            single = true;
            return this;
          },
          then(resolve, reject) {
            const rows = (table === 'branch_product_inventory' ? [inventory] : reservations).map(
              (row) =>
                Object.fromEntries(
                  fields
                    .split(',')
                    .filter((key) => key in row)
                    .map((key) => [key, row[key]]),
                ),
            );
            return Promise.resolve({ data: single ? rows[0] : rows, error: null }).then(
              resolve,
              reject,
            );
          },
        };
      },
    },
  });
  stub('../src/services/front-inventory.service', { getFrontInventoryStatus: async () => front });
  stub('../src/services/iiko-city-profile.service', {});
  stub('../src/services/push.service', {});
  const { currentAvailability } = require('../src/services/stock-subscription.service');
  const { getBranchAvailability } = require('../src/services/inventory.service');
  async function check(expected) {
    assert.equal((await currentAvailability('branch', 'product')).available, expected);
    assert.equal((await getBranchAvailability('branch')).get('product').isAvailable, expected);
  }
  await check(true);
  inventory = { ...inventory, source_quantity: 3, quantity_step: 1, unit: 'шт' };
  reservations = [
    { product_id: 'product', quantity: 3, status: 'committed', allocation_kind: 'preorder' },
  ];
  await check(true);
  reservations[0].allocation_kind = 'display';
  await check(false);
  reservations = [];
  inventory.manual_stop = true;
  await check(false);
  inventory.manual_stop = false;
  front.connected = false;
  await check(false);
  front = { configured: true, guardEnabled: false, connected: false };
  await check(false);
  inventory.source = 'admin';
  await check(true);
});
