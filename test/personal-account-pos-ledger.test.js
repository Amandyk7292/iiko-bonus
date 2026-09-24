const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const hash = 'a'.repeat(64),
  fingerprint = 'b'.repeat(64);
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,deleted_at timestamptz,preferred_language text default 'ru');
    create table bulka_locations(id uuid primary key,active boolean default true,name text);
    create table customer_notifications(id uuid primary key,customer_id uuid,title text,body text,type text,payload jsonb);
    create table kaspi_orders(id uuid primary key,customer_id uuid,payment_method text,order_kind text default 'product',
      status text default 'pending',fulfillment_status text default 'pending',amount numeric,provider_status text,
      payment_reconciled_at timestamptz,updated_at timestamptz default now());`);
  await db.exec(fs.readFileSync('supabase/migrations/20260912090000_personal_account.sql', 'utf8'));
  await db.exec(
    fs.readFileSync('supabase/migrations/20260924010000_personal_account_pos.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function fixture() {
  const f = {
    id: crypto.randomUUID(),
    request: crypto.randomUUID(),
    customer: crypto.randomUUID(),
    branch: crypto.randomUUID(),
    order: crypto.randomUUID(),
    txn: crypto.randomUUID(),
  };
  await db.query('insert into customers(id) values($1)', [f.customer]);
  await db.query('insert into bulka_locations(id,name) values($1,$2)', [f.branch, 'Bulka']);
  await db.query('insert into personal_accounts(customer_id,balance_minor) values($1,100000)', [
    f.customer,
  ]);
  return f;
}
async function start(f) {
  return (
    await one('select personal_account_pos_start($1,$2,$3,$4,$5,60000,$6,$7,$8,$9,$10,$11) as r', [
      f.id,
      f.request,
      f.customer,
      f.branch,
      f.order,
      fingerprint,
      hash,
      crypto.randomUUID(),
      'Confirm',
      'Code 123456',
      '{}',
    ])
  ).r;
}
async function action(f, action, overrides = {}) {
  return (
    await one('select personal_account_pos_action($1,$2,$3,$4,$5,$6,$7,$8) as r', [
      f.id,
      overrides.branch || f.branch,
      f.order,
      overrides.amount || 60000,
      overrides.fingerprint || fingerprint,
      action,
      overrides.code || hash,
      overrides.txn || f.txn,
    ])
  ).r;
}
async function balance(f) {
  return Number(
    (await one('select balance_minor from personal_accounts where customer_id=$1', [f.customer]))
      .balance_minor,
  );
}
test('code authorizes only; full debit and full refund are each applied once', async () => {
  const f = await fixture();
  assert.equal((await start(f)).status, 'pending');
  assert.equal((await start(f)).id, f.id);
  assert.equal((await action(f, 'pay')).status, 'unauthorized');
  assert.equal((await action(f, 'confirm')).status, 'authorized');
  assert.equal(await balance(f), 100000);
  assert.equal((await action(f, 'pay')).status, 'paid');
  assert.equal((await action(f, 'pay')).status, 'paid');
  assert.equal(await balance(f), 40000);
  assert.equal((await action(f, 'pay', { txn: crypto.randomUUID() })).status, 'mismatch');
  await db.query(
    "update personal_account_pos_payments set expires_at=now()-interval '1 minute' where id=$1",
    [f.id],
  );
  assert.equal((await action(f, 'status')).status, 'paid');
  assert.equal((await action(f, 'refund')).status, 'refunded');
  assert.equal((await action(f, 'refund')).status, 'refunded');
  assert.equal(await balance(f), 100000);
  assert.equal(
    Number(
      (
        await one('select count(*) as n from personal_account_entries where customer_id=$1', [
          f.customer,
        ])
      ).n,
    ),
    2,
  );
  assert.equal(
    Number(
      (
        await one('select count(*) as n from customer_notifications where customer_id=$1', [
          f.customer,
        ])
      ).n,
    ),
    3,
  );
});
test('wrong branch, changed amount and five bad codes cannot authorize a debit', async () => {
  const f = await fixture();
  await start(f);
  assert.equal((await action(f, 'confirm', { branch: crypto.randomUUID() })).status, 'not_found');
  assert.equal((await action(f, 'confirm', { amount: 60001 })).status, 'mismatch');
  for (let i = 0; i < 5; i++)
    assert.equal((await action(f, 'confirm', { code: 'c'.repeat(64) })).status, 'invalid_code');
  assert.equal((await action(f, 'confirm')).status, 'locked');
  assert.equal((await action(f, 'pay')).status, 'locked');
  assert.equal(await balance(f), 100000);
});
test('expiration, cancellation and changed balance are checked at payment', async () => {
  const f = await fixture();
  await start(f);
  await action(f, 'confirm');
  await db.query('update personal_accounts set balance_minor=100 where customer_id=$1', [
    f.customer,
  ]);
  assert.equal((await action(f, 'pay')).status, 'insufficient');
  assert.equal(await balance(f), 100);
  assert.equal((await action(f, 'cancel')).status, 'cancelled');
  assert.equal((await action(f, 'pay')).status, 'cancelled');
  const g = await fixture();
  await start(g);
  await db.query(
    "update personal_account_pos_payments set expires_at=now()-interval '1 minute' where id=$1",
    [g.id],
  );
  assert.equal((await action(g, 'confirm')).status, 'expired');
  assert.equal(await balance(g), 100000);
});
