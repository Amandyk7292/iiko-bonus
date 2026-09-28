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
  await db.exec(
    `alter table kaspi_orders add column fulfillment_type text default 'delivery', add column preorder_fulfillment_type text, add column scheduled_at timestamptz, add column pickup_time timestamptz, add column preparation_minutes integer, add column courier_id uuid, add column courier_assigned_at timestamptz, add column courier_dispatch_status text, add column courier_dispatch_attempted_at timestamptz, add column delivery_status text default 'unassigned'; create table delivery_jobs(id uuid primary key default gen_random_uuid(),order_id uuid,provider_status text,internal_status text,courier_name text,courier_phone text);`,
  );
  await db.exec(sql('20260928160000_order_waiting_policy'));
  await db.exec(`create trigger test_enqueue after insert on staff_push_outbox
    for each row execute function enqueue_staff_push_reminder();`);
});
test.after(() => db.close());

async function order(minutes, status = 'new') {
  const b = randomUUID(),
    id = randomUUID();
  await db.query('insert into bulka_locations values($1,true)', [b]);
  await db.query(
    'insert into kaspi_orders(id,branch_id,fulfillment_status,staff_acceptance_requested_at) values($1,$2,$3,now()-make_interval(mins=>$4))',
    [id, b, status, minutes],
  );
  return id;
}
test('immediate orders start on request; future preorders start at their preparation window', async () => {
  const id = await order(2);
  await db.query(
    "update kaspi_orders set fulfillment_type='preorder',scheduled_at=now()+interval '2 hours',preparation_minutes=30 where id=$1",
    [id],
  );
  const r = (
    await db.query(
      "select acceptance_watch_started_at>now()+interval '89 minutes' future from kaspi_orders where id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(r.future, true);
  assert.equal((await db.query('select * from claim_order_waiting_notices()')).rows.length, 0);
});
test('3 and 5 minute notices are single-use and exclude accepted orders', async () => {
  const early = await order(2),
    three = await order(3),
    five = await order(5),
    accepted = await order(6, 'accepted');
  const rows = (await db.query('select * from claim_order_waiting_notices()')).rows;
  assert.deepEqual(
    rows.filter((r) => r.order_id === three).map((r) => r.stage),
    [3],
  );
  assert.deepEqual(
    rows.filter((r) => r.order_id === five).map((r) => r.stage),
    [3, 5],
  );
  assert.equal(
    rows.some((r) => [early, accepted].includes(r.order_id)),
    false,
  );
  assert.equal((await db.query('select * from claim_order_waiting_notices()')).rows.length, 0);
});
test('courier timeout claims only after 20 minutes; blocks competing assignment and job creation', async () => {
  const id = await order(25, 'accepted');
  await db.query(
    "update kaspi_orders set courier_dispatch_status='processing',courier_dispatch_attempted_at=now()-interval '19 minutes' where id=$1",
    [id],
  );
  const claim = () =>
    db.query("select * from claim_courier_timeout($1,now()-interval '20 minutes')", [id]);
  assert.equal((await claim()).rows.length, 0);
  await db.query(
    "update kaspi_orders set courier_search_started_at=now()-interval '21 minutes' where id=$1",
    [id],
  );
  assert.equal((await claim()).rows.length, 1);
  assert.equal((await claim()).rows.length, 0);
  await assert.rejects(
    db.query('update kaspi_orders set courier_id=$2 where id=$1', [id, randomUUID()]),
    /CANCELLATION_IN_PROGRESS/,
  );
  await assert.rejects(
    db.query('insert into delivery_jobs(order_id) values($1)', [id]),
    /CANCELLATION_IN_PROGRESS/,
  );
});
test('assignment winning the race and pickup orders cannot be claimed', async () => {
  for (const pickup of [false, true]) {
    const id = await order(25, 'accepted');
    await db.query(
      "update kaspi_orders set courier_search_started_at=now()-interval '25 minutes',fulfillment_type=$2,courier_assigned_at=$3 where id=$1",
      [id, pickup ? 'pickup' : 'delivery', pickup ? null : new Date().toISOString()],
    );
    assert.equal(
      (await db.query("select * from claim_courier_timeout($1,now()-interval '20 minutes')", [id]))
        .rows.length,
      0,
    );
  }
});
test('staff reminder is scheduled at three minutes, expires at ten, and is not rearmed', async () => {
  const id = await order(0);
  await db.query(
    'insert into staff_push_outbox(order_id,branch_id,order_number) select id,branch_id,order_number from kaspi_orders where id=$1',
    [id],
  );
  const r = (
    await db.query(
      'select extract(epoch from (r.due_at-o.acceptance_watch_started_at)) delay,extract(epoch from(r.expires_at-o.acceptance_watch_started_at)) expiry from staff_push_reminder_outbox r join kaspi_orders o on o.id=r.order_id where o.id=$1',
      [id],
    )
  ).rows[0];
  assert.equal(Number(r.delay), 180);
  assert.equal(Number(r.expiry), 600);
  await db.query(
    "update staff_push_reminder_outbox set status='sent',updated_at=now()-interval '10 minutes' where order_id=$1",
    [id],
  );
  await db.exec('select rearm_staff_push_reminders()');
  assert.equal(
    (await db.query('select status from staff_push_reminder_outbox where order_id=$1', [id]))
      .rows[0].status,
    'sent',
  );
});
