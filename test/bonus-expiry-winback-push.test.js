const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
const rpc = async (sql, values = []) => (await row(`select ${sql} result`, values)).result;
const realFunction = (file, name) => {
  const sql = readFileSync(file, 'utf8');
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
};
let customer;

test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table customers(id uuid primary key,balance numeric default 0,total_spent numeric default 0,
      preferred_language text default 'ru',deleted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,
      order_total numeric,description text,items jsonb,available_at timestamptz,activated_at timestamptz,
      expires_at timestamptz,expired_at timestamptz,created_at timestamptz default now(),timestamp timestamptz default now());
    create table loyalty_reservations(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text unique,
      original_order_id text,order_total numeric,discount_amount numeric,status text,expires_at timestamptz,
      updated_at timestamptz default now(),committed_at timestamptz,cancelled_at timestamptz);
    create table settings(key text primary key,value text);
    insert into settings values('bonus_expiration','{"enabled":true,"auto_write_off":true,"expiration_months":6}');
    create table loyalty_faq(id uuid primary key,answer_ru text,answer_kk text);
    create function family_bonus_owner(uuid) returns uuid language sql immutable as $$select $1$$;
    create table customer_push_tokens(customer_id uuid references customers(id),token text);
    create table customer_notifications(id uuid primary key,customer_id uuid references customers(id),title text,body text,type text,payload jsonb);
    create table marketing_automations(id uuid primary key,trigger_type text);
    create table marketing_deliveries(id uuid primary key,automation_id uuid references marketing_automations(id),status text,error text);`);
  await db.exec(realFunction('supabase_schema.sql', 'apply_loyalty_transaction'));
  await db.exec(
    realFunction(
      'supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql',
      'reserve_loyalty_balance',
    ),
  );
  await db.exec(
    realFunction('supabase/migrations/20260909180000_checkout_bonus.sql', 'quote_checkout_bonus'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260729170000_push_notification_outbox.sql', 'utf8').replace(
      'create extension if not exists pgcrypto;',
      '',
    ),
  );
  await db.exec(readFileSync('supabase/migrations/20260729171000_push_outbox_leases.sql', 'utf8'));
  for (const migration of [
    '20261015110000_bonus_credit_lots.sql',
    '20261015120000_bonus_expiry_reminders.sql',
    '20261015130000_bonus_expiry_winback.sql',
  ]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  }
  await db.exec(`create function test_reject_bonus_push() returns trigger language plpgsql as $$begin
    if exists(select 1 from settings where key='test_fail_push') then raise exception 'test durable queue unavailable'; end if;
    return new;
  end$$;
  create trigger test_reject_bonus_push before insert on push_notification_outbox for each row execute function test_reject_bonus_push();`);
});
test.beforeEach(async () => {
  await db.exec(
    'truncate customers,transactions,customer_push_tokens,customer_notifications,push_notification_outbox,bonus_credit_lots,bonus_lot_movements,bonus_lot_allocations,bonus_expiry_winback_rewards cascade',
  );
  await db.exec("delete from settings where key='test_fail_push'");
  customer = randomUUID();
  await db.query("insert into customers(id,created_at) values($1,'2020-01-01T00:00:00Z')", [
    customer,
  ]);
  await db.query('insert into customer_push_tokens values($1,$2)', [
    customer,
    `registered-${customer}`,
  ]);
  await db.transaction(async (tx) => {
    await tx.query('update customers set balance=500 where id=$1', [customer]);
    await tx.query(
      "insert into transactions(customer_id,order_id,type,amount,order_total,timestamp) values($1,$2,'deposit',500,1000,'2030-01-15T00:00:00Z')",
      [customer, `purchase-${customer}`],
    );
  });
});
test.after(async () => db.close());

test('all three release migrations compose: an actual expiry commits gift, dated lot, inbox and durable push once', async () => {
  const result = await rpc("expire_bonus_credit_lots($1,'2030-07-16T00:00:00Z')", [customer]);
  assert.equal(result.expiredAmount, 500);
  assert.equal(result.winbackAmount, 1000);
  assert.equal(
    Number((await row('select balance from customers where id=$1', [customer])).balance),
    1000,
  );
  const claim = await row('select * from bonus_expiry_winback_rewards where customer_id=$1', [
    customer,
  ]);
  const notification = await row('select * from customer_notifications where customer_id=$1', [
    customer,
  ]);
  const push = await row('select * from push_notification_outbox where customer_id=$1', [customer]);
  assert.equal(notification.title, 'Мы скучали!');
  assert.equal(notification.payload.winbackClaimId, claim.id);
  assert.equal(push.payload.winbackClaimId, claim.id);
  assert.equal(push.payload.notificationId, notification.id);
  assert.equal(push.payload.amount, 1000);
  assert.deepEqual(push.pending_tokens, [`registered-${customer}`]);
  const giftLot = await row('select * from bonus_credit_lots where source_transaction_id=$1', [
    claim.transaction_id,
  ]);
  assert.equal(Number(giftLot.remaining_amount), 1000);
  assert.equal(new Date(giftLot.expires_at).toISOString(), '2031-01-16T00:00:00.000Z');
  assert.equal(
    (await rpc("expire_bonus_credit_lots($1,'2030-07-16T00:00:00Z')", [customer])).winbackAmount,
    0,
  );
  assert.equal(Number((await row('select count(*) n from push_notification_outbox')).n), 1);
});

test('a real durable outbox failure rolls back the preceding inbox, gift ledger, lot and expiry together', async () => {
  await db.query("insert into settings values('test_fail_push','true')");
  await assert.rejects(
    rpc("expire_bonus_credit_lots($1,'2030-07-16T00:00:00Z')", [customer]),
    /durable queue unavailable/,
  );
  assert.equal(
    Number((await row('select balance from customers where id=$1', [customer])).balance),
    500,
  );
  assert.equal(Number((await row('select count(*) n from customer_notifications')).n), 0);
  assert.equal(Number((await row('select count(*) n from push_notification_outbox')).n), 0);
  assert.equal(Number((await row('select count(*) n from bonus_expiry_winback_rewards')).n), 0);
  assert.equal(
    Number(
      (
        await row(
          "select count(*) n from transactions where type in('expiration','manual_deposit')",
        )
      ).n,
    ),
    0,
  );
  assert.equal(
    Number(
      (await row('select remaining_amount from bonus_credit_lots where customer_id=$1', [customer]))
        .remaining_amount,
    ),
    500,
  );
  await db.query("delete from settings where key='test_fail_push'");
  assert.equal(
    (await rpc("expire_bonus_credit_lots($1,'2030-07-16T00:00:00Z')", [customer])).winbackAmount,
    1000,
  );
  assert.equal(Number((await row('select count(*) n from push_notification_outbox')).n), 1);
});
