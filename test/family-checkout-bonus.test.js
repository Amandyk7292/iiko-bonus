const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const read = (path) => fs.readFileSync(path, 'utf8');
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
};
const row = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rpc = async (sql, params = []) => (await row(`select ${sql} as data`, params)).data;

test.before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, name text, phone text, deleted_at timestamptz,
      created_at timestamptz default now(), balance numeric default 0, total_spent numeric default 0,
      updated_at timestamptz default now());
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
    create table promotion_redemptions(order_id uuid, promotion_id uuid, discount_amount numeric,
      refunded_discount_amount numeric default 0, released_at timestamptz);
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
  await db.exec(
    functionSql(
      read('supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql'),
      'reserve_loyalty_balance',
    ),
  );
  await db.exec(read('supabase/migrations/20260909180000_checkout_bonus.sql'));
  await db.exec(read('supabase/migrations/20260926114000_refund_reserved_balance.sql'));
  await db.exec(read('supabase/migrations/20261002170000_customer_family.sql'));
  const migration = read('supabase/migrations/20261002172000_family_checkout_bonus.sql');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(
    functionSql(
      read('supabase/migrations/20261003162000_delivery_fee_loyalty_adjustment.sql'),
      'apply_partial_refund_adjustments',
    ),
  );
});
test.after(() => db.close());

