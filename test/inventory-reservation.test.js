const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(
  __dirname,
  '../supabase/migrations/20260729090000_inventory_reservation_integrity.sql',
);

const loadInventoryService = (t, rpc) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/inventory.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];

  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: { rpc } },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  return require(servicePath);
};

test('reservation API forwards an exact payment expiry to inventory and slot RPCs', async (t) => {
  const calls = [];
  const service = loadInventoryService(t, async (name, args) => {
    calls.push({ name, args });
    return { data: { status: 'reserved' }, error: null };
  });
  const reservationExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await service.reserveCheckout({
    customerId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    branchId: '33333333-3333-4333-8333-333333333333',
    items: [{ id: 'product-1', quantity: 1 }],
    orderType: 'pickup',
    scheduledAt: '2026-07-29T12:00:00.000Z',
    reservationExpiresAt,
    ttlMinutes: 35,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'reserve_order_inventory');
  assert.equal(calls[1].name, 'reserve_fulfillment_slot');
  assert.equal(calls[0].args.p_expires_at, reservationExpiresAt);
  assert.equal(calls[1].args.p_expires_at, reservationExpiresAt);
  assert.equal(calls[0].args.p_ttl_minutes, 35);
  assert.equal(calls[1].args.p_ttl_minutes, 35);
  assert.equal(service.normalizeReservationExpiry().ttlMinutes, 20);
});

test('expired commit fails closed and reacquire helper exposes machine-readable result', async (t) => {
  const calls = [];
  const service = loadInventoryService(t, async (name, args) => {
    calls.push({ name, args });
    if (args.p_allow_reacquire) {
      return {
        data: {
          status: 'committed',
          inventoryRequested: 1,
          inventoryCommitted: 1,
          inventoryUnitsRequested: 2,
          inventoryUnitsCommitted: 2,
          slotRequested: 1,
          slotCommitted: 1,
          reacquired: true,
        },
        error: null,
      };
    }
    return {
      data: {
        status: 'expired',
        inventoryRequested: 1,
        inventoryCommitted: 0,
        inventoryUnitsRequested: 2,
        inventoryUnitsCommitted: 0,
        slotRequested: 1,
        slotCommitted: 0,
        reacquired: false,
      },
      error: null,
    };
  });

  await assert.rejects(
    () => service.commitOrderReservations('44444444-4444-4444-8444-444444444444'),
    (error) =>
      error.code === 'RESERVATION_EXPIRED' &&
      error.statusCode === 409 &&
      error.reservation?.status === 'expired',
  );

  const recovered = await service.commitOrReacquireOrderReservations(
    '44444444-4444-4444-8444-444444444444',
    { allowReacquire: true },
  );
  assert.equal(recovered.status, 'committed');
  assert.equal(recovered.reacquired, true);
  assert.equal(recovered.inventoryUnitsCommitted, 2);
  assert.equal(calls.at(-1).args.p_allow_reacquire, true);
});

test('order attachment fails closed unless the RPC confirms the slot and inventory link', async (t) => {
  let attached = false;
  const service = loadInventoryService(t, async (name) => ({
    data:
      name === 'attach_order_reservations' && attached
        ? { status: 'attached', inventoryAttached: 1, slotAttached: 1 }
        : { status: 'expired' },
    error: null,
  }));
  await assert.rejects(
    () =>
      service.attachOrderReservations(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ),
    /Не удалось связать резерв/,
  );
  attached = true;
  const result = await service.attachOrderReservations(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  );
  assert.equal(result.status, 'attached');
  assert.equal(result.slotAttached, 1);
});

test('integrity migration aggregates products and rejects expired commits', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /jsonb_each_text\(aggregated_items\)/i);
  assert.doesNotMatch(sql, /quantity\s*=\s*excluded\.quantity/i);
  assert.match(sql, /p_allow_reacquire boolean default false/i);
  assert.match(sql, /then 'released' else 'expired'/i);
  assert.match(sql, /expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /inventoryUnitsCommitted/i);
  assert.match(sql, /returns jsonb[\s\S]+status', 'attached'/i);
});
