const test = require('node:test');
const assert = require('node:assert/strict');

test('atomic delivery slot refusal releases the preceding inventory hold and requires requote', async (t) => {
  const calls = [];
  const released = [];
  const supabase = {};
  supabase.rpc = async (name, body) => {
    calls.push({ name, body });
    return name === 'reserve_order_inventory'
      ? { data: { id: 'inventory' } }
      : { error: { code: 'P0001', message: 'Нет свободных мест в выбранном интервале' } };
  };
  supabase.from = (table) => {
    const filters = [];
    const query = {
      update(value) {
        released.push({ table, value, filters });
        return query;
      },
      eq(key, value) {
        filters.push([key, value]);
        return query;
      },
      then(resolve) {
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return query;
  };
  const configId = require.resolve('../src/config/supabase');
  const inventoryId = require.resolve('../src/services/inventory.service');
  const saved = [require.cache[configId], require.cache[inventoryId]];
  require.cache[configId] = {
    id: configId,
    filename: configId,
    loaded: true,
    exports: { supabase },
  };
  delete require.cache[inventoryId];
  t.after(() => {
    for (const [index, id] of [configId, inventoryId].entries()) {
      if (saved[index]) require.cache[id] = saved[index];
      else delete require.cache[id];
    }
  });
  const { reserveCheckout } = require('../src/services/inventory.service');
  await assert.rejects(
    reserveCheckout({
      customerId: 'customer',
      requestId: 'request',
      branchId: 'quoted-branch',
      items: [],
      orderType: 'delivery',
      scheduledAt: '2026-10-07T10:00:00.000Z',
      ttlMinutes: 35,
    }),
    (error) => error.statusCode === 409 && error.code === 'CHECKOUT_QUOTE_CHANGED',
  );
  assert.deepEqual(
    calls.map(({ name }) => name),
    ['reserve_order_inventory', 'reserve_fulfillment_slot'],
  );
  assert.equal(calls[1].body.p_branch_id, 'quoted-branch');
  assert.equal(calls[1].body.p_scheduled_at, '2026-10-07T10:00:00.000Z');
  assert.deepEqual(
    released.map(({ table }) => table),
    ['inventory_reservations', 'fulfillment_slot_reservations'],
  );
  for (const { value, filters } of released) {
    assert.equal(value.status, 'released');
    assert.deepEqual(filters, [
      ['customer_id', 'customer'],
      ['client_request_id', 'request'],
      ['status', 'active'],
    ]);
  }
});
