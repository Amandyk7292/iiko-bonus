const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { slotBucket } = require('../src/services/schedule-windows');
const db = new PGlite();
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key, active boolean default true,
      slot_minutes integer default 60, pickup_slot_capacity integer default 2,
      delivery_slot_capacity integer default 2, preorder_slot_capacity integer default 2);
    create table fulfillment_slot_reservations(id uuid primary key default gen_random_uuid(),
      customer_id uuid, client_request_id uuid unique, branch_id uuid references bulka_locations,
      fulfillment_type text, scheduled_at timestamptz, status text, expires_at timestamptz,
      updated_at timestamptz default now());`);
  await db.exec(
    readFileSync('supabase/migrations/20260910233000_fulfillment_partial_windows.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function setup() {
  const branch = randomUUID(),
    customer = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  return { branch, customer };
}
const reserve = (ctx, time, request = randomUUID(), type = 'pickup') =>
  db.query('select reserve_fulfillment_slot($1,$2,$3,$4,$5) result', [
    ctx.customer,
    request,
    ctx.branch,
    type,
    time,
  ]);

test('different minutes share capacity, retries are idempotent and neighboring intervals stay independent', async () => {
  const ctx = await setup(),
    first = randomUUID();
  assert.equal((await reserve(ctx, '2099-01-01T18:00:00Z', first)).rows[0].result.remaining, 1);
  assert.equal((await reserve(ctx, '2099-01-01T18:00:00Z', first)).rows[0].result.remaining, 1);
  assert.equal((await reserve(ctx, '2099-01-01T18:20:00Z')).rows[0].result.remaining, 0);
  await assert.rejects(reserve(ctx, '2099-01-01T18:25:00Z'), /время уже занято/);
  await reserve(ctx, '2099-01-01T19:00:00Z');
  await reserve(ctx, '2099-01-01T18:25:00Z', randomUUID(), 'delivery');
});

test('expired payment recovery cannot bypass the shared capacity guard', async () => {
  const ctx = await setup(),
    expired = randomUUID();
  await reserve(ctx, '2099-01-01T18:00:00Z', expired);
  await db.query(
    "update fulfillment_slot_reservations set status='expired',expires_at=now()-interval '1 hour' where client_request_id=$1",
    [expired],
  );
  await reserve(ctx, '2099-01-01T18:20:00Z');
  await reserve(ctx, '2099-01-01T18:25:00Z');
  await assert.rejects(
    db.query(
      "update fulfillment_slot_reservations set status='committed' where client_request_id=$1",
      [expired],
    ),
    /время уже занято/,
  );
});

test('live payment commitment remains valid when the admin reduces capacity', async () => {
  const ctx = await setup();
  await reserve(ctx, '2099-01-01T18:00:00Z');
  await reserve(ctx, '2099-01-01T18:20:00Z');
  await db.query('update bulka_locations set pickup_slot_capacity=1 where id=$1', [ctx.branch]);
  await db.query("update fulfillment_slot_reservations set status='committed' where branch_id=$1", [
    ctx.branch,
  ]);
  await assert.rejects(reserve(ctx, '2099-01-01T18:25:00Z'), /время уже занято/);
});

test('database and API use the same local-day capacity boundaries', async () => {
  for (const interval of [15, 30, 60, 200, 240])
    for (const offset of [300, 330, -180]) {
      const at = '2099-01-01T18:25:00Z';
      const { rows } = await db.query('select lower(fulfillment_slot_bounds($1,$2,$3)) at', [
        at,
        interval,
        offset,
      ]);
      assert.equal(Date.parse(rows[0].at), slotBucket(Date.parse(at), interval, offset));
    }
  const { rows } = await db.query(
    "select has_function_privilege('anon','public.fulfillment_slot_bounds(timestamptz,integer,integer)','execute') allowed",
  );
  assert.equal(rows[0].allowed, false);
});
