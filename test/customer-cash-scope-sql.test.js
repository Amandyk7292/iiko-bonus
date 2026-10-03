const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
test('cash scope filters online/POS histories before pagination and hides global entries from scoped staff', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table personal_account_entries(id uuid primary key,customer_id uuid,amount_minor bigint,kind text,source_key text,order_id uuid,topup_id uuid,description text,created_at timestamptz);
      create table kaspi_orders(id uuid primary key,branch_id uuid);
      create table personal_account_pos_payments(id uuid primary key,branch_id uuid);`);
    await db.exec(
      readFileSync('supabase/migrations/20261004101000_scoped_customer_cash_ledger.sql', 'utf8'),
    );
    const customer = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      orderA = randomUUID(),
      orderB = randomUUID(),
      pos = randomUUID(),
      visible = randomUUID(),
      posEntry = randomUUID();
    await db.query('insert into kaspi_orders values($1,$2),($3,$4)', [orderA, a, orderB, b]);
    await db.query('insert into personal_account_pos_payments values($1,$2)', [pos, a]);
    await db.query(
      "insert into personal_account_entries(id,customer_id,amount_minor,kind,source_key,order_id,created_at) values($1,$2,-10000,'payment',$3,$4,now()-interval '2 days')",
      [visible, customer, 'order-payment:' + orderA, orderA],
    );
    await db.query(
      "insert into personal_account_entries(id,customer_id,amount_minor,kind,source_key,created_at) values($1,$2,10000,'refund',$3,now()-interval '1 day')",
      [posEntry, customer, 'pos-refund:' + pos],
    );
    await db.query(
      "insert into personal_account_entries(id,customer_id,amount_minor,kind,source_key,order_id,created_at) select gen_random_uuid(),$1,-10000,'payment','hidden:'||n,$2,now() from generate_series(1,220)n",
      [customer, orderB],
    );
    await db.query(
      "insert into personal_account_entries(id,customer_id,amount_minor,kind,source_key,created_at) values(gen_random_uuid(),$1,100000,'topup','topup:global',now())",
      [customer],
    );
    const scoped = (
      await db.query('select * from customer_scoped_cash_entries($1,$2,20)', [customer, [a]])
    ).rows;
    assert.deepEqual(
      scoped.map((r) => r.id),
      [posEntry, visible],
    );
    assert.ok(scoped.every((r) => r.ledger_branch_id === a));
    assert.equal(
      (
        await db.query('select * from customer_scoped_cash_entries($1,$2,20)', [
          customer,
          [randomUUID()],
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query('select * from customer_scoped_cash_entries($1,null,200)', [customer])).rows
        .length,
      200,
    );
    for (const role of ['anon', 'authenticated'])
      assert.equal(
        (
          await db.query('select has_function_privilege($1,$2,$3) allowed', [
            role,
            'customer_scoped_cash_entries(uuid,uuid[],integer)',
            'EXECUTE',
          ])
        ).rows[0].allowed,
        false,
      );
  } finally {
    await db.close();
  }
});
