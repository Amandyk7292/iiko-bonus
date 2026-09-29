const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const legacy = {
  owner: randomUUID(),
  friend: randomUUID(),
  code: randomUUID(),
  redemption: randomUUID(),
  order: randomUUID(),
};
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table settings(key text primary key,value text);
    create table customers(id uuid primary key,name text,balance numeric default 0,total_spent numeric default 0,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,name text);
    create table kaspi_orders(id uuid primary key,customer_id uuid,amount numeric,branch_id uuid,status text,partially_refunded_amount numeric default 0);
    create table loyalty_reservations(id uuid primary key,customer_id uuid,order_total numeric,discount_amount numeric default 0,status text,committed_at timestamptz,pos_branch_id uuid,expires_at timestamptz default now()+interval '1 day');
    create table transactions(id uuid default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,description text,branch_id uuid);`);
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
  for (const file of [
    '20260927010000_referral_links_first_purchase.sql',
    '20260927120000_referral_controls.sql',
    '20260929100000_referral_unlimited_device_owner.sql',
  ]) {
    if (file === '20260927120000_referral_controls.sql') {
      await db.query('insert into customers(id,balance) values($1,500),($2,300)', [
        legacy.owner,
        legacy.friend,
      ]);
      await db.query(
        "insert into referral_codes(id,customer_id,code,reward_referrer,reward_friend) values($1,$2,'BULKA-LEGACY01',9999,9999)",
        [legacy.code, legacy.owner],
      );
      await db.query(
        "insert into kaspi_orders(id,customer_id,amount,status) values($1,$2,2000,'refunded')",
        [legacy.order, legacy.friend],
      );
      await db.query(
        "insert into referral_redemptions(id,referral_code_id,referred_customer_id,order_id,status,rewarded_at) values($1,$2,$3,$4,'rewarded',now())",
        [legacy.redemption, legacy.code, legacy.friend, legacy.order],
      );
      await db.query(
        "insert into transactions(customer_id,order_id,type,amount) values($1,$3,'deposit',500),($2,$4,'deposit',300)",
        [
          legacy.owner,
          legacy.friend,
          'REFERRAL-' + legacy.redemption + ':owner',
          'REFERRAL-' + legacy.redemption + ':friend',
        ],
      );
    }
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
});
test.after(() => db.close());
test('migration recovers historical rewards from ledger without retroactively reversing old refunds', async () => {
  const row = (
    await db.query('select reward_referrer,reward_friend from referral_redemptions where id=$1', [
      legacy.redemption,
    ])
  ).rows[0];
  assert.equal(Number(row.reward_referrer), 500);
  assert.equal(Number(row.reward_friend), 300);
  assert.equal(
    (
      await db.query('select state from referral_first_purchases where customer_id=$1', [
        legacy.friend,
      ])
    ).rows[0].state,
    'rejected',
  );
  assert.equal(Number((await wallet(legacy.owner)).balance), 500);
});
async function fixture(policy = {}) {
  await db.query("update settings set value=$1 where key='bonus_referral'", [
    JSON.stringify({
      enabled: true,
      inviter_bonus: 1000,
      friend_bonus: 500,
      min_first_order: 0,
      ...policy,
    }),
  ]);
  const owner = randomUUID(),
    friend = randomUUID(),
    branch = randomUUID(),
    purchase = randomUUID(),
    code = 'BULKA-' + randomUUID().slice(0, 8);
  await db.query('insert into customers(id) values($1),($2)', [owner, friend]);
  await db.query('insert into bulka_locations values($1,$2)', [branch, 'Test branch']);
  await db.query('insert into referral_codes(customer_id,code) values($1,$2)', [owner, code]);
  await device(owner);
  await device(friend);
  return { owner, friend, branch, purchase, code };
}
async function accept(f) {
  return (await db.query('select (redeem_referral_code($1,$2)).*', [f.friend, f.code])).rows[0];
}
async function buy(f) {
  await db.query(
    "insert into kaspi_orders(id,customer_id,amount,branch_id,status) values($1,$2,2000,$3,'paid')",
    [f.purchase, f.friend, f.branch],
  );
}
async function rpc(name, id) {
  return (await db.query(`select ${name}($1) result`, [id])).rows[0].result;
}
async function wallet(id) {
  return (
    await db.query('select balance,referral_bonus_debt debt from customers where id=$1', [id])
  ).rows[0];
}

async function device(id, hash = randomUUID().replaceAll('-', '').repeat(2)) {
  await db.query(
    'insert into referral_devices(customer_id,device_hash) values($1,$2) on conflict do nothing',
    [id, hash],
  );
  return hash;
}
test('zero limits allow repeated friends and rewards without monthly review', async () => {
  const f = await fixture({
    max_invites_per_day: 0,
    max_rewards_per_month: 0,
    max_reward_amount_per_month: 0,
  });
  for (let i = 0; i < 3; i++) {
    const friend = randomUUID();
    await db.query('insert into customers(id) values($1)', [friend]);
    await device(friend);
    const next = { ...f, friend, purchase: randomUUID() };
    await accept(next);
    await buy(next);
    assert.equal((await rpc('process_referral_purchase', friend)).status, 'rewarded');
  }
  assert.equal(Number((await wallet(f.owner)).balance), 3000);
});
test('second account on one installation cannot earn even with admin approval', async () => {
  const f = await fixture();
  const hash = await device(f.owner);
  await device(f.friend, hash);
  const r = await accept(f);
  assert.equal(r.review_state, 'pending');
  await buy(f);
  await db.query("select review_referral($1,'approve','admin','Checked')", [r.id]);
  assert.equal((await rpc('process_referral_purchase', f.friend)).reason, 'shared_device');
  assert.equal(Number((await wallet(f.owner)).balance), 0);
  assert.equal(Number((await wallet(f.friend)).balance), 0);
});
test('first account remains eligible after a second account uses the same device', async () => {
  const f = await fixture();
  const hash = await device(f.friend);
  const other = randomUUID();
  await db.query('insert into customers(id) values($1)', [other]);
  await device(other, hash);
  await accept(f);
  await buy(f);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'rewarded');
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'already_processed');
});
test('missing device fails closed then resumes when device is registered', async () => {
  const f = await fixture();
  await db.query('delete from referral_devices where customer_id=$1', [f.friend]);
  await accept(f);
  await buy(f);
  assert.equal((await rpc('process_referral_purchase', f.friend)).reason, 'missing_device');
  await device(f.friend);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'rewarded');
});
test('inviter cannot switch to second account to farm rewards', async () => {
  const f = await fixture();
  const first = randomUUID();
  await db.query('insert into customers(id) values($1)', [first]);
  const hash = await device(first);
  await device(f.owner, hash);
  await accept(f);
  await buy(f);
  assert.equal((await rpc('process_referral_purchase', f.friend)).reason, 'shared_device');
});
test('return does not release device ownership and still reverses both wallets', async () => {
  const f = await fixture();
  await accept(f);
  await buy(f);
  await rpc('process_referral_purchase', f.friend);
  await db.query("update kaspi_orders set status='refunded' where id=$1", [f.purchase]);
  assert.equal((await rpc('reverse_referral_purchase', f.friend)).status, 'reversed');
  assert.equal(Number((await wallet(f.owner)).balance), 0);
  assert.equal(
    (
      await db.query('select count(*) n from referral_device_owners where customer_id=$1', [
        f.friend,
      ])
    ).rows[0].n,
    1,
  );
});
test('device claims cannot be changed by untrusted database roles', async () => {
  assert.equal(
    (await db.query("select has_table_privilege('anon','referral_device_owners','INSERT') ok"))
      .rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','referral_device_risk(uuid)','EXECUTE') ok",
      )
    ).rows[0].ok,
    false,
  );
});

test('previous positive daily monthly and code limits no longer restrict invitations', async () => {
  const f = await fixture({
    max_invites_per_day: 1,
    max_rewards_per_month: 1,
    max_reward_amount_per_month: 1,
  });
  await db.query('update referral_codes set max_uses=1 where customer_id=$1', [f.owner]);
  await accept(f);
  await buy(f);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'rewarded');
  const friend = randomUUID();
  await db.query('insert into customers(id) values($1)', [friend]);
  await device(friend);
  const next = { ...f, friend, purchase: randomUUID() };
  await accept(next);
  await buy(next);
  assert.equal((await rpc('process_referral_purchase', friend)).status, 'rewarded');
});
