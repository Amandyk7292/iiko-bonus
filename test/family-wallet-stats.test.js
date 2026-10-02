const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`select ${sql} as r`, args)).r;
const passwordHash = bcrypt.hashSync('Child2026', 4);
const fingerprint = 'b'.repeat(64);
const codeHash = 'a'.repeat(64);
const correction = '20261002172800_family_wallet_available.sql';

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,name text not null,phone text not null,
      balance numeric default 0,total_spent numeric default 0,created_at timestamptz default now(),
      deleted_at timestamptz,preferred_language text default 'ru');
    create table bulka_locations(id uuid primary key,active boolean default true,name text);
    create table customer_notifications(id uuid primary key,customer_id uuid,title text,body text,type text,payload jsonb);
    create table kaspi_orders(id uuid primary key,customer_id uuid,payment_method text,order_kind text default 'product',
      status text default 'pending',fulfillment_status text default 'pending',amount numeric,provider_status text,
      payment_reconciled_at timestamptz,updated_at timestamptz default now());`);
  for (const migration of [
    '20260912090000_personal_account.sql',
    '20260924010000_personal_account_pos.sql',
    '20260924050000_personal_pos_terminal_state.sql',
    '20260924160000_personal_pos_notice_amount.sql',
    '20261002170000_customer_family.sql',
    '20261002171000_family_pos_wallet.sql',
    correction,
    correction,
  ])
    await db.exec(fs.readFileSync(`supabase/migrations/${migration}`, 'utf8'));
});
test.after(() => db.close());

async function child(owner, limit = 100000) {
  const login = `kid_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const created = await rpc('family_create_child($1,$2,$3,$4,$5,$6)', [
    owner,
    'Child',
    login,
    'child@example.com',
    passwordHash,
    limit,
  ]);
  assert.equal(created.status, 'ok');
  return created.memberId;
}
async function fixture({ wallet = 100000, limit = 100000 } = {}) {
  const f = { owner: crypto.randomUUID(), branch: crypto.randomUUID() };
  await db.query("insert into customers(id,name,phone) values($1,'Parent','77000000001')", [
    f.owner,
  ]);
  await db.query("insert into bulka_locations(id,name) values($1,'Bulka')", [f.branch]);
  if (wallet !== null)
    await db.query('insert into personal_accounts(customer_id,balance_minor) values($1,$2)', [
      f.owner,
      wallet,
    ]);
  f.member = await child(f.owner, limit);
  return f;
}
function payment(f, amount) {
  return {
    ...f,
    id: crypto.randomUUID(),
    request: crypto.randomUUID(),
    order: crypto.randomUUID(),
    transaction: crypto.randomUUID(),
    amount,
  };
}
async function start(p) {
  return rpc('family_pos_start($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)', [
    p.id,
    p.request,
    p.member,
    new Date(Date.now() + 240000).toISOString(),
    p.branch,
    p.order,
    p.amount,
    fingerprint,
    codeHash,
    crypto.randomUUID(),
  ]);
}
async function action(p, value) {
  return rpc('personal_account_pos_action($1,$2,$3,$4,$5,$6,$7,$8)', [
    p.id,
    p.branch,
    p.order,
    p.amount,
    fingerprint,
    value,
    value === 'confirm' ? codeHash : null,
    p.transaction,
  ]);
}
async function normalStart(p) {
  return rpc('personal_account_pos_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
    p.id,
    p.request,
    p.owner,
    p.branch,
    p.order,
    p.amount,
    fingerprint,
    codeHash,
    crypto.randomUUID(),
    'Test',
    'Test',
    {},
  ]);
}
async function stats(member) {
  const result = await rpc('family_member_wallet_stats($1)', [member]);
  return (
    result && {
      spentToday: Number(result.spentToday),
      remainingToday: Number(result.remainingToday),
    }
  );
}

test('another member hold reduces the displayed shared allowance without being counted as spending', async () => {
  const f = await fixture();
  const second = await child(f.owner);
  const reserved = payment(f, 90000);
  assert.equal((await start(reserved)).status, 'authorized');
  assert.deepEqual(await stats(second), { spentToday: 0, remainingToday: 100 });
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 100 });
  assert.equal((await start(payment({ ...f, member: second }, 20000))).status, 'insufficient');
  assert.equal((await action(reserved, 'cancel')).status, 'cancelled');
  assert.deepEqual(await stats(second), { spentToday: 0, remainingToday: 1000 });
  assert.equal(
    Number(
      (await one('select balance_minor from personal_accounts where customer_id=$1', [f.owner]))
        .balance_minor,
    ),
    100000,
  );
});

test('own paid purchases and own holds consume the daily cap, independently of another member spending', async () => {
  const f = await fixture({ wallet: 300000, limit: 40000 });
  const paid = payment(f, 15000);
  assert.equal((await start(paid)).status, 'authorized');
  assert.equal((await action(paid, 'pay')).status, 'paid');
  assert.deepEqual(await stats(f.member), { spentToday: 150, remainingToday: 250 });
  const second = await child(f.owner);
  assert.equal((await start(payment({ ...f, member: second }, 100000))).status, 'authorized');
  const hold = payment(f, 20000);
  assert.equal((await start(hold)).status, 'authorized');
  assert.deepEqual(await stats(f.member), { spentToday: 150, remainingToday: 50 });
  assert.equal((await action(hold, 'pay')).status, 'paid');
  assert.equal((await action(hold, 'pay')).status, 'paid');
  assert.deepEqual(await stats(f.member), { spentToday: 350, remainingToday: 50 });
});

