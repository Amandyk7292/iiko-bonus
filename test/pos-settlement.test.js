const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};
const call = async (query, values = []) => (await db.query(query, values)).rows[0].r;

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,balance numeric,total_spent numeric default 0,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,active boolean default true);
    create table iiko_operation_logs(created_at timestamptz);
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text,
      type text,amount numeric,order_total numeric,description text,items jsonb,
      available_at timestamptz,activated_at timestamptz,timestamp timestamptz default now(),
      created_at timestamptz default now(),branch_id uuid);
    create table gift_cards(id uuid primary key,code_hash text,balance numeric,active boolean,
      expires_at timestamptz,redeemed_at timestamptz,recipient_customer_id uuid);
    create table gift_card_transactions(gift_card_id uuid,customer_id uuid,order_id uuid,
      pos_reservation_id uuid,type text,amount numeric);
    create table kaspi_orders(id uuid primary key, customer_id uuid, operation_id text,
      amount numeric,subtotal numeric,discount_amount numeric default 0,bonus_spent numeric default 0,
      earned_bonus numeric default 0,branch_id uuid);
    create table order_partial_refunds(id uuid primary key,order_id uuid,status text,amount numeric);
    create table order_partial_refund_items(refund_id uuid,line_key text,unit_amount numeric,quantity numeric,refund_amount numeric);
    create table promotion_redemptions(order_id uuid,promotion_id uuid,discount_amount numeric,refunded_discount_amount numeric default 0,released_at timestamptz);
    create table targeted_promotions(id uuid,used_count integer,updated_at timestamptz);
  `);
  const base = read('20260713190000_order_fulfillment');
  await db.exec(
    base.slice(
      base.indexOf('create table if not exists public.loyalty_reservations'),
      base.indexOf(
        ';',
        base.indexOf('grant execute on function public.cancel_loyalty_reservation'),
      ) + 1,
    ),
  );
  const branch = read('20260810110000_backend_rbac_financial_hardening');
  await db.exec(branch.slice(0, branch.indexOf('alter table public.gift_cards')));
  await db.exec(read('20260910190000_loyalty_retry_after_cancel'));
  await db.exec(
    functionSql(readFileSync('supabase_schema.sql', 'utf8'), 'apply_loyalty_transaction'),
  );
  const gift = read('20260729160000_business_foundation');
  const table = gift.indexOf('create table if not exists public.gift_card_pos_reservations');
  await db.exec(gift.slice(table, gift.indexOf(';', table) + 1));
  for (const name of [
    'reserve_gift_card_for_iiko',
    'commit_gift_card_for_iiko',
    'cancel_gift_card_for_iiko',
  ]) {
    await db.exec(functionSql(gift, name));
  }
  await db.exec(read('20260926112000_pos_settlement_preparation'));
  const refunds = read('20260715120000_financial_branch_courier_hardening');
  const adjustments = refunds.indexOf(
    'create table if not exists public.order_partial_refund_adjustments',
  );
  await db.exec(refunds.slice(adjustments, refunds.indexOf('\n);', adjustments) + 3));
  await db.exec(read('20260926114000_refund_reserved_balance'));
});
test.after(() => db.close());

async function fixture() {
  const ctx = { customer: randomUUID(), branch: randomUUID(), order: randomUUID() };
  await db.query('insert into customers(id,balance) values($1,1000)', [ctx.customer]);
  await db.query('insert into bulka_locations(id) values($1)', [ctx.branch]);
  ctx.order = `bp1:${ctx.branch}:${ctx.order}`;
  return ctx;
}
const reserve = (ctx, discount = 500) =>
  call(
    'select reserve_branch_loyalty_balance($1,$2,$3,1000,$4,100,24,250000,100000,2000,25000000,2000000) r',
    [ctx.branch, ctx.customer, ctx.order, discount],
  );
const prepare = (ctx, id) =>
  call('select prepare_pos_loyalty_reservation($1,$2,$3,$4) r', [
    ctx.branch,
    ctx.customer,
    ctx.order,
    id,
  ]);
const commit = (ctx, id) =>
  call("select commit_loyalty_reservation($1,$2,$3,1000,0,0,'[]') r", [
    ctx.customer,
    ctx.order,
    id,
  ]);

const expire = (ctx, balance = 1000, key = 'expiration') =>
  call('select expire_customer_bonus($1,$2,$3) r', [ctx.customer, balance, key]);

test('bonus expiration preserves prepared funds and retry cannot expire newly credited money', async () => {
  const ctx = await fixture();
  const hold = await reserve(ctx);
  await prepare(ctx, hold.reservation_id);
  assert.equal(Number(await expire(ctx)), 500);
  assert.equal(Number(await expire(ctx)), 0);
  // Even an identical expected balance after a later credit is not a new job.
  await db.query('update customers set balance=1000 where id=$1', [ctx.customer]);
  assert.equal(Number(await expire(ctx)), 0);
  assert.equal(Number(await expire(ctx, 1000, 'next-expiration')), 500);
  assert.equal((await commit(ctx, hold.reservation_id)).discount_applied, 500);
  assert.equal(
    Number(
      (await db.query('select balance from customers where id=$1', [ctx.customer])).rows[0].balance,
    ),
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from transactions where customer_id=$1 and type='expiration'",
        [ctx.customer],
      )
    ).rows[0].n,
    2,
  );
});

test('bonus expiration respects current ordinary holds, stale expectations and released reservations', async () => {
  const ctx = await fixture();
  const hold = await reserve(ctx, 1000);
  assert.equal(Number(await expire(ctx)), 0);
  assert.equal(Number(await expire(ctx, 900)), 0);
  await db.query(
    "update loyalty_reservations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
    [hold.reservation_id],
  );
  assert.equal(Number(await expire(ctx)), 1000);
  assert.equal(Number(await expire(ctx)), 0);
});

async function refundableOrder(ctx) {
  const id = randomUUID();
  const operation = randomUUID();
  await db.query(
    'insert into kaspi_orders(id,customer_id,operation_id,amount,subtotal,bonus_spent,earned_bonus,branch_id) values($1,$2,$3,800,1000,200,1000,$4)',
    [id, ctx.customer, operation, ctx.branch],
  );
  await db.query(
    "insert into transactions(customer_id,order_id,type,amount) values($1,$2,'deposit',1000),($1,$2,'withdrawal',200)",
    [ctx.customer, `kaspi:${operation}`],
  );
  return { id, key: `kaspi:${operation}` };
}

test('full refund preserves another prepared payment and records the actual recovery amounts', async () => {
  const ctx = await fixture();
  const hold = await reserve(ctx);
  await prepare(ctx, hold.reservation_id);
  const order = await refundableOrder(ctx);
  const result = await call('select reverse_loyalty_order($1,$2,800) r', [ctx.customer, order.key]);
  assert.equal(result.activeBonusRemoved, 700);
  assert.equal(result.unrecoveredBonus, 300);
  assert.equal(result.spentBonusRestored, 200);
  assert.equal(result.balance, 500);
  const transaction = (
    await db.query(
      "select amount,description from transactions where customer_id=$1 and order_id=$2 and type='refund_reversal'",
      [ctx.customer, order.key + ':refund'],
    )
  ).rows[0];
  assert.equal(Number(transaction.amount), 1000);
  assert.match(transaction.description, /снято=700/);
  assert.match(transaction.description, /не взыскано=300/);
  assert.equal(
    (await call('select reverse_loyalty_order($1,$2,800) r', [ctx.customer, order.key])).duplicate,
    true,
  );
  assert.equal((await commit(ctx, hold.reservation_id)).discount_applied, 500);
});

test('partial then full refund retains checkout proration, durable accounting and another POS hold', async () => {
  const ctx = await fixture();
  const hold = await reserve(ctx);
  await prepare(ctx, hold.reservation_id);
  const order = await refundableOrder(ctx);
  const refund = randomUUID();
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded',720)", [
    refund,
    order.id,
  ]);
  const partial = await call('select apply_partial_refund_adjustments($1) r', [refund]);
  assert.equal(partial.earnedBonusReversed, 900);
  assert.equal(partial.spentBonusRestored, 180);
  assert.equal(partial.activeBonusRemoved, 680);
  assert.equal(partial.unrecoveredBonus, 220);
  const stored = (
    await db.query(
      'select active_bonus_removed,unrecovered_bonus,spent_bonus_restored from order_partial_refund_adjustments where refund_id=$1',
      [refund],
    )
  ).rows[0];
  assert.deepEqual(
    Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, Number(value)])),
    { active_bonus_removed: 680, unrecovered_bonus: 220, spent_bonus_restored: 180 },
  );
  const duplicate = await call('select apply_partial_refund_adjustments($1) r', [refund]);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.activeBonusRemoved, 680);
  const full = await call('select reverse_loyalty_order($1,$2,800) r', [ctx.customer, order.key]);
  assert.equal(full.earnedBonusReversed, 100);
  assert.equal(full.spentBonusRestored, 20);
  assert.equal(full.activeBonusRemoved, 20);
  assert.equal(full.unrecoveredBonus, 80);
  assert.equal(full.balance, 500);
  assert.equal((await commit(ctx, hold.reservation_id)).discount_applied, 500);
});

test('POS prepare pins the hold across TTL, blocks double spend and commits exactly once', async () => {
  const ctx = await fixture();
  const first = await reserve(ctx);
  assert.equal((await prepare(ctx, first.reservation_id)).status, 'prepared');
  assert.equal((await prepare(ctx, first.reservation_id)).duplicate, true);
  // Existing refresh/expiry paths cannot demote a prepared reservation.
  await db.query("update loyalty_reservations set expires_at=now()-interval '2 days' where id=$1", [
    first.reservation_id,
  ]);
  const state = await call(
    "select jsonb_build_object('infinite',expires_at='infinity','prepared',prepared_at is not null) r from loyalty_reservations where id=$1",
    [first.reservation_id],
  );
  assert.deepEqual(state, { infinite: true, prepared: true });
  await assert.rejects(
    reserve({ ...ctx, order: `bp1:${ctx.branch}:${randomUUID()}` }, 1000),
    /discount exceeds/,
  );
  assert.equal((await reserve(ctx)).reservation_id, first.reservation_id);
  await assert.rejects(reserve(ctx, 300), /prepared reservation/);
  assert.equal((await commit(ctx, first.reservation_id)).discount_applied, 500);
  assert.equal((await commit(ctx, first.reservation_id)).duplicate, true);
  assert.equal(
    Number(
      (await db.query('select balance from customers where id=$1', [ctx.customer])).rows[0].balance,
    ),
    500,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from transactions where customer_id=$1 and type='withdrawal'",
        [ctx.customer],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(prepare(ctx, first.reservation_id), /not active/);
});

test('expired unprepared reservations cannot become durable; branch/customer binding is enforced', async () => {
  const ctx = await fixture();
  const res = await reserve(ctx);
  await assert.rejects(
    prepare({ ...ctx, branch: randomUUID() }, res.reservation_id),
    /claim conflict/,
  );
  await assert.rejects(
    call('select prepare_pos_loyalty_reservation(null,$1,$2,$3) r', [
      ctx.customer,
      ctx.order,
      res.reservation_id,
    ]),
    /claim conflict/,
  );
  await db.query(
    "update loyalty_reservations set expires_at=now()-interval '1 minute' where id=$1",
    [res.reservation_id],
  );
  await assert.rejects(prepare(ctx, res.reservation_id), /not active/);
  await assert.rejects(commit(ctx, res.reservation_id), /not active/);
});

test('explicit cancellation releases a prepared POS hold without reusing its identity', async () => {
  const ctx = await fixture();
  const first = await reserve(ctx);
  await prepare(ctx, first.reservation_id);
  await db.query('select cancel_branch_loyalty_reservation($1,$2,$3,$4)', [
    ctx.branch,
    ctx.customer,
    ctx.order,
    first.reservation_id,
  ]);
  const next = await reserve(ctx, 1000);
  assert.notEqual(next.reservation_id, first.reservation_id);
  await assert.rejects(commit(ctx, first.reservation_id));
});

async function giftFixture() {
  const ctx = await fixture();
  ctx.card = randomUUID();
  ctx.key = randomUUID();
  ctx.hash = randomUUID();
  await db.query(
    "insert into gift_cards(id,code_hash,balance,active,expires_at) values($1,$2,1000,true,now()+interval '1 day')",
    [ctx.card, ctx.hash],
  );
  const res = await call('select reserve_gift_card_for_iiko($1,$2,$3,1000,$4,120) r', [
    ctx.hash,
    ctx.branch,
    ctx.order,
    randomUUID(),
  ]);
  ctx.reservation = res.reservationId;
  return ctx;
}
const prepareGift = (ctx) =>
  call('select prepare_gift_card_for_iiko($1,$2,$3) r', [ctx.branch, ctx.reservation, ctx.key]);

test('gift prepared before close settles after both reservation and card expiry, once only', async () => {
  const ctx = await giftFixture();
  await prepareGift(ctx);
  await db.query("update gift_cards set expires_at=now()-interval '3 days' where id=$1", [
    ctx.card,
  ]);
  await db.query(
    "update gift_card_pos_reservations set created_at=now()-interval '5 days', expires_at=now()-interval '3 days' where id=$1",
    [ctx.reservation],
  );
  assert.equal((await prepareGift(ctx)).duplicate, true);
  const result = await call('select commit_gift_card_for_iiko($1,$2) r', [
    ctx.reservation,
    ctx.key,
  ]);
  assert.equal(result.balanceAfter, 0);
  assert.equal(
    (await call('select commit_gift_card_for_iiko($1,$2) r', [ctx.reservation, ctx.key])).duplicate,
    true,
  );
  assert.equal(
    (
      await db.query('select count(*)::int n from gift_card_transactions where gift_card_id=$1', [
        ctx.card,
      ])
    ).rows[0].n,
    1,
  );
});

test('gift prepare freezes payload, binds key/branch and excludes other purchases; cancel releases', async () => {
  const ctx = await giftFixture();
  await prepareGift(ctx);
  await assert.rejects(prepareGift({ ...ctx, key: randomUUID() }), /idempotency conflict/);
  await assert.rejects(prepareGift({ ...ctx, branch: randomUUID() }), /not found/);
  await assert.rejects(
    db.query('update gift_card_pos_reservations set amount=900 where id=$1', [ctx.reservation]),
    /prepared reservation/,
  );
  await assert.rejects(
    call('select reserve_gift_card_for_iiko($1,$2,$3,1000,$4,120) r', [
      ctx.hash,
      ctx.branch,
      'other-sale',
      randomUUID(),
    ]),
    /insufficient balance/,
  );
  await call('select cancel_gift_card_for_iiko($1,$2) r', [ctx.reservation, randomUUID()]);
  await assert.rejects(prepareGift(ctx), /expired/);
  assert.equal(
    (
      await call('select reserve_gift_card_for_iiko($1,$2,$3,1000,$4,120) r', [
        ctx.hash,
        ctx.branch,
        'after-cancel',
        randomUUID(),
      ])
    ).amount,
    1000,
  );
});

test('unprepared expired gift cannot be pinned or debited', async () => {
  const ctx = await giftFixture();
  await db.query(
    "update gift_card_pos_reservations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
    [ctx.reservation],
  );
  await assert.rejects(prepareGift(ctx), /expired/);
  await assert.rejects(
    call('select commit_gift_card_for_iiko($1,$2) r', [ctx.reservation, ctx.key]),
    /expired/,
  );
});

test('settling an already prepared gift cannot reactivate a disabled card', async () => {
  const ctx = await giftFixture();
  await db.query('update gift_card_pos_reservations set amount=500 where id=$1', [ctx.reservation]);
  await prepareGift(ctx);
  await db.query('update gift_cards set active=false where id=$1', [ctx.card]);
  assert.equal(
    (await call('select commit_gift_card_for_iiko($1,$2) r', [ctx.reservation, ctx.key]))
      .balanceAfter,
    500,
  );
  assert.equal(
    (await db.query('select active from gift_cards where id=$1', [ctx.card])).rows[0].active,
    false,
  );
});

test('a prepared gift must settle with the same durable key and does not debit on key mismatch', async () => {
  const ctx = await giftFixture();
  await prepareGift(ctx);
  await assert.rejects(
    call('select commit_gift_card_for_iiko($1,$2) r', [ctx.reservation, randomUUID()]),
    /idempotency conflict/,
  );
  assert.equal(
    (await db.query('select balance from gift_cards where id=$1', [ctx.card])).rows[0].balance,
    '1000',
  );
  assert.equal(
    (await call('select commit_gift_card_for_iiko($1,$2) r', [ctx.reservation, ctx.key]))
      .balanceAfter,
    0,
  );
});
