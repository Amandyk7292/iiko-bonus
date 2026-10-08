const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('failed reservation cleanup is retried after fulfillment cancellation', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const previous = require.cache[configPath];
  const order = {
    id: 'failed-order',
    status: 'failed',
    fulfillment_status: 'new',
    payment_cleanup_completed_at: null,
    updated_at: '2026-10-08T10:00:00Z',
  };
  const db = {
    from(table) {
      assert.equal(table, 'kaspi_orders');
      let patch = null;
      const conditions = [];
      const execute = () => {
        const matches = conditions.every((condition) => condition(order));
        if (matches && patch) Object.assign(order, patch);
        return { data: matches ? { ...order } : null, error: null };
      };
      const query = {
        select() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        update(values) {
          patch = values;
          return this;
        },
        eq(key, value) {
          conditions.push((row) => row[key] === value);
          return this;
        },
        in(key, values) {
          conditions.push((row) => values.includes(row[key]));
          return this;
        },
        is(key, value) {
          conditions.push((row) => row[key] === value);
          return this;
        },
        lt(key, value) {
          conditions.push((row) => row[key] < value);
          return this;
        },
        async maybeSingle() {
          return execute();
        },
        then(resolve, reject) {
          const result = execute();
          if (!patch) result.data = result.data ? [result.data] : [];
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: db },
  };
  const servicePath = require.resolve('../src/services/payment-cleanup.service');
  delete require.cache[servicePath];
  t.after(() => {
    if (previous) require.cache[configPath] = previous;
    else delete require.cache[configPath];
    delete require.cache[servicePath];
  });
  const { PaymentCleanupService } = require('../src/services/payment-cleanup.service');
  let inventoryAttempts = 0,
    promotionAttempts = 0,
    published = 0;
  const service = new PaymentCleanupService({
    releaseReservations: async () => {
      if (++inventoryAttempts === 1) throw new Error('temporary inventory outage');
    },
    releasePromotion: async () => {
      promotionAttempts++;
    },
    operations: { recordCleanupResult: async () => {} },
    publish: () => {
      published++;
    },
    loggerInstance: { error() {}, warn() {} },
  });
  const first = await service.cleanupExpiredPayments();
  assert.equal(first.errors, 1);
  assert.equal(order.fulfillment_status, 'cancelled');
  assert.equal(order.payment_cleanup_completed_at, null);
  assert.equal(promotionAttempts, 1);
  const second = await service.cleanupExpiredPayments();
  assert.equal(second.errors, 0);
  assert.equal(second.released, 1);
  assert.ok(order.payment_cleanup_completed_at);
  assert.equal(inventoryAttempts, 2);
  assert.equal(promotionAttempts, 2);
  assert.equal(published, 1);
  await service.cleanupExpiredPayments();
  assert.equal(inventoryAttempts, 2);
  // A paid checkout never enters the recovery path.
  Object.assign(order, { status: 'paid', payment_cleanup_completed_at: null });
  await service.cleanupExpiredPayments();
  assert.equal(inventoryAttempts, 2);
});

test('payment cleanup completion migration is repeatable and preserves pending recovery', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    'create table kaspi_orders(id int,status text,fulfillment_status text,updated_at timestamptz)',
  );
  const sql = readFileSync(
    'supabase/migrations/20261008150200_payment_cleanup_completion.sql',
    'utf8',
  );
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(
    "insert into kaspi_orders(id,status,fulfillment_status) values(1,'failed','cancelled')",
  );
  assert.equal(
    (await db.query('select payment_cleanup_completed_at from kaspi_orders')).rows[0]
      .payment_cleanup_completed_at,
    null,
  );
});