test('ordinary owner cashier authorizations share the wallet, while unconfirmed requests do not reserve it', async () => {
  const f = await fixture();
  const pending = payment(f, 60000);
  assert.equal((await normalStart(pending)).status, 'pending');
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 1000 });
  assert.equal((await action(pending, 'confirm')).status, 'authorized');
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 400 });
  assert.equal((await action(pending, 'cancel')).status, 'cancelled');
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 1000 });
});

test('expired, stale and revoked family proofs never appear as spent money or valid shared holds', async () => {
  for (const invalid of [
    'expired_intent',
    'expired_proof',
    'stale_version',
    'blocked',
    'removed',
    'cancelled',
  ]) {
    const f = await fixture();
    const otherMember = await child(f.owner);
    const hold = payment({ ...f, member: otherMember }, 50000);
    assert.equal((await start(hold)).status, 'authorized', invalid);
    if (invalid === 'expired_intent')
      await db.query(
        "update personal_account_pos_payments set expires_at=now()-interval '1 second' where id=$1",
        [hold.id],
      );
    if (invalid === 'expired_proof')
      await db.query(
        "update personal_account_pos_payments set family_qr_expires_at=now()-interval '1 second' where id=$1",
        [hold.id],
      );
    if (invalid === 'stale_version')
      await db.query(
        'update personal_account_pos_payments set family_qr_version=family_qr_version+1 where id=$1',
        [hold.id],
      );
    if (invalid === 'blocked')
      await rpc('family_update_member($1,$2,null,true,null)', [f.owner, otherMember]);
    if (invalid === 'removed') await rpc('family_remove_member($1,$2)', [f.owner, otherMember]);
    if (invalid === 'cancelled') await action(hold, 'cancel');
    assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 1000 }, invalid);
  }
});

test('expired ordinary authorization releases only the displayed hold and never becomes spending', async () => {
  const f = await fixture();
  const ordinary = payment(f, 70000);
  await normalStart(ordinary);
  await action(ordinary, 'confirm');
  await db.query(
    "update personal_account_pos_payments set expires_at=now()-interval '1 second' where id=$1",
    [ordinary.id],
  );
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 1000 });
});

test('refund restores the daily allowance and wallet once without double counting the original purchase', async () => {
  const f = await fixture({ wallet: 100000, limit: 60000 });
  const paid = payment(f, 40000);
  await start(paid);
  await action(paid, 'pay');
  assert.deepEqual(await stats(f.member), { spentToday: 400, remainingToday: 200 });
  assert.equal((await action(paid, 'refund')).status, 'refunded');
  assert.equal((await action(paid, 'refund')).status, 'refunded');
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 600 });
  assert.equal(
    Number(
      (await one('select balance_minor from personal_accounts where customer_id=$1', [f.owner]))
        .balance_minor,
    ),
    100000,
  );
});

test('Kazakhstan midnight resets the cap, while already spent personal money stays deducted', async () => {
  const f = await fixture({ wallet: 100000, limit: 60000 });
  const paid = payment(f, 40000);
  await start(paid);
  await action(paid, 'pay');
  await db.query(
    "update personal_account_pos_payments set family_paid_at=(date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty')-interval '1 second' where id=$1",
    [paid.id],
  );
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 600 });
  const hold = payment(f, 50000);
  assert.equal((await start(hold)).status, 'authorized');
  assert.deepEqual(await stats(f.member), { spentToday: 0, remainingToday: 100 });
});

test('blocked, missing and over-reserved wallets expose no spendable money; unavailable members expose no stats', async () => {
  const blocked = await fixture();
  await db.query('update personal_accounts set blocked=true where customer_id=$1', [blocked.owner]);
  assert.deepEqual(await stats(blocked.member), { spentToday: 0, remainingToday: 0 });
  const missing = await fixture({ wallet: null });
  assert.deepEqual(await stats(missing.member), { spentToday: 0, remainingToday: 0 });
  const exhausted = await fixture();
  await start(payment(exhausted, 60000));
  await db.query('update personal_accounts set balance_minor=10000 where customer_id=$1', [
    exhausted.owner,
  ]);
  assert.deepEqual(await stats(exhausted.member), { spentToday: 0, remainingToday: 0 });
  await rpc('family_update_member($1,$2,null,true,null)', [exhausted.owner, exhausted.member]);
  assert.equal(await stats(exhausted.member), null);
  assert.equal(await stats(crypto.randomUUID()), null);
});

test('the corrected stats function remains service-only after repeated migration application', async () => {
  for (const role of ['anon', 'authenticated', 'service_role'])
    assert.equal(
      (
        await one(
          "select has_function_privilege($1,'family_member_wallet_stats(uuid)','EXECUTE') allowed",
          [role],
        )
      ).allowed,
      role === 'service_role',
    );
});
