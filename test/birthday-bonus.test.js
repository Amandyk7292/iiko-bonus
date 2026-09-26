const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { deliverAutomatedMessages } = require('../src/services/commerce-marketing.service');

const db = new PGlite();
const migration = fs.readFileSync(
  'supabase/migrations/20260922120000_birthday_greetings.sql',
  'utf8',
);
const call = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const enqueue = async (at = '2026-09-22T06:00:00Z') =>
  Number((await call('select enqueue_birthday_greetings($1) as count', [at])).count);
let automationId;

test.before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, birth_date date, deleted_at timestamptz,
      fcm_token text, preferred_language text, balance numeric default 250, updated_at timestamptz);
    create table transactions(id uuid primary key default gen_random_uuid(), customer_id uuid, amount numeric, order_id text, branch_id uuid, type text, description text);
    create table customer_push_tokens(customer_id uuid, token text);
    create table customer_notification_preferences(customer_id uuid primary key,
      promos_enabled boolean default true, quiet_hours_enabled boolean default false,
      quiet_start time default '22:00', quiet_end time default '08:00', timezone text default 'Asia/Aqtau');
    create table marketing_automations(id uuid primary key default gen_random_uuid(),
      code text unique, trigger_type text, active boolean default true,
      title_translations jsonb, body_translations jsonb, config jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table marketing_deliveries(id uuid primary key default gen_random_uuid(),
      automation_id uuid references marketing_automations(id) on delete cascade,
      customer_id uuid references customers(id) on delete cascade, deduplication_key text,
      channel text, payload jsonb, status text default 'pending', error text,
      scheduled_at timestamptz default now(), created_at timestamptz default now(), sent_at timestamptz,
      unique(automation_id,customer_id,deduplication_key,channel));
  `);
  await db.exec(migration);
  await db.exec(
    fs.readFileSync('supabase/migrations/20260725120000_customer_access_hardening.sql', 'utf8'),
  );
});
test.after(() => db.close());
test.beforeEach(async () => {
  await db.exec('truncate customers, marketing_automations cascade');
  automationId = (
    await call(
      "insert into marketing_automations(code,trigger_type) values('birthday_default','birthday') returning id",
    )
  ).id;
  await db.exec(migration);
  await db.exec(
    fs
      .readFileSync('supabase/migrations/20260924020000_birthday_bonus_config.sql', 'utf8')
      .replace('add column bonus_amount', 'add column if not exists bonus_amount'),
  );
});

async function customer(birthday = '1998-09-22', token = 'test-device-token') {
  const id = crypto.randomUUID();
  await db.query('insert into customers(id,birth_date,fcm_token) values($1,$2,$3)', [
    id,
    birthday,
    token,
  ]);
  return id;
}

test('birthday gift is atomic and limited to one per year, with zero default and future config changes', async () => {
  const id = await customer();
  await db.query(
    'update marketing_automations set config=\'{"birthdayBonusAmount":1000}\' where id=$1',
    [automationId],
  );
  assert.equal(await enqueue(), 1);
  assert.equal(await enqueue(), 0);
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    1250,
  );
  assert.equal((await call('select payload from marketing_deliveries')).payload.bonusAmount, 1000);
  await db.query("update customers set birth_date='1998-09-23' where id=$1", [id]);
  assert.equal(await enqueue('2026-09-23T06:00:00Z'), 0);
  assert.equal((await call('select count(*)::integer n from transactions')).n, 1);
  await db.query(
    'update marketing_automations set config=\'{"birthdayBonusAmount":500}\' where id=$1',
    [automationId],
  );
  assert.equal(await enqueue('2027-09-23T06:00:00Z'), 1);
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    1750,
  );
});
test('zero gift preserves greeting without credit and disabling campaign stops both', async () => {
  const id = await customer();
  assert.equal(await enqueue(), 1);
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    250,
  );
  await db.query('update marketing_automations set active=false where id=$1', [automationId]);
  assert.equal(await enqueue('2027-09-22T06:00:00Z'), 0);
});
