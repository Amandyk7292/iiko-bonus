const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrderTotal } = require('../src/services/order.service');

function stub(t, path, exports) {
  const id = require.resolve(path),
    previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
}

function reload(t, path) {
  const id = require.resolve(path),
    previous = require.cache[id];
  delete require.cache[id];
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
  return require(path);
}

function services(t, inventory, holds = [], frontSync = { configured: false }) {
  const tables = {
    branch_product_inventory: inventory.map((row) => ({
      branch_id: 'branch',
      source: 'iiko',
      ...row,
    })),
    inventory_reservations: holds.map((row) => ({ branch_id: 'branch', ...row })),
  };
  stub(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        let rows = tables[table],
          single = false;
        assert.ok(rows, `Unexpected table ${table}`);
        return {
          select() {
            return this;
          },
          eq(key, value) {
            rows = rows.filter((row) => row[key] === value);
            return this;
          },
          in(key, values) {
            rows = rows.filter((row) => values.includes(row[key]));
            return this;
          },
          maybeSingle() {
            single = true;
            return this;
          },
          then(resolve) {
            resolve({ data: single ? rows[0] || null : rows, error: null });
          },
        };
      },
    },
  });
  stub(t, '../src/services/front-inventory.service', {
    getFrontInventoryStatus: async () => frontSync,
  });
  return {
    inventory: reload(t, '../src/services/inventory.service'),
    subscriptions: reload(t, '../src/services/stock-subscription.service'),
  };
}

test('the customer catalog and quote reject the last unit while the cashier sees the physical unit', async (t) => {
  const { inventory } = services(t, [
    { product_id: 'last', product_name: 'Плюшка', source_quantity: 1 },
    { product_id: 'two', source_quantity: 2 },
    { product_id: 'manual', source_quantity: 1, source: 'admin' },
    { product_id: 'custom', source_quantity: 1, source: 'custom' },
    { product_id: 'unlimited', source_quantity: null },
  ]);
  const online = await inventory.getBranchAvailability('branch', { strict: true });
  for (const id of ['last', 'manual', 'custom']) {
    assert.equal(online.get(id).availableQuantity, 0);
    assert.equal(online.get(id).isAvailable, false);
    assert.equal(online.get(id).sourceQuantity, 1);
  }
  assert.equal(online.get('two').availableQuantity, 1);
  assert.equal(online.get('two').isAvailable, true);
  assert.equal(online.get('unlimited').availableQuantity, 0);
  assert.equal(online.get('unlimited').isAvailable, false);
  const catalog = new Map(
    [...online].map(([id, stock]) => [id, { ...stock, name: 'Плюшка', price: 35 }]),
  );
  assert.throws(
    () => calculateOrderTotal([{ id: 'last', quantity: 1 }], catalog),
    /сейчас недоступен/,
  );
  assert.throws(() => calculateOrderTotal([{ id: 'two', quantity: 2 }], catalog), /Доступно: 1/);
  assert.equal(calculateOrderTotal([{ id: 'two', quantity: 1 }], catalog).subtotal, 35);
  const cashier = await inventory.getBranchAvailability('branch', { strict: true, online: false });
  assert.equal(cashier.get('last').sourceQuantity, 1);
  assert.equal(cashier.get('last').availableQuantity, 1);
  assert.equal(cashier.get('last').isAvailable, true);
});

test('other holds consume online capacity, expired/released holds do not and no stock notification offers the final unit', async (t) => {
  const { inventory, subscriptions } = services(
    t,
    [
      { product_id: 'bun', source_quantity: 6 },
      { product_id: 'last', source_quantity: 1 },
      { product_id: 'two', source_quantity: 2 },
    ],
    [
      { product_id: 'bun', quantity: 3, status: 'committed' },
      {
        product_id: 'bun',
        quantity: 2,
        status: 'active',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
      {
        product_id: 'two',
        quantity: 2,
        status: 'active',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      { product_id: 'two', quantity: 3, status: 'released' },
    ],
  );
  const online = await inventory.getBranchAvailability('branch', { strict: true });
  assert.equal(online.get('bun').reserved, 5);
  assert.equal(online.get('bun').availableQuantity, 0);
  assert.equal(online.get('two').availableQuantity, 1);
  for (const id of ['bun', 'last'])
    assert.equal((await subscriptions.currentAvailability('branch', id)).available, false);
  assert.equal((await subscriptions.currentAvailability('branch', 'two')).available, true);
});

test('the buffer does not bypass manual stops or stale Front protection', async (t) => {
  const { inventory } = services(
    t,
    [
      { product_id: 'front', source_quantity: 6 },
      { product_id: 'manual', source_quantity: 2, source: 'admin' },
      { product_id: 'stopped', source_quantity: 6, source: 'admin', manual_stop: true },
    ],
    [],
    { configured: true, connected: false },
  );
  const online = await inventory.getBranchAvailability('branch', { strict: true });
  assert.equal(online.get('front').isAvailable, false);
  assert.equal(online.get('front').availableQuantity, 0);
  assert.equal(online.get('manual').availableQuantity, 1);
  assert.equal(online.get('manual').isAvailable, true);
  assert.equal(online.get('stopped').isAvailable, false);
});
