const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const sql = (name) =>
  readFileSync(`supabase/migrations/${name}.sql`, 'utf8').replaceAll('\r\n', '\n');
function definition(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
}
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key, active boolean default true);
    create table admin_sessions(jti_hash varchar(64) primary key, admin_subject text, auth_version integer,
      role text, branch_ids uuid[], revoked_at timestamptz, expires_at timestamptz);
    create table admin_user_profiles(username text primary key, active boolean, role text, branch_ids uuid[]);
    create table admin_staff_credentials(username text primary key, auth_version integer);
    create table kaspi_orders(id uuid primary key, branch_id uuid, order_number bigint default 100001,
      status text default 'paid', fulfillment_status text default 'new', kitchen_status text default 'queued',
      refund_status text, staff_acceptance_requested_at timestamptz, created_at timestamptz default now());`);
  const base = sql('20260812100000_staff_order_push_notifications');
  await db.exec(
    base.slice(
      base.indexOf('create table if not exists public.staff_push_devices'),
      base.indexOf('create or replace function public.register_staff_push_device'),
    ),
  );
  const reminder = sql('20260813110000_staff_order_acceptance_reminder');
  await db.exec(
    reminder.slice(
      reminder.indexOf('create table if not exists public.staff_push_reminder_outbox'),
      reminder.indexOf('-- Feed terminal reminder outcomes'),
    ),
  );
  await db.exec(definition(reminder, 'refresh_staff_push_reminder_outbox'));
  await db.exec(
    'create function claim_staff_push_reminder_deliveries(integer) returns void language sql as $$select$$;',
  );
  await db.exec(sql('20260909231000_recurring_cashier_reminders'));
  await db.exec(sql('20260910132000_front_tablet_fallback'));
  await db.exec(`create trigger test_enqueue after insert on staff_push_outbox
    for each row execute function enqueue_staff_push_reminder();`);
});
test.after(() => db.close());
test.beforeEach(() =>
  db.exec(
    'truncate table bulka_locations,kaspi_orders,admin_sessions,admin_user_profiles,admin_staff_credentials cascade;',
  ),
);

async function branch() {
  const id = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [id]);
  return id;
}
async function order(branchId) {
  const id = randomUUID();
  await db.query('insert into kaspi_orders(id,branch_id) values($1,$2)', [id, branchId]);
  await db.query(
    'insert into staff_push_outbox(order_id,branch_id,order_number) values($1,$2,100001)',
    [id, branchId],
  );
  return id;
}
async function device(branchId, platform) {
  const id = randomUUID(),
    hash = id.replaceAll('-', '').repeat(2);
  await db.query(
    `insert into admin_sessions values($1,$2,1,'cashier',array[$3::uuid],null,now()+interval '1 hour')`,
    [hash, id, branchId],
  );
  await db.query("insert into admin_user_profiles values($1,true,'cashier',array[$2::uuid])", [
    id,
    branchId,
  ]);
  await db.query('insert into admin_staff_credentials values($1,1)', [id]);
  await db.query(
    `insert into staff_push_devices(id,admin_subject,branch_id,session_jti_hash,auth_version,platform,installation_id,token)
    values($1::uuid,$1::text,$2,$3,1,$4,$1::text,$1::text)`,
    [id, branchId, hash, platform],
  );
  return id;
}
const poll = async (id) =>
  (await db.query('select poll_front_order_inbox($1,$2) data', [id, randomUUID()])).rows[0].data;
const claim = async () =>
  (await db.query('select * from claim_staff_push_reminder_deliveries(100)')).rows;
const begin = async (row) =>
  (
    await db.query('select begin_staff_push_reminder_dispatch($1,$2) state', [
      row.delivery_id,
      row.lease_token,
    ])
  ).rows[0].state;

test('a live Front gets one minute to act while the first tablet push remains queued', async () => {
  const b = await branch();
  await device(b, 'ios');
  await poll(b);
  const id = await order(b);
  const [row] = (
    await db.query(
      `select extract(epoch from (r.due_at-o.created_at)) seconds,o.status
    from staff_push_reminder_outbox r join staff_push_outbox o on o.id=r.source_outbox_id where r.order_id=$1`,
      [id],
    )
  ).rows;
  assert.equal(Number(row.seconds), 60);
  assert.equal(row.status, 'queued');
  assert.deepEqual(await claim(), []);
  await db.query(
    "update staff_push_reminder_outbox set due_at=now()-interval '1 second',expires_at=now()+interval '14 seconds' where order_id=$1",
    [id],
  );
  assert.equal((await claim()).length, 1);
});
test('no Front heartbeat immediately enables same-branch iOS and Android reminders', async () => {
  const b = await branch(),
    other = await branch();
  const ios = await device(b, 'ios'),
    android = await device(b, 'android');
  await device(other, 'android');
  const id = await order(b);
  const rows = await claim();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.device_id).sort(), [ios, android].sort());
  for (const row of rows) {
    assert.equal(row.order_id, id);
    assert.equal(await begin(row), 'dispatching');
  }
  assert.equal(
    (await db.query('select branch_has_active_staff_ipad($1) online', [b])).rows[0].online,
    true,
  );
});
test('a register disappearing within the minute expedites the existing reminder without duplicating it', async () => {
  const b = await branch();
  await device(b, 'android');
  await poll(b);
  await order(b);
  await db.query(
    "update front_order_inbox_terminals set last_seen_at=now()-interval '46 seconds' where branch_id=$1",
    [b],
  );
  assert.equal((await claim()).length, 1);
  assert.deepEqual(await claim(), []);
  assert.equal(
    (await db.query('select count(*) count from staff_push_reminder_outbox')).rows[0].count,
    1,
  );
});
test('any connected register keeps the grace period; another branch never does', async () => {
  const b = await branch(),
    other = await branch();
  await device(b, 'android');
  await poll(b);
  await db.query("insert into front_order_inbox_terminals values($1,$2,now()-interval '1 day')", [
    b,
    randomUUID(),
  ]);
  await order(b);
  assert.deepEqual(await claim(), []);
  await poll(other);
  await db.query(
    "update front_order_inbox_terminals set last_seen_at=now()-interval '46 seconds' where branch_id=$1",
    [b],
  );
  assert.equal((await claim()).length, 1);
});
test('acceptance on either device and rejection suppress an already claimed reminder before dispatch', async () => {
  const b = await branch();
  await device(b, 'android');
  const accepted = await order(b),
    rejected = await order(b);
  const rows = await claim();
  assert.equal(rows.length, 2);
  await db.query(
    "update kaspi_orders set kitchen_status='preparing',fulfillment_status='preparing' where id=$1",
    [accepted],
  );
  await db.query(
    "update kaspi_orders set fulfillment_status='cancelled',refund_status='processing' where id=$1",
    [rejected],
  );
  for (const row of rows) assert.equal(await begin(row), 'skipped');
  assert.deepEqual(await claim(), []);
});
test('Android reminders revalidate revoked sessions and changed branch access', async () => {
  const b = await branch();
  await device(b, 'android');
  await order(b);
  const [row] = await claim();
  await db.exec('update admin_sessions set revoked_at=now()');
  assert.equal(await begin(row), 'skipped');
  assert.equal(
    (await db.query('select branch_has_active_staff_ipad($1) online', [b])).rows[0].online,
    false,
  );
});
test('background Front polling returns only actionable identifiers from its branch', async () => {
  const b = await branch(),
    other = await branch();
  const id = await order(b);
  const old = await order(b);
  await order(other);
  await db.query("update kaspi_orders set fulfillment_status='preparing' where id=$1", [old]);
  assert.deepEqual(await poll(b), { page: 1, total: 1, orders: [{ id, number: 100001 }] });
  await db.query('update bulka_locations set active=false where id=$1', [b]);
  await assert.rejects(poll(b), /Филиал не активен/);
});
