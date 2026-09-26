const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('personal account adjustment route requires financial permission and validation', () => {
  const source = fs.readFileSync('src/routes/admin/customer.routes.js', 'utf8');
  assert.match(
    source,
    /personal-account-adjustment'[\s\S]*requireAdminAction\(PAYMENT_ACTIONS\.MANAGE\)[\s\S]*adminPersonalAccountAdjustmentSchema/,
  );
});

test('admin personal account adjustment is atomic, idempotent and cannot overdraw', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,deleted_at timestamptz);
    create table kaspi_orders(
      id uuid primary key,customer_id uuid references customers(id),payment_method text,
      order_kind text default 'product',status text,fulfillment_status text,amount numeric(12,2),
      provider_status text,payment_reconciled_at timestamptz,updated_at timestamptz default now()
    );
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20260912090000_personal_account.sql', 'utf8'));
  await db.exec(
    fs.readFileSync(
      'supabase/migrations/20260924130000_admin_personal_account_adjustments.sql',
      'utf8',
    ),
  );
  const customerId = randomUUID();
  const requestId = randomUUID();
  await db.query('insert into customers(id) values($1)', [customerId]);
  const adjusted = await db.query('select admin_adjust_personal_account($1,$2,$3,$4,$5) result', [
    customerId,
    50000,
    requestId,
    'Пополнение по обращению',
    'owner',
  ]);
  assert.equal(adjusted.rows[0].result.balanceMinor, 50000);
  assert.equal(adjusted.rows[0].result.duplicate, false);
  const duplicate = await db.query('select admin_adjust_personal_account($1,$2,$3,$4,$5) result', [
    customerId,
    50000,
    requestId,
    'Пополнение по обращению',
    'owner',
  ]);
  assert.equal(duplicate.rows[0].result.balanceMinor, 50000);
  assert.equal(duplicate.rows[0].result.duplicate, true);
  assert.equal(
    (await db.query('select count(*) count from personal_account_entries')).rows[0].count,
    1,
  );
  const entry = (
    await db.query('select amount_minor,description,created_by from personal_account_entries')
  ).rows[0];
  assert.equal(entry.amount_minor, 50000);
  assert.equal(entry.description, 'Пополнение по обращению');
  assert.equal(entry.created_by, 'owner');
  await assert.rejects(
    db.query('select admin_adjust_personal_account($1,$2,$3,$4,$5)', [
      customerId,
      -60000,
      randomUUID(),
      'Недопустимое списание',
      'owner',
    ]),
    /insufficient personal account balance/,
  );
});
