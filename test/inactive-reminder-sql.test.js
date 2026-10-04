const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const migration = fs.readFileSync(
  'supabase/migrations/20261004193000_inactive_reminder_daytime.sql',
  'utf8',
);
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let automation;
const day = '2026-10-04';
const enqueue = async (at, id = automation) =>
  Number((await row('select enqueue_inactive_order_reminders_at($1,48,$2) as n', [id, at])).n);
const scheduled = async (id, date = day) =>
  new Date((await row('select inactive_reminder_scheduled_at($1,$2) as at', [id, date])).at);
async function customer({
  ageHours = 72,
  token = 'test-token',
  deleted = false,
  order = true,
} = {}) {
  const id = crypto.randomUUID();
  await db.query('insert into customers(id,fcm_token,deleted_at) values($1,$2,$3)', [
    id,
    token,
    deleted ? '2026-10-01' : null,
  ]);
  if (order) {
    await db.query(
      `insert into kaspi_orders(id,customer_id,status,created_at,cart_items)
       values(gen_random_uuid(),$1,'paid','2026-10-04T06:00:00Z'::timestamptz - make_interval(hours=>$2),
       '[{"id":"product-1","name":"Bread","quantity":1},{"id":"product-2","name":"Bun","quantity":3,"name_translations":{"kk":"Тоқаш"}}]')`,
      [id, ageHours],
    );
  }
  return id;
}
async function eligible(id, at, date = day) {
  const claim = await row(
    'select delivery_id from inactive_reminder_claims where customer_id=$1 and reminder_date=$2',
    [id, date],
  );
  return (
    await row('select inactive_order_reminder_allowed($1,$2,$3,$4) as allowed', [
      id,
      claim.delivery_id,
      date,
      at,
    ])
  ).allowed;
}

