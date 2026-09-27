const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table settings(key text primary key, value text);
    create table customers(id uuid primary key, balance numeric not null default 0, total_spent numeric default 0, updated_at timestamptz);
    create table kaspi_orders(id uuid primary key, customer_id uuid, amount numeric, branch_id uuid, status text);
    create table loyalty_reservations(id uuid primary key, customer_id uuid, order_total numeric, discount_amount numeric default 0, status text, committed_at timestamptz);
    create table transactions(id uuid default gen_random_uuid(), customer_id uuid, order_id text, type text, amount numeric, description text, branch_id uuid);`);
  const suite = readFileSync(
    'supabase/migrations/20260715090000_commerce_operations_suite.sql',
    'utf8',
  );
  await db.exec(
    suite.slice(
      suite.indexOf('create table if not exists public.referral_codes'),
      suite.indexOf('create table if not exists public.targeted_promotions'),
    ),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260927010000_referral_links_first_purchase.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function policy(extra = {}) {
  await db.query('update settings set value=$1 where key=$2', [
    JSON.stringify({
      enabled: true,
      inviter_bonus: 1000,
      friend_bonus: 500,
      min_first_order: 0,
      ...extra,
    }),
    'bonus_referral',
  ]);
}
async function fixture() {
  await policy();
  const owner = randomUUID(),
    friend = randomUUID(),
    code = 'BULKA-' + randomUUID().slice(0, 8).toUpperCase();
  await db.query('insert into customers(id) values($1),($2)', [owner, friend]);
  await db.query('insert into referral_codes(customer_id,code) values($1,$2)', [owner, code]);
  return { owner, friend, code };
}
async function redeem(f) {
  return (await db.query('select (redeem_referral_code($1,$2)).*', [f.friend, f.code])).rows[0];
}
async function buy(f, source = 'online', amount = 1200) {
  const id = randomUUID();
  if (source === 'online')
    await db.query("insert into kaspi_orders values($1,$2,$3,null,'paid')", [id, f.friend, amount]);
  else
    await db.query("insert into loyalty_reservations values($1,$2,$3,0,'committed',now())", [
      id,
      f.friend,
      amount,
    ]);
  return id;
}
async function process(f) {
  return (await db.query('select process_referral_purchase($1) result', [f.friend])).rows[0].result;
}
async function balance(id) {
  return Number(
    (await db.query('select balance from customers where id=$1', [id])).rows[0].balance,
  );
}

for (const source of ['online', 'pos'])
  test(`${source}: registration saves attribution; first purchase awards both wallets exactly once`, async () => {
    const f = await fixture();
    const registration = await redeem(f);
    assert.equal((await redeem(f)).id, registration.id, 'registration retry must be idempotent');
    assert.equal(await balance(f.owner), 0);
    assert.equal(await balance(f.friend), 0);
    await buy(f, source);
    assert.equal((await process(f)).status, 'rewarded');
    await buy(f, source === 'pos' ? 'online' : 'pos');
    assert.equal((await process(f)).status, 'already_processed');
    assert.equal(await balance(f.owner), 1000);
    assert.equal(await balance(f.friend), 500);
    assert.equal(
      (
        await db.query('select count(*) n from transactions where customer_id in ($1,$2)', [
          f.owner,
          f.friend,
        ])
      ).rows[0].n,
      2,
    );
  });

test('settings changes affect new invitations, not accepted terms', async () => {
  const f = await fixture();
  await policy({ inviter_bonus: 2400, friend_bonus: 750 });
  await redeem(f);
  await policy({ inviter_bonus: 10, friend_bonus: 20, enabled: false });
  await buy(f);
  await process(f);
  assert.equal(await balance(f.owner), 2400);
  assert.equal(await balance(f.friend), 750);
});

test('first purchase below minimum never becomes eligible on a later purchase', async () => {
  const f = await fixture();
  await policy({ min_first_order: 2000 });
  await redeem(f);
  await buy(f, 'pos', 1000);
  assert.equal((await process(f)).status, 'not_eligible');
  await buy(f, 'online', 3000);
  await process(f);
  assert.equal(await balance(f.owner), 0);
});

test('own code, code replacement, disabled program and prior purchases are rejected', async () => {
  const f = await fixture();
  await assert.rejects(() => redeem({ ...f, friend: f.owner }), /own referral/);
  await policy({ enabled: false });
  await assert.rejects(() => redeem(f), /disabled/);
  await policy();
  await buy(f, 'pos');
  await assert.rejects(() => redeem(f), /first order/);
  const g = await fixture();
  await redeem(g);
  await assert.rejects(() => redeem({ ...g, code: f.code }), /already redeemed/);
});

test('failed payout rolls back both balances and remains retryable after restart', async () => {
  const f = await fixture();
  await redeem(f);
  await buy(f);
  await db.exec(`create function fail_referral_test() returns trigger language plpgsql as $$ begin
    if new.description = 'Друг совершил первую покупку' then raise exception 'simulated outage'; end if;
    return new; end $$;
    create trigger fail_referral_test before insert on transactions for each row execute function fail_referral_test();`);
  try {
    await assert.rejects(() => process(f), /simulated outage/);
    assert.equal(await balance(f.friend), 0);
    assert.equal(await balance(f.owner), 0);
  } finally {
    await db.exec(
      'drop trigger fail_referral_test on transactions; drop function fail_referral_test();',
    );
  }
  assert.equal((await process(f)).status, 'rewarded');
  assert.equal(await balance(f.friend), 500);
});

test('refunded purchase before processing receives no reward; RPCs are server-only', async () => {
  const f = await fixture();
  await redeem(f);
  const id = await buy(f);
  await db.query("update kaspi_orders set status='refunded' where id=$1", [id]);
  assert.equal((await process(f)).status, 'cancelled');
  assert.equal(await balance(f.friend), 0);
  for (const role of ['anon', 'authenticated'])
    for (const fn of [
      'process_referral_purchase(uuid)',
      'redeem_referral_code(uuid,text)',
      'qualify_referral_for_order(uuid)',
    ]) {
      assert.equal(
        (await db.query('select has_function_privilege($1,$2,$3) allowed', [role, fn, 'EXECUTE']))
          .rows[0].allowed,
        false,
      );
    }
});
