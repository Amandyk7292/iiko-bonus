const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const hash = () => randomBytes(32).toString('hex');

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
    '20260930120000_referral_stable_device.sql',
  ]) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.query("update settings set value=$1 where key='bonus_referral'", [
    JSON.stringify({
      enabled: true,
      inviter_bonus: 1000,
      friend_bonus: 500,
      min_first_order: 0,
      max_invites_per_day: 0,
      max_rewards_per_month: 0,
      max_reward_amount_per_month: 0,
    }),
  ]);
});
test.after(() => db.close());

async function account() {
  const id = randomUUID();
  await db.query('insert into customers(id) values($1)', [id]);
  return id;
}
async function remember(customer, stable = hash(), installation = hash(), extra = {}) {
  return (
    await db.query('select remember_stable_referral_device($1,$2,$3,$4,$5,$6,$7) result', [
      customer,
      installation,
      stable,
      stable ? extra.kind || 'android_id' : null,
      stable ? extra.proof || hash() : null,
      stable ? extra.challenge || hash() : null,
      extra.blocked || false,
    ])
  ).rows[0].result;
}
async function risk(customer) {
  return (await db.query('select referral_device_risk($1) result', [customer])).rows[0].result;
}
async function fixture() {
  const owner = await account(),
    friend = await account(),
    code = 'BULKA-' + randomUUID().slice(0, 8);
  const stable = hash();
  await remember(owner);
  await remember(friend, stable);
  await db.query('insert into referral_codes(customer_id,code) values($1,$2)', [owner, code]);
  return { owner, friend, code, stable };
}
async function buy(f, source = 'online') {
  await db.query('select redeem_referral_code($1,$2)', [f.friend, f.code]);
  if (source === 'online') {
    await db.query(
      "insert into kaspi_orders(id,customer_id,amount,status) values($1,$2,2000,'paid')",
      [randomUUID(), f.friend],
    );
  } else {
    await db.query(
      "insert into loyalty_reservations(id,customer_id,order_total,status,committed_at) values($1,$2,2000,'committed',now())",
      [randomUUID(), f.friend],
    );
  }
}
async function payout(friend) {
  return (await db.query('select process_referral_purchase($1) result', [friend])).rows[0].result;
}

test('reinstall changes installation but preserves entitlement for the same account', async () => {
  const f = await fixture();
  assert.equal(await remember(f.friend, f.stable, hash()), null);
  assert.equal(await risk(f.friend), null);
  await buy(f);
  assert.equal((await payout(f.friend)).status, 'rewarded');
  assert.equal((await payout(f.friend)).status, 'already_processed');
});

test('second account can register but cannot accept a code after reinstall', async () => {
  const f = await fixture();
  const second = await account();
  assert.equal(await remember(second, f.stable, hash()), 'shared_device');
  await assert.rejects(
    db.query('select redeem_referral_code($1,$2)', [second, f.code]),
    /referral device already claimed/,
  );
  assert.equal(
    (await db.query('select count(*) n from customers where id=$1', [second])).rows[0].n,
    1,
  );
  assert.equal(await risk(f.friend), null, 'second login must not block the original account');
});

test('permanent device owner survives actual customer deletion', async () => {
  const deleted = await account(),
    stable = hash();
  await remember(deleted, stable);
  await db.query('delete from customers where id=$1', [deleted]);
  assert.equal(
    (
      await db.query('select customer_id from referral_stable_device_owners where device_hash=$1', [
        stable,
      ])
    ).rows[0].customer_id,
    deleted,
  );
  const fresh = await account();
  assert.equal(await remember(fresh, stable, hash()), 'shared_device');
});

test('first legacy installation owner wins when a second account upgrades first', async () => {
  const first = await account(),
    second = await account(),
    installation = hash(),
    stable = hash();
  await remember(first, null, installation);
  assert.equal(await remember(second, stable, installation), 'shared_device');
  assert.equal(await remember(first, stable, installation), null);
  assert.equal(
    (
      await db.query('select customer_id from referral_stable_device_owners where device_hash=$1', [
        stable,
      ])
    ).rows[0].customer_id,
    first,
  );
});

test('a legacy ID or an unverified stable ID cannot enable a reward', async () => {
  const f = await fixture();
  await db.query('delete from referral_stable_devices where customer_id=$1', [f.friend]);
  assert.equal(await remember(f.friend, null), 'missing_device');
  await assert.rejects(
    db.query('select remember_stable_referral_device($1,$2,$3,$4,null,null,false)', [
      f.friend,
      hash(),
      hash(),
      'android_id',
    ]),
    /invalid stable device/,
  );
  await buy(f);
  assert.equal((await payout(f.friend)).reason, 'missing_device');
  await remember(f.friend, f.stable);
  assert.equal((await payout(f.friend)).status, 'rewarded');
});

for (const source of ['online', 'pos']) {
  test(`${source}: manual approval cannot bypass a shared phone discovered after attribution`, async () => {
    const f = await fixture();
    await buy(f, source);
    const other = await account(),
      occupied = hash();
    await remember(other, occupied);
    assert.equal(await remember(f.friend, occupied), 'shared_device');
    const redemption = (
      await db.query('select id from referral_redemptions where referred_customer_id=$1', [
        f.friend,
      ])
    ).rows[0].id;
    await db.query("select review_referral($1,'approve','admin','Confirmed')", [redemption]);
    assert.equal((await payout(f.friend)).reason, 'shared_device');
    assert.equal(
      Number(
        (
          await db.query('select sum(balance) balance from customers where id in ($1,$2)', [
            f.friend,
            f.owner,
          ])
        ).rows[0].balance,
      ),
      0,
    );
  });
}

test('Apple persistent marker cannot be cleared by a later proof or fresh Keychain ID', async () => {
  const id = await account(),
    stable = hash();
  assert.equal(
    await remember(id, stable, hash(), { kind: 'ios_keychain', blocked: true }),
    'shared_device',
  );
  assert.equal(
    await remember(id, stable, hash(), { kind: 'ios_keychain', blocked: false }),
    'shared_device',
  );
  assert.equal(
    await remember(id, hash(), hash(), { kind: 'ios_keychain', blocked: false }),
    'shared_device',
  );
});

test('consumed proof and server challenge are both single-use', async () => {
  const first = await account(),
    second = await account(),
    proof = hash(),
    challenge = hash();
  await remember(first, hash(), hash(), { proof, challenge });
  await assert.rejects(
    remember(second, hash(), hash(), { proof, challenge: hash() }),
    /duplicate key/,
  );
  await assert.rejects(
    remember(second, hash(), hash(), { proof: hash(), challenge }),
    /duplicate key/,
  );
  assert.equal(await risk(second), 'missing_device');
});

test('unlimited friends on separate verified devices continue to earn', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) {
    const friend = await account();
    await remember(friend);
    await buy({ ...f, friend });
    assert.equal((await payout(friend)).status, 'rewarded');
  }
  assert.equal(
    Number(
      (await db.query('select balance from customers where id=$1', [f.owner])).rows[0].balance,
    ),
    3000,
  );
});

test('database clients cannot rewrite permanent owners or invoke privileged enrollment', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const row = (
      await db.query(
        `select has_table_privilege($1,'referral_stable_device_owners','UPDATE') u,has_table_privilege($1,'referral_stable_device_owners','DELETE') d`,
        [role],
      )
    ).rows[0];
    assert.deepEqual(row, { u: false, d: false });
  }
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','remember_stable_referral_device(uuid,text,text,text,text,text,boolean)','EXECUTE') ok",
      )
    ).rows[0].ok,
    false,
  );
});