test.before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, fcm_token text, deleted_at timestamptz);
    create table customer_push_tokens(customer_id uuid, token text);
    create table customer_notification_preferences(customer_id uuid primary key, promos_enabled boolean);
    create table kaspi_orders(id uuid primary key,customer_id uuid,status text,created_at timestamptz,cart_items jsonb);
    create table marketing_automations(id uuid primary key default gen_random_uuid(),code text,
      trigger_type text,active boolean default true,config jsonb default '{}',updated_at timestamptz);
    create table marketing_deliveries(id uuid primary key default gen_random_uuid(),
      automation_id uuid references marketing_automations(id) on delete cascade,
      customer_id uuid references customers(id) on delete cascade,deduplication_key text,
      channel text,payload jsonb default '{}',status text default 'pending',error text,
      scheduled_at timestamptz default now(),created_at timestamptz default now(),sent_at timestamptz,
      unique(automation_id,customer_id,deduplication_key,channel));
    create table push_notification_outbox(id uuid primary key default gen_random_uuid(),customer_id uuid,
      payload jsonb,status text,pending_tokens jsonb,locked_at timestamptz,lease_token uuid,
      last_error text,updated_at timestamptz);
  `);
  await db.exec(migration);
  await db.exec(migration);
});
test.after(() => db.close());
test.beforeEach(async () => {
  await db.exec(
    'truncate customers,marketing_automations,kaspi_orders,customer_push_tokens,customer_notification_preferences,push_notification_outbox cascade',
  );
  automation = (
    await row(
      "insert into marketing_automations(code,trigger_type) values('inactive_default','inactive') returning id",
    )
  ).id;
});

test('slots are stable across calls, spread over11–16 and follow Asia/Almaty timezone rules', async () => {
  const slots = new Set();
  for (let i = 1; i <= 80; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const first = await scheduled(id);
    assert.equal((await scheduled(id)).toISOString(), first.toISOString());
    assert.ok(first >= new Date('2026-10-04T06:00:00Z'));
    assert.ok(first <= new Date('2026-10-04T10:50:00Z'));
    slots.add(first.getTime());
    const historical = await scheduled(id, '2024-01-04');
    assert.ok(historical >= new Date('2024-01-04T05:00:00Z'));
    assert.ok(historical <= new Date('2024-01-04T09:50:00Z'));
  }
  assert.ok(slots.size >= 25);
});

test('slot hashing is independent of the database session timezone and date display style', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const query = 'select extract(epoch from inactive_reminder_scheduled_at($1,$2)) as epoch';
  const before = (await row(query, [id, day])).epoch;
  try {
    await db.exec("set timezone='Pacific/Auckland'; set datestyle='SQL, DMY'");
    assert.equal((await row(query, [id, day])).epoch, before);
  } finally {
    await db.exec("set timezone='UTC'; set datestyle='ISO, MDY'");
  }
});

test('calendar claim survives repeated workers, another automation, new order and rule deletion', async () => {
  const id = await customer();
  const at = await scheduled(id);
  const counts = await Promise.all(Array.from({ length: 8 }, () => enqueue(at)));
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    1,
  );
  const payload = (await row('select payload from marketing_deliveries')).payload;
  assert.equal(payload.productId, 'product-2');
  assert.equal(payload.productNames.kk, 'Тоқаш');
  assert.equal(payload.quantity, 3);
  assert.equal(payload.reminderDate, day);
  assert.equal(new Date(payload.reminderExpiresAt).toISOString(), '2026-10-04T11:00:00.000Z');
  const other = (
    await row(
      "insert into marketing_automations(code,trigger_type) values('extra','inactive') returning id",
    )
  ).id;
  assert.equal(await enqueue(at, other), 0);
  await db.query('delete from marketing_automations where id=$1', [automation]);
  assert.equal((await row('select delivery_id from inactive_reminder_claims')).delivery_id, null);
  assert.equal(await enqueue(at, other), 0);
  const tomorrow = await scheduled(id, '2026-10-05');
  assert.equal(await enqueue(tomorrow, other), 1);
});

test('before11, at16,22 and missed slots never create a restart catchup burst', async () => {
  const id = await customer();
  const at = await scheduled(id);
  assert.equal(await enqueue('2026-10-04T05:59:59Z'), 0);
  assert.equal(await enqueue(new Date(at.getTime() - 1)), 0);
  assert.equal(await enqueue(new Date(at.getTime() + 600000)), 0);
  assert.equal(await enqueue('2026-10-04T11:00:00Z'), 0);
  assert.equal(await enqueue('2026-10-04T17:00:00Z'), 0);
  assert.equal(await enqueue(await scheduled(id, '2026-10-05')), 1);
});

test('boundary slots permit11:00 and15:59:59, and yesterday does not impose rolling24h', async () => {
  let early, late;
  for (let i = 1; i <= 250 && (!early || !late); i++) {
    const id = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
    const at = await scheduled(id);
    if (at.getUTCHours() === 6 && at.getUTCMinutes() === 0) early = id;
    if (at.getUTCHours() === 10 && at.getUTCMinutes() === 50) late = id;
  }
  assert.ok(early && late);
  for (const id of [early, late]) {
    await db.query("insert into customers(id,fcm_token) values($1,'test')", [id]);
    await db.query(
      `insert into kaspi_orders values(gen_random_uuid(),$1,'paid','2026-10-01','[{"name":"Bread"}]')`,
      [id],
    );
    await db.query(
      `insert into marketing_deliveries(automation_id,customer_id,channel,status,sent_at,created_at)
      values($1,$2,'push','sent','2026-10-03T10:59:00Z','2026-10-03T10:59:00Z')`,
      [automation, id],
    );
  }
  assert.equal(await enqueue('2026-10-04T06:00:00Z'), 1);
  assert.equal(await enqueue('2026-10-04T10:59:59Z'), 1);
  assert.equal(await enqueue('2026-10-04T11:00:00Z'), 0);
});

test('no new audience: optout, deleted, recent purchase, no paid purchase, empty token stay excluded', async () => {
  const excluded = [
    await customer({ deleted: true }),
    await customer({ ageHours: 12 }),
    await customer({ order: false }),
    await customer({ token: null }),
  ];
  const optout = await customer();
  await db.query('insert into customer_notification_preferences values($1,false)', [optout]);
  excluded.push(optout);
  for (const id of excluded) assert.equal(await enqueue(await scheduled(id)), 0);
  assert.equal(Number((await row('select count(*) as n from inactive_reminder_claims')).n), 0);
  const registered = excluded[3];
  await db.query("insert into customer_push_tokens values($1,'registered')", [registered]);
  assert.equal(await enqueue(await scheduled(registered)), 1);
});

test('other marketing retains its24h suppression cap', async () => {
  const id = await customer();
  const other = (
    await row("insert into marketing_automations(trigger_type) values('birthday') returning id")
  ).id;
  const at = await scheduled(id);
  await db.query(
    `insert into marketing_deliveries(automation_id,customer_id,channel,status,created_at)
    values($1,$2,'push','pending',$3)`,
    [other, id, new Date(at.getTime() - 3600000)],
  );
  assert.equal(await enqueue(at), 0);
  await db.exec("update marketing_deliveries set status='skipped'");
  assert.equal(await enqueue(at), 1);
  assert.equal(await eligible(id, at), true);
  await db.query(
    "update marketing_deliveries set status='sent',sent_at=$1 where automation_id=$2",
    [at, other],
  );
  assert.equal(await eligible(id, at), false);
});

test('provider guard requires current day, claimed delivery, active rule and still-inactive paid order', async () => {
  const id = await customer();
  const at = await scheduled(id);
  assert.equal(await enqueue(at), 1);
  assert.equal(await eligible(id, at), true);
  assert.equal(await eligible(id, new Date(at.getTime() - 1)), false);
  assert.equal(await eligible(id, '2026-10-04T11:00:00Z'), false);
  assert.equal(await eligible(id, '2026-10-04T17:00:00Z'), false);
  assert.equal(await eligible(id, '2026-10-05T07:00:00Z'), false);
  await db.query('insert into customer_notification_preferences values($1,false)', [id]);
  assert.equal(await eligible(id, at), false);
  await db.exec('update customer_notification_preferences set promos_enabled=true');
  await db.exec('update marketing_automations set active=false');
  assert.equal(await eligible(id, at), false);
  await db.exec('update marketing_automations set active=true');
  await db.query(
    `insert into kaspi_orders values(gen_random_uuid(),$1,'paid',$2,'[{"name":"New bun"}]')`,
    [id, at],
  );
  assert.equal(await eligible(id, at), false);
});

test('migration preserves sent daily allowance and retires only old inactive queues, repeat-safe', async () => {
  const id = await customer();
  const at = await scheduled(id);
  await db.query(
    `insert into marketing_deliveries(automation_id,customer_id,channel,status,sent_at,created_at)
    values($1,$2,'push','sent',$3,$3),($1,$2,'push','pending',null,$3)`,
    [automation, id, at],
  );
  await db.exec(`insert into push_notification_outbox(payload,status,pending_tokens)
    values('{"type":"marketing_inactive"}','retry','["test-token"]'),('{"type":"order"}','queued','["test-token"]')`);
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(await enqueue(at), 0);
  assert.equal(
    Number((await row("select count(*) as n from marketing_deliveries where status='skipped'")).n),
    1,
  );
  const outbox = (
    await db.query(
      "select payload,status,pending_tokens from push_notification_outbox order by payload->>'type'",
    )
  ).rows;
  assert.equal(outbox[0].status, 'skipped');
  assert.deepEqual(outbox[0].pending_tokens, []);
  assert.equal(outbox[1].status, 'queued');
});

test('new RPCs and claim table require service role; old wrapper remains usable', async () => {
  const funcs = (
    await db.query(`select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('inactive_reminder_scheduled_at','enqueue_inactive_order_reminders_at',
      'enqueue_inactive_order_reminders','inactive_order_reminder_allowed')`)
  ).rows;
  assert.equal(funcs.length, 4);
  for (const func of funcs) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(
        (await row("select has_function_privilege($1,$2,'EXECUTE') as ok", [role, func.oid])).ok,
        role === 'service_role',
      );
    }
  }
  assert.equal(
    (await row("select has_table_privilege('anon','inactive_reminder_claims','SELECT') as ok")).ok,
    false,
  );
  assert.equal(await enqueue('2026-10-04T17:00:00Z'), 0);
  assert.equal(
    Number((await row('select enqueue_inactive_order_reminders($1) as n', [automation])).n),
    0,
  );
});
