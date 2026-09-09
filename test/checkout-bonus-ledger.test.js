const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

// Execute the real PL/pgSQL functions in an isolated PostgreSQL runtime.
// No customer account, bank, courier or production database is contacted.
const db = new PGlite();
const read = (path) => fs.readFileSync(path, 'utf8');
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
};
const call = async (sql, params = []) => (await db.query(sql, params)).rows[0];

test.before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, balance numeric default 0, total_spent numeric default 0, updated_at timestamptz default now());
    create table transactions(id uuid primary key default gen_random_uuid(), customer_id uuid, order_id text,
      type text, amount numeric, order_total numeric, description text, items jsonb, branch_id uuid,
      available_at timestamptz, activated_at timestamptz, created_at timestamptz default now(), timestamp timestamptz default now());
    create table kaspi_orders(id uuid primary key, customer_id uuid, operation_id text, client_request_id uuid,
      amount numeric, subtotal numeric, discount_amount numeric default 0, delivery_fee numeric default 0,
      status text default 'pending', fulfillment_status text default 'pending', branch_id uuid,
      earned_bonus numeric default 0, bonus_awarded_at timestamptz, bonus_reversed_at timestamptz,
      refund_status text, cart_items jsonb, promo_code text);
    create table loyalty_reservations(id uuid primary key default gen_random_uuid(), customer_id uuid,
      order_id text unique, order_total numeric, discount_amount numeric, status text,
      expires_at timestamptz, updated_at timestamptz default now(), committed_at timestamptz, cancelled_at timestamptz);
    create table order_partial_refunds(id uuid primary key, order_id uuid, status text, amount numeric);
    create table order_partial_refund_items(refund_id uuid, line_key text, unit_amount numeric, quantity numeric, refund_amount numeric);
    create table promotion_redemptions(order_id uuid, promotion_id uuid, discount_amount numeric, refunded_discount_amount numeric default 0, released_at timestamptz);
    create table targeted_promotions(id uuid, used_count integer, updated_at timestamptz);
  `);
  const finances = read(
    'supabase/migrations/20260715120000_financial_branch_courier_hardening.sql',
  );
  const start = finances.indexOf(
    'create table if not exists public.order_partial_refund_adjustments',
  );
  await db.exec(finances.slice(start, finances.indexOf('\n);', start) + 3));
  await db.exec(functionSql(read('supabase_schema.sql'), 'apply_loyalty_transaction'));
  const fulfillment = read('supabase/migrations/20260713190000_order_fulfillment.sql');
  for (const name of [
    'reserve_loyalty_balance',
    'commit_loyalty_reservation',
    'cancel_loyalty_reservation',
  ]) {
    await db.exec(functionSql(fulfillment, name));
  }
  await db.exec(functionSql(finances, 'reverse_loyalty_order'));
  const migration = read('supabase/migrations/20260909180000_checkout_bonus.sql');
  await db.exec(migration);
  await db.exec(migration);
});
test.after(() => db.close());

async function customer(balance = 1200) {
  const id = crypto.randomUUID();
  await db.query('insert into customers(id,balance) values ($1,$2)', [id, balance]);
  return id;
}
async function reserve(id, request = crypto.randomUUID(), total = 1800, expected = 900) {
  return (
    await call('select reserve_checkout_bonus($1,$2,$3,$4) as data', [id, request, total, expected])
  ).data;
}
async function order(id, request, res, { amount = 1900, operation = request } = {}) {
  const orderId = crypto.randomUUID();
  await db.query(
    `insert into kaspi_orders(id,customer_id,operation_id,client_request_id,amount,subtotal,
    discount_amount,delivery_fee,bonus_spent,bonus_reservation_id)
    values($1,$2,$3,$4,$5,2000,200,1000,900,$6)`,
    [orderId, id, operation, request, amount, res.reservationId],
  );
  return orderId;
}

test('reserve is atomic, excludes POS holds and cannot exceed half of discounted goods', async () => {
  const id = await customer();
  const request = crypto.randomUUID();
  const first = await reserve(id, request);
  assert.equal(first.amount, 900);
  assert.equal((await reserve(id, request)).reservationId, first.reservationId);
  assert.equal(
    (await call('select quote_checkout_bonus($1,1800) as data', [id])).data.available,
    300,
  );
  await assert.rejects(reserve(id), /checkout bonus changed/);
  await assert.rejects(reserve(id, request, 1800, 1000), /checkout bonus changed/);
  const another = await reserve(id, crypto.randomUUID(), 1800, 300);
  assert.equal(another.amount, 300);
  const odd = await customer(1000);
  assert.equal((await reserve(odd, crypto.randomUUID(), 35, 17)).amount, 17);
  await assert.rejects(reserve(odd, crypto.randomUUID(), 35, 18), /checkout bonus changed/);
});

test('paid order debits once, refunds restore bonuses and card-paid delivery stays separate', async () => {
  const id = await customer();
  const request = crypto.randomUUID();
  const res = await reserve(id, request);
  const orderId = await order(id, request, res);
  await db.query('select release_unattached_checkout_bonus($1,$2,$3)', [
    id,
    request,
    res.reservationId,
  ]);
  assert.equal(
    (await call('select status from loyalty_reservations where id=$1', [res.reservationId])).status,
    'active',
  );
  await db.query("update kaspi_orders set status='paid' where id=$1", [orderId]);
  for (let i = 0; i < 3; i++) {
    assert.equal(
      (await call('select commit_checkout_bonus($1,45,0) as data', [orderId])).data.status,
      'committed',
    );
  }
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    345,
  );
  assert.equal(
    Number((await call('select total_spent from customers where id=$1', [id])).total_spent),
    900,
  );
  assert.equal(
    Number(
      (
        await call("select count(*) from transactions where customer_id=$1 and type='withdrawal'", [
          id,
        ])
      ).count,
    ),
    1,
  );
  await db.query('select reverse_loyalty_order($1,$2,900)', [id, `kaspi:${request}`]);
  await db.query('select reverse_loyalty_order($1,$2,900)', [id, `kaspi:${request}`]);
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    1200,
  );
  assert.equal(
    Number((await call('select total_spent from customers where id=$1', [id])).total_spent),
    0,
  );
});

test('failed payment releases bonuses, late payment cannot spend another checkout reservation', async () => {
  const id = await customer(900);
  const request = crypto.randomUUID();
  const res = await reserve(id, request);
  const orderId = await order(id, request, res);
  await db.query("update kaspi_orders set status='failed' where id=$1", [orderId]);
  assert.equal(
    (await call('select quote_checkout_bonus($1,1800) as data', [id])).data.available,
    900,
  );
  await reserve(id);
  await db.query("update kaspi_orders set status='paid' where id=$1", [orderId]);
  assert.equal(
    (await call('select commit_checkout_bonus($1,45,0) as data', [orderId])).data.status,
    'unavailable',
  );
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    900,
  );
});

test('partial refund restores proportional bonuses and promo amount, full refund restores remainder', async () => {
  const id = await customer();
  const request = crypto.randomUUID();
  const res = await reserve(id, request);
  const orderId = await order(id, request, res);
  await db.query("update kaspi_orders set status='paid' where id=$1", [orderId]);
  await db.query('select commit_checkout_bonus($1,45,0)', [orderId]);
  await db.query('insert into promotion_redemptions(order_id,discount_amount) values ($1,200)', [
    orderId,
  ]);
  const refundId = crypto.randomUUID();
  await db.query("insert into order_partial_refunds values ($1,$2,'succeeded',450)", [
    refundId,
    orderId,
  ]);
  await db.query("insert into order_partial_refund_items values ($1,'bun:0',1000,1,450)", [
    refundId,
  ]);
  const partial = (await call('select apply_partial_refund_adjustments($1) as data', [refundId]))
    .data;
  assert.equal(partial.spentBonusRestored, 450);
  assert.equal(partial.earnedBonusReversed, 22.5);
  assert.equal(partial.realMoneyReversed, 450);
  assert.equal(partial.promoDiscountRefunded, 100);
  assert.equal(
    (await call('select apply_partial_refund_adjustments($1) as data', [refundId])).data.duplicate,
    true,
  );
  await db.query('select reverse_loyalty_order($1,$2,900)', [id, `kaspi:${request}`]);
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    1200,
  );
  assert.equal(
    Number((await call('select total_spent from customers where id=$1', [id])).total_spent),
    0,
  );
});

test('an order cannot attach another customer hold or a mismatched cash amount', async () => {
  const id = await customer();
  const other = await customer();
  const request = crypto.randomUUID();
  const res = await reserve(id, request);
  await assert.rejects(order(other, request, res), /reservation mismatch/);
  await assert.rejects(order(id, request, res, { amount: 1 }), /reservation mismatch/);
});