async function customer(balance = 1200) {
  const id = crypto.randomUUID();
  await db.query('insert into customers(id,name,phone,balance) values ($1,$2,$3,$4)', [
    id,
    'Test family customer',
    `77${Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, '0')}`,
    balance,
  ]);
  return id;
}
async function family() {
  const owner = await customer();
  const actor = await customer(75);
  const other = await customer(25);
  const group = crypto.randomUUID();
  await db.query('insert into family_groups(id,owner_customer_id) values ($1,$2)', [group, owner]);
  for (const member of [actor, other]) {
    await db.query(
      "insert into family_members(group_id,customer_id,name,relation) values($1,$2,'Family member','sister')",
      [group, member],
    );
  }
  return { owner, actor, other };
}
async function reserve(actor, request = crypto.randomUUID(), expected = 900, total = 1800) {
  const reservation = await rpc('reserve_checkout_bonus($1,$2,$3,$4)', [
    actor,
    request,
    total,
    expected,
  ]);
  return { ...reservation, request };
}
async function order(
  actor,
  reservation,
  {
    bonusOwner = null,
    bonus = 900,
    amount = 1900,
    subtotal = 2000,
    discount = 200,
    delivery = 1000,
  } = {},
) {
  const id = crypto.randomUUID();
  const request = reservation?.request || crypto.randomUUID();
  await db.query(
    `insert into kaspi_orders(id,customer_id,bonus_customer_id,operation_id,client_request_id,
    amount,subtotal,discount_amount,delivery_fee,bonus_spent,bonus_reservation_id)
    values($1,$2,$3,$4::text,$4::text::uuid,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      actor,
      bonusOwner,
      request,
      amount,
      subtotal,
      discount,
      delivery,
      bonus,
      reservation?.reservationId || null,
    ],
  );
  return { id, request };
}
async function balance(id) {
  return Number((await row('select balance from customers where id=$1', [id])).balance);
}
async function paid(orderId, earned = 45) {
  await db.query("update kaspi_orders set status='paid' where id=$1", [orderId]);
  return rpc('commit_checkout_bonus($1,$2,0)', [orderId, earned]);
}
async function leave(actor) {
  await db.query("update family_members set status='removed' where customer_id=$1", [actor]);
}
async function partial(orderId, amount = 450) {
  const refund = crypto.randomUUID();
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded',$3)", [
    refund,
    orderId,
    amount,
  ]);
  return { id: refund, result: await rpc('apply_partial_refund_adjustments($1)', [refund]) };
}

test('delivery fee refund preserves family merchandise loyalty and later goods refunds stay proportional', async () => {
  const { owner, actor } = await family();
  const hold = await reserve(actor);
  const purchase = await order(actor, hold);
  await paid(purchase.id);
  const before = await row('select balance,total_spent from customers where id=$1', [owner]);
  const feeRefund = crypto.randomUUID();
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded',1000)", [
    feeRefund,
    purchase.id,
  ]);
  await db.query(
    "insert into order_partial_refund_items values($1,'__delivery_fee__',1000,1,1000)",
    [feeRefund],
  );
  const fee = await rpc('apply_partial_refund_adjustments($1)', [feeRefund]);
  for (const field of [
    'earnedBonusReversed',
    'spentBonusRestored',
    'realMoneyReversed',
    'promoDiscountRefunded',
  ])
    assert.equal(Number(fee[field]), 0, field);
  assert.equal(fee.promotionUsageReleased, false);
  const after = await row('select balance,total_spent from customers where id=$1', [owner]);
  assert.equal(Number(after.balance), Number(before.balance));
  assert.equal(Number(after.total_spent), Number(before.total_spent));
  assert.equal((await rpc('apply_partial_refund_adjustments($1)', [feeRefund])).duplicate, true);
  const half = (await partial(purchase.id, 450)).result;
  assert.equal(Number(half.earnedBonusReversed), 22.5);
  assert.equal(Number(half.spentBonusRestored), 450);
  assert.equal(Number(half.realMoneyReversed), 450);
  const rest = (await partial(purchase.id, 450)).result;
  assert.equal(Number(rest.earnedBonusReversed), 22.5);
  assert.equal(Number(rest.spentBonusRestored), 450);
  assert.equal(Number(rest.realMoneyReversed), 450);
  assert.equal(await balance(owner), 1200);
  assert.equal(await balance(actor), 75);
});

test('a fee-only refund does not release a promotion for free merchandise', async () => {
  const { owner, actor } = await family();
  const purchase = await order(actor, null, {
    bonus: 0,
    amount: 100,
    subtotal: 600,
    discount: 600,
    delivery: 100,
  });
  await paid(purchase.id, 0);
  const promotion = crypto.randomUUID();
  const refund = crypto.randomUUID();
  await db.query('insert into targeted_promotions(id,used_count) values($1,1)', [promotion]);
  await db.query(
    'insert into promotion_redemptions(order_id,promotion_id,discount_amount) values($1,$2,600)',
    [purchase.id, promotion],
  );
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded',100)", [
    refund,
    purchase.id,
  ]);
  await db.query("insert into order_partial_refund_items values($1,'__delivery_fee__',100,1,100)", [
    refund,
  ]);
  const result = await rpc('apply_partial_refund_adjustments($1)', [refund]);
  assert.equal(result.promotionUsageReleased, false);
  assert.equal(Number(result.earnedBonusReversed), 0);
  assert.equal(Number(result.spentBonusRestored), 0);
  assert.equal(
    Number(
      (await row('select used_count from targeted_promotions where id=$1', [promotion])).used_count,
    ),
    1,
  );
  assert.equal(await balance(owner), 1200);
});

test('full cancellation after a fee-only refund releases free-goods promotion once', async () => {
  const { owner, actor } = await family();
  const purchase = await order(actor, null, {
    bonus: 0,
    amount: 100,
    subtotal: 600,
    discount: 600,
    delivery: 100,
  });
  await paid(purchase.id, 0);
  await rpc('apply_loyalty_transaction($1,$2,0,0,0,0,0,null)', [
    owner,
    `kaspi:${purchase.request}`,
  ]);
  const promotion = crypto.randomUUID(),
    refund = crypto.randomUUID();
  await db.query('insert into targeted_promotions(id,used_count) values($1,1)', [promotion]);
  await db.query(
    'insert into promotion_redemptions(order_id,promotion_id,discount_amount) values($1,$2,600)',
    [purchase.id, promotion],
  );
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded',100)", [
    refund,
    purchase.id,
  ]);
  await db.query("insert into order_partial_refund_items values($1,'__delivery_fee__',100,1,100)", [
    refund,
  ]);
  await rpc('apply_partial_refund_adjustments($1)', [refund]);
  const final = await rpc('reverse_loyalty_order($1,$2,0)', [owner, `kaspi:${purchase.request}`]);
  assert.equal(final.promotionUsageReleased, true);
  assert.equal(Number(final.spentBonusRestored), 0);
  assert.equal(
    Number(
      (await row('select used_count from targeted_promotions where id=$1', [promotion])).used_count,
    ),
    0,
  );
  assert.equal(
    (await rpc('reverse_loyalty_order($1,$2,0)', [owner, `kaspi:${purchase.request}`])).duplicate,
    true,
  );
  assert.equal(await balance(owner), 1200);
  assert.equal(await balance(actor), 75);
});

test('family holds share one available balance, preserve purchaser and ignore forged bonus owner', async () => {
  const { owner, actor, other } = await family();
  assert.equal((await rpc('quote_checkout_bonus($1,1800)', [actor])).available, 1200);
  const hold = await reserve(actor);
  const stored = await row('select * from loyalty_reservations where id=$1', [hold.reservationId]);
  assert.equal(stored.customer_id, owner);
  assert.equal(stored.family_actor_customer_id, actor);
  assert.equal((await rpc('quote_checkout_bonus($1,1800)', [other])).available, 300);
  assert.equal((await rpc('quote_checkout_bonus($1,1800)', [owner])).available, 300);
  await assert.rejects(reserve(other), /checkout bonus changed/);
  const purchase = await order(actor, hold, { bonusOwner: other });
  const saved = await row('select customer_id,bonus_customer_id from kaspi_orders where id=$1', [
    purchase.id,
  ]);
  assert.equal(saved.customer_id, actor);
  assert.equal(saved.bonus_customer_id, owner);
  await assert.rejects(
    db.query('update kaspi_orders set bonus_customer_id=$2 where id=$1', [purchase.id, other]),
    /immutable/,
  );
  assert.equal(await balance(actor), 75);
  assert.equal(await balance(other), 25);
});

test('membership removal before payment still commits and reverses the captured owner exactly once', async () => {
  const { owner, actor } = await family();
  const hold = await reserve(actor);
  const purchase = await order(actor, hold);
  await leave(actor);
  assert.equal((await rpc('quote_checkout_bonus($1,1800)', [actor])).available, 75);
  assert.equal((await paid(purchase.id)).status, 'committed');
  assert.equal((await rpc('commit_checkout_bonus($1,45,0)', [purchase.id])).status, 'committed');
  assert.equal(await balance(owner), 345);
  assert.equal(await balance(actor), 75);
  assert.equal(
    Number((await row('select total_spent from customers where id=$1', [owner])).total_spent),
    900,
  );
  await assert.rejects(
    rpc('reverse_loyalty_order($1,$2,900)', [actor, `kaspi:${purchase.request}`]),
    /order not found/,
  );
  const refund = await rpc('reverse_loyalty_order($1,$2,900)', [
    owner,
    `kaspi:${purchase.request}`,
  ]);
  assert.equal(refund.spentBonusRestored, 900);
  assert.equal(
    (await rpc('reverse_loyalty_order($1,$2,900)', [owner, `kaspi:${purchase.request}`])).duplicate,
    true,
  );
  assert.equal(await balance(owner), 1200);
  assert.equal(await balance(actor), 75);
  const counts = await row(
    "select count(*) filter(where type='withdrawal') as spent,count(*) filter(where type='refund_bonus_restore') as restored from transactions where customer_id=$1",
    [owner],
  );
  assert.equal(Number(counts.spent), 1);
  assert.equal(Number(counts.restored), 1);
});

test('partial followed by full refund returns only the remaining family bonus after leaving', async () => {
  const { owner, actor } = await family();
  const purchase = await order(actor, await reserve(actor));
  await paid(purchase.id);
  await leave(actor);
  const refund = await partial(purchase.id);
  assert.equal(refund.result.spentBonusRestored, 450);
  assert.equal(refund.result.earnedBonusReversed, 22.5);
  assert.equal((await rpc('apply_partial_refund_adjustments($1)', [refund.id])).duplicate, true);
  const adjustment = await row(
    'select customer_id from order_partial_refund_adjustments where refund_id=$1',
    [refund.id],
  );
  assert.equal(adjustment.customer_id, owner);
  const final = await rpc('reverse_loyalty_order($1,$2,900)', [owner, `kaspi:${purchase.request}`]);
  assert.equal(final.spentBonusRestored, 450);
  assert.equal(final.earnedBonusReversed, 22.5);
  assert.equal(await balance(owner), 1200);
  assert.equal(await balance(actor), 75);
});

test('leaving between quote and insert rejects the stale hold but the actor can release it', async () => {
  const { owner, actor, other } = await family();
  const hold = await reserve(actor);
  await leave(actor);
  await assert.rejects(order(actor, hold), /reservation mismatch/);
  await rpc('release_unattached_checkout_bonus($1,$2,$3)', [
    other,
    hold.request,
    hold.reservationId,
  ]);
  assert.equal(
    (await row('select status from loyalty_reservations where id=$1', [hold.reservationId])).status,
    'active',
  );
  await rpc('release_unattached_checkout_bonus($1,$2,$3)', [
    actor,
    hold.request,
    hold.reservationId,
  ]);
  assert.equal((await rpc('quote_checkout_bonus($1,1800)', [owner])).available, 1200);
});

test('cashback-only family refunds protect reservations belonging to other pending payments', async () => {
  const { owner, actor } = await family();
  await db.query('update customers set balance=0 where id=$1', [owner]);
  const purchase = await order(actor, null, {
    bonus: 0,
    subtotal: 1000,
    discount: 0,
    delivery: 0,
    amount: 1000,
  });
  await db.query("update kaspi_orders set status='paid',earned_bonus=200 where id=$1", [
    purchase.id,
  ]);
  await rpc('apply_loyalty_transaction($1,$2,0,200,1000,1000,0,null)', [
    owner,
    `kaspi:${purchase.request}`,
  ]);
  const otherPayment = `other:${crypto.randomUUID()}`;
  await rpc('reserve_loyalty_balance($1,$2,400,200,50,1)', [owner, otherPayment]);
  await leave(actor);
  const refund = await partial(purchase.id, 500);
  assert.equal(refund.result.activeBonusRemoved, 0);
  assert.equal(refund.result.unrecoveredBonus, 100);
  const full = await rpc('reverse_loyalty_order($1,$2,1000)', [owner, `kaspi:${purchase.request}`]);
  assert.equal(full.activeBonusRemoved, 0);
  assert.equal(full.unrecoveredBonus, 100);
  assert.equal(await balance(owner), 200);
  const reserved = await row('select id from loyalty_reservations where order_id=$1', [
    otherPayment,
  ]);
  await rpc('commit_loyalty_reservation($1,$2,$3,400,0,0,null)', [
    owner,
    otherPayment,
    reserved.id,
  ]);
  assert.equal(await balance(owner), 0);
  assert.equal(await balance(actor), 75);
});

test('customers outside a family keep their own balance and refund behavior', async () => {
  const actor = await customer();
  const purchase = await order(actor, await reserve(actor));
  const saved = await row('select customer_id,bonus_customer_id from kaspi_orders where id=$1', [
    purchase.id,
  ]);
  assert.equal(saved.customer_id, actor);
  assert.equal(saved.bonus_customer_id, actor);
  await paid(purchase.id);
  assert.equal(await balance(actor), 345);
  await rpc('reverse_loyalty_order($1,$2,900)', [actor, `kaspi:${purchase.request}`]);
  assert.equal(await balance(actor), 1200);
});
