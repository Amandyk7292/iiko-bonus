const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { EventEmitter } = require('node:events');
const realtime = require('../src/services/realtime.service');

test('stock invalidation reaches guests and customers with branch scope and no receipt data', () => {
  realtime.resetForTests();
  try {
    const branchId = randomUUID();
    for (const identity of [{ public: true }, { customerId: 'customer' }]) {
      const frames = [];
      const req = new EventEmitter();
      realtime.openStream(
        req,
        { status() {}, set() {}, write: (s) => frames.push(s), end() {} },
        identity,
      );
      realtime.publish(
        'menu.updated',
        { inventory: true, branchId, receipt: 'private' },
        { adminOnly: true, branchId },
      );
      const events = frames.filter((s) => s.startsWith('data:')).map((s) => JSON.parse(s.slice(5)));
      assert.deepEqual(events.at(-1).data, { domains: ['menu'], inventory: true, branchId });
      assert.ok(!JSON.stringify(events).includes('private'));
      req.emit('close');
    }
  } finally {
    realtime.resetForTests();
  }
});

test('catalog stock refresh returns fresh branch quantities without downloading menu data', async (t) => {
  const config = require('../src/config/supabase');
  const previousDatabase = config.supabase;
  const supabase = { from() {} };
  config.supabase = supabase;
  t.after(() => {
    config.supabase = previousDatabase;
  });
  const inventory = require('../src/services/inventory.service');
  const branchId = randomUUID();
  let quantity = 10,
    active = true,
    failure = false;
  t.mock.method(supabase, 'from', (table) => {
    assert.equal(table, 'bulka_locations');
    return {
      select() {
        return this;
      },
      eq(key, value) {
        assert.equal(key, 'id');
        assert.equal(value, branchId);
        return this;
      },
      maybeSingle: async () => ({ data: { active, pickup_enabled: true, preorder_enabled: true } }),
    };
  });
  t.mock.method(inventory, 'getBranchAvailability', async (id, options) => {
    assert.equal(id, branchId);
    assert.equal(options.strict, true);
    if (failure) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
    return new Map([
      [
        'bun',
        {
          availableQuantity: options.preorder ? null : quantity,
          isAvailable: options.preorder || quantity > 0,
          quantityStep: 1,
          unit: 'шт',
          sourceQuantity: 999,
          reserved: 10,
          internal: 'private',
        },
      ],
    ]);
  });
  const app = express();
  require('../src/routes/public/menu-stock.routes').registerMenuStockPublicRoutes(app);
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/public/menu-stock`;
  const path = `${url}?branchId=${branchId}`;
  const before = await fetch(path);
  assert.equal(before.headers.get('cache-control'), 'no-store');
  const etag = before.headers.get('etag');
  assert.equal((await before.json()).products[0].availableQuantity, 10);
  quantity = 5;
  const after = await fetch(path, { headers: { 'If-None-Match': etag } });
  assert.equal(after.status, 200);
  assert.deepEqual((await after.json()).products, [
    { id: 'bun', availableQuantity: 5, isAvailable: true, quantityStep: 1, unit: 'шт' },
  ]);
  quantity = 0;
  assert.equal((await (await fetch(path)).json()).products[0].isAvailable, false);
  assert.equal(
    (await (await fetch(`${path}&orderType=preorder`)).json()).products[0].availableQuantity,
    null,
  );
  assert.equal((await fetch(url)).status, 400);
  assert.equal((await fetch(`${path}&orderType=anything`)).status, 400);
  active = false;
  assert.equal((await fetch(path)).status, 404);
  active = true;
  failure = true;
  assert.equal(
    (await fetch(path)).status,
    503,
    'failed stock reads cannot publish an empty or stale count',
  );
});
