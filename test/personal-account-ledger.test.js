const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const result = async (sql, args = []) => (await db.query(sql, args)).rows[0];
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table customers(id uuid primary key,deleted_at timestamptz,balance numeric default 777);
    create table kaspi_orders(id uuid primary key,customer_id uuid references customers(id),payment_method text,
      order_kind text default 'product',status text default 'pending',fulfillment_status text default 'pending',
      amount numeric,provider_status text,payment_reconciled_at timestamptz,updated_at timestamptz default now());`);
  await db.exec(fs.readFileSync('supabase/migrations/20260912090000_personal_account.sql', 'utf8'));
});
test.after(() => db.close());
async function funded(amount = 100000) {
  const customer = crypto.randomUUID(),
    topup = crypto.randomUUID(),
    transaction = crypto.randomUUID();
  await db.query('insert into customers(id) values ($1)', [customer]);
  await db.query(
    "insert into personal_account_topups(id,customer_id,request_id,amount_minor,status,token_ciphertext) values($1,$2,$3,$4,'pending','fixture')",
    [topup, customer, crypto.randomUUID(), amount],
  );
  await db.query('select personal_account_confirm_topup($1,$2)', [topup, transaction]);
  return { customer, topup, transaction };
}
async function order(customer, amount) {
  const id = crypto.randomUUID();
  await db.query(
    "insert into kaspi_orders(id,customer_id,payment_method,amount) values($1,$2,'personal_account',$3)",
    [id, customer, amount],
  );
  return id;
}
test('verified topup, payment and refund each change cash balance once without changing loyalty', async () => {
  const { customer, topup, transaction } = await funded();
  await db.query('select personal_account_confirm_topup($1,$2)', [topup, transaction]);
  assert.equal(
    Number(
      (await result('select balance_minor from personal_accounts where customer_id=$1', [customer]))
        .balance_minor,
    ),
    100000,
  );
  const id = await order(customer, 600);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await result('select personal_account_pay_order($1,$2) as data', [customer, id])).data
        .status,
      'paid',
    );
  assert.equal(
    Number(
      (await result('select balance_minor from personal_accounts where customer_id=$1', [customer]))
        .balance_minor,
    ),
    40000,
  );
  const excessive = await order(customer, 500);
  assert.equal(
    (await result('select personal_account_pay_order($1,$2) as data', [customer, excessive])).data
      .status,
    'insufficient',
  );
  const refund = crypto.randomUUID();
  await db.query('select personal_account_refund_order($1,$2,60000)', [id, refund]);
  await db.query('select personal_account_refund_order($1,$2,60000)', [id, refund]);
  await assert.rejects(
    db.query('select personal_account_refund_order($1,$2,1)', [id, crypto.randomUUID()]),
    /refund exceeds payment/,
  );
  assert.equal(
    Number(
      (await result('select balance_minor from personal_accounts where customer_id=$1', [customer]))
        .balance_minor,
    ),
    100000,
  );
  assert.equal(
    Number((await result('select balance from customers where id=$1', [customer])).balance),
    777,
  );
});
test('replayed bank reversals are idempotent and overdrafts block further spending', async () => {
  const { customer, topup, transaction } = await funded();
  const id = await order(customer, 600);
  await db.query('select personal_account_pay_order($1,$2)', [customer, id]);
  const reversal = crypto.randomUUID();
  await db.query('select personal_account_reverse_bank_transaction($1,$2,$3,50000)', [
    topup,
    transaction,
    reversal,
  ]);
  await db.query('select personal_account_reverse_bank_transaction($1,$2,$3,50000)', [
    topup,
    transaction,
    reversal,
  ]);
  const balance = await result(
    'select balance_minor,blocked from personal_accounts where customer_id=$1',
    [customer],
  );
  assert.equal(Number(balance.balance_minor), -10000);
  assert.equal(balance.blocked, true);
  assert.equal(
    (
      await result('select personal_account_pay_order($1,$2) as data', [
        customer,
        await order(customer, 100),
      ])
    ).data.status,
    'blocked',
  );
  await assert.rejects(
    db.query('select personal_account_reverse_bank_transaction($1,$2,$3,60000)', [
      topup,
      transaction,
      crypto.randomUUID(),
    ]),
    /reversal exceeds topup/,
  );
});
test('ledger enforces ownership and refuses deleting customers with unsettled money', async () => {
  const a = await funded(),
    b = await funded();
  const id = await order(a.customer, 100);
  await assert.rejects(
    db.query('select personal_account_pay_order($1,$2)', [b.customer, id]),
    /not found/,
  );
  await assert.rejects(
    db.query('update customers set deleted_at=now() where id=$1', [a.customer]),
    /unsettled funds/,
  );
  await assert.rejects(
    db.query('delete from personal_account_entries where customer_id=$1', [a.customer]),
    /append-only/,
  );
});
