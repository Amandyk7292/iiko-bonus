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
      fcm_token text, preferred_language text, balance numeric default 250);
    create table transactions(id uuid primary key, customer_id uuid, amount numeric);
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
  await db.exec(migration);
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

test('birthday sends once per year after date edits and repeated workers, without a bonus', async () => {
  const id = await customer();
  const counts = await Promise.all(Array.from({ length: 8 }, () => enqueue()));
  assert.equal(
    counts.reduce((sum, count) => sum + count, 0),
    1,
  );
  await db.query("update customers set birth_date='2001-09-23' where id=$1", [id]);
  assert.equal(await enqueue('2026-09-23T06:00:00Z'), 0);
  await db.query("update customers set birth_date='2001-09-22' where id=$1", [id]);
  assert.equal(await enqueue(), 0);
  assert.equal(await enqueue('2027-09-22T06:00:00Z'), 1);
  assert.equal((await call('select count(*)::integer as n from marketing_deliveries')).n, 2);
  assert.equal(
    Number((await call('select balance from customers where id=$1', [id])).balance),
    250,
  );
  assert.equal((await call('select count(*)::integer as n from transactions')).n, 0);
});

test('new or deleted automation rules cannot reset the annual greeting', async () => {
  await customer();
  await db.exec(
    "insert into marketing_automations(code,trigger_type) values('birthday_extra','birthday')",
  );
  assert.equal(await enqueue(), 1);
  await db.query('delete from marketing_automations where id=$1', [automationId]);
  assert.equal(await enqueue(), 0);
  assert.equal((await call('select delivery_id from birthday_greeting_claims')).delivery_id, null);
});

test('existing sent greetings survive migration and duplicate pending greetings are suppressed', async () => {
  const id = await customer();
  await db.query(
    `insert into marketing_deliveries(automation_id,customer_id,deduplication_key,channel,
    status,scheduled_at,sent_at,created_at) values($1,$2,'birthday:2026','push','sent',
    '2026-09-22T06:00:00Z','2026-09-22T06:00:00Z','2026-09-22T06:00:00Z')`,
    [automationId, id],
  );
  const extra = (
    await call(
      "insert into marketing_automations(code,trigger_type) values('extra','birthday') returning id",
    )
  ).id;
  await db.query(
    `insert into marketing_deliveries(automation_id,customer_id,deduplication_key,channel,
    scheduled_at,created_at) values($1,$2,'birthday:2026','push','2026-09-22T06:01:00Z','2026-09-22T06:01:00Z')`,
    [extra, id],
  );
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(await enqueue(), 0);
  assert.equal(
    (await call('select status from marketing_deliveries where automation_id=$1', [extra])).status,
    'skipped',
  );
});

test('dates and annual reset follow Kazakhstan time across UTC midnight and New Year', async () => {
  const id = await customer('2000-12-31');
  assert.equal(await enqueue('2026-12-30T18:59:00Z'), 0);
  assert.equal(await enqueue('2026-12-30T19:00:00Z'), 1);
  await db.query("update customers set birth_date='2000-01-01' where id=$1", [id]);
  assert.equal(await enqueue('2026-12-31T19:00:00Z'), 1);
  const years = (
    await db.query('select greeting_year from birthday_greeting_claims order by greeting_year')
  ).rows;
  assert.deepEqual(
    years.map((row) => row.greeting_year),
    [2026, 2027],
  );
});

test('no birthday, deleted customer, wrong day, disabled automation or no device do not consume a claim', async () => {
  await customer(null);
  const deleted = await customer();
  await db.query('update customers set deleted_at=now() where id=$1', [deleted]);
  await customer('1998-09-21');
  const device = await customer('1998-09-22', null);
  assert.equal(await enqueue(), 0);
  await db.query('insert into customer_push_tokens(customer_id,token) values($1,$2)', [
    device,
    'registered-token',
  ]);
  await db.exec('update marketing_automations set active=false');
  assert.equal(await enqueue(), 0);
  await db.exec('update marketing_automations set active=true');
  assert.equal(await enqueue(), 1);
});

test('quiet hours postpone the greeting and marketing opt-out is respected', async () => {
  const id = await customer();
  await db.query(
    'insert into customer_notification_preferences(customer_id,quiet_hours_enabled) values($1,true)',
    [id],
  );
  assert.equal(await enqueue('2026-09-21T20:00:00Z'), 0);
  assert.equal(await enqueue('2026-09-22T02:59:00Z'), 0);
  await db.query(
    'update customer_notification_preferences set promos_enabled=false where customer_id=$1',
    [id],
  );
  assert.equal(await enqueue(), 0);
  await db.query(
    'update customer_notification_preferences set promos_enabled=true where customer_id=$1',
    [id],
  );
  assert.equal(await enqueue('2026-09-22T03:00:00Z'), 1);
});

test('failed queue insert rolls back the annual claim, allowing a safe retry', async () => {
  await customer();
  await db.exec(
    'alter table marketing_deliveries add constraint simulate_unavailable_queue check (false) not valid',
  );
  await assert.rejects(enqueue(), /simulate_unavailable_queue/);
  assert.equal((await call('select count(*)::integer as n from birthday_greeting_claims')).n, 0);
  await db.exec('alter table marketing_deliveries drop constraint simulate_unavailable_queue');
  assert.equal(await enqueue(), 1);
});

test('customers cannot execute the scheduler or change the annual ledger', async () => {
  await db.exec('set role authenticated');
  await assert.rejects(enqueue(), /permission denied/);
  await assert.rejects(db.exec('delete from birthday_greeting_claims'), /permission denied/);
  await db.exec('reset role');
});

test('delivery uses the selected language and the same push key after copy or rule changes', async () => {
  const id = await customer();
  await enqueue();
  const delivery = await call('select * from marketing_deliveries');
  delivery.marketing_automations = await call('select * from marketing_automations where id=$1', [
    automationId,
  ]);
  const messages = [];
  const updates = [];
  let language = 'ru';
  const fakeDb = {
    from(table) {
      let patch;
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        lte() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        update(value) {
          patch = value;
          return query;
        },
        async maybeSingle() {
          return { data: { fcm_token: 'test-device-token', preferred_language: language } };
        },
        then(resolve, reject) {
          if (patch) updates.push(patch);
          return Promise.resolve({
            data: table === 'marketing_deliveries' && !patch ? [delivery] : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const sendPush = async (...args) => {
    messages.push(args);
    return { attempted: 1, delivered: 0, queued: true };
  };
  for (const requested of ['ru', 'kk', 'en', 'kz']) {
    language = requested;
    assert.equal(await deliverAutomatedMessages(100, { db: fakeDb, sendPush }), 1);
    delivery.marketing_automations.id = crypto.randomUUID();
    delivery.id = crypto.randomUUID();
  }
  assert.deepEqual(
    messages.map((args) => args[1]),
    ['С днём рождения!', 'Туған күніңізбен!', 'Happy birthday!', 'Туған күніңізбен!'],
  );
  assert.deepEqual(
    messages.map((args) => args[3].language),
    ['ru', 'kk', 'en', 'kk'],
  );
  assert.equal(new Set(messages.map((args) => args[3].pushDedupeKey)).size, 1);
  assert.ok(messages.every((args) => args[0] === id && !/1000|подарок|сыйлық|gift/i.test(args[2])));
  assert.ok(updates.every((update) => update.status === 'sent'));
  delivery.marketing_automations.active = false;
  assert.equal(await deliverAutomatedMessages(100, { db: fakeDb, sendPush }), 0);
  assert.equal(messages.length, 4);
});
