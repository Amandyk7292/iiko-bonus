const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { listAvailableSlots } = require('../src/services/slot.service');
const { database } = require('./helpers/photo-report-database.cjs');
const pg = new PGlite();
test.before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table bulka_locations(id uuid primary key,active boolean default true,slot_minutes integer default 60,
      pickup_enabled boolean default true,delivery_enabled boolean default true,preorder_enabled boolean default true,
      round_the_clock boolean default false,hours jsonb default '{"daily":{"open":"22:00","close":"02:30"}}',
      pickup_slot_capacity integer default 2,delivery_slot_capacity integer default 2,preorder_slot_capacity integer default 2);
    create table fulfillment_slot_reservations(id uuid primary key default gen_random_uuid(),customer_id uuid,
      client_request_id uuid unique,branch_id uuid,fulfillment_type varchar,scheduled_at timestamptz,status text,
      expires_at timestamptz,updated_at timestamptz,order_id uuid);`);
  await pg.exec(
    readFileSync('supabase/migrations/20260910233000_fulfillment_partial_windows.sql', 'utf8'),
  );
  await pg.exec(
    readFileSync('supabase/migrations/20261004112000_fulfillment_slot_usage.sql', 'utf8'),
  );
  const resolutionSql = readFileSync(
    'supabase/migrations/20261003160000_delivery_resolution.sql',
    'utf8',
  );
  const start = resolutionSql.indexOf(
    'create or replace function public.delivery_resolution_valid_pickup(',
  );
  await pg.exec(resolutionSql.slice(start, resolutionSql.indexOf('$$;', start) + 3));
});
test.after(() => pg.close());
async function usage(branch, minutes, exclude = null) {
  return (
    await pg.query(
      "select fulfillment_slot_usage($1,'pickup','2026-10-03T00:00:00+05:00','2026-10-19T00:00:00+05:00',$2,300,now(),$3) result",
      [branch, minutes, exclude],
    )
  ).rows[0].result;
}
async function branch(minutes = 60) {
  const id = randomUUID();
  await pg.query('insert into bulka_locations(id,slot_minutes) values($1,$2)', [id, minutes]);
  return id;
}
async function add(id, at, { status = 'committed', expires = null, request = randomUUID() } = {}) {
  await pg.query(
    "insert into fulfillment_slot_reservations(client_request_id,branch_id,fulfillment_type,scheduled_at,status,expires_at) values($1,$2,'pickup',$3,$4,$5)",
    [request, id, at, status, expires],
  );
  return request;
}

test('slot usage is a scalar aggregate over more than 1000 distinct reservations', async () => {
  const id = await branch(15);
  await pg.query(
    "insert into fulfillment_slot_reservations(client_request_id,branch_id,fulfillment_type,scheduled_at,status) select gen_random_uuid(),$1,'pickup','2026-10-03T00:00:00+05:00'::timestamptz+n*interval '15 minutes','committed' from generate_series(0,1000) n",
    [id],
  );
  const result = await usage(id, 15);
  assert.equal(result.length, 1001);
  assert.equal(
    result.reduce((total, row) => total + row.used, 0),
    1001,
  );
  assert.equal(
    (
      await pg.query(
        "select pg_get_function_result('fulfillment_slot_usage(uuid,text,timestamptz,timestamptz,integer,integer,timestamptz,uuid)'::regprocedure) type",
      )
    ).rows[0].type,
    'jsonb',
  );
});

test('current bucket combines old grid starts and matches the SQL reservation capacity fence', async () => {
  const id = await branch(30);
  await add(id, '2026-10-03T12:00:00+05:00');
  await add(id, '2026-10-03T12:30:00+05:00');
  await pg.query('update bulka_locations set slot_minutes=60 where id=$1', [id]);
  const result = await usage(id, 60);
  assert.equal(result.length, 1);
  assert.equal(result[0].used, 2);
  await assert.rejects(add(id, '2026-10-03T12:00:00+05:00'), /время уже занято/);
});

test('expiration, request exclusion and midnight isolate usage exactly as reservation buckets do', async () => {
  const id = await branch(70);
  await add(id, '2026-10-03T23:20:00+05:00');
  const own = await add(id, '2026-10-04T00:00:00+05:00');
  await add(id, '2026-10-04T00:00:00+05:00', { status: 'active', expires: '2020-01-01T00:00:00Z' });
  const result = await usage(id, 70);
  assert.deepEqual(
    result.map((row) => row.used),
    [1, 1],
  );
  assert.equal((await usage(id, 70, own)).length, 1);
  await add(id, '2026-10-04T00:00:00+05:00');
  await assert.rejects(add(id, '2026-10-04T00:00:00+05:00'), /время уже занято/);
  assert.deepEqual(
    (await usage(id, 70)).map((row) => row.used),
    [1, 2],
  );
});

test('SQL buckets for all intervals 15..240 end by midnight and exclude the adjacent day', async () => {
  const result = await pg.query(`with samples as (
    select step, '2026-10-03T00:00:00+05:00'::timestamptz+minute*interval '1 minute' as scheduled
    from generate_series(15,240) step cross join lateral generate_series(0,1439,step) minute
  ), bounds as (select step,scheduled,fulfillment_slot_bounds(scheduled,step,300) slot from samples)
  select count(*) samples,count(*) filter(where lower(slot)<>scheduled or upper(slot)>'2026-10-04T00:00:00+05:00'::timestamptz
    or '2026-10-04T00:00:00+05:00'::timestamptz <@ slot) invalid,count(distinct step) intervals from bounds`);
  assert.equal(Number(result.rows[0].intervals), 226);
  assert.ok(Number(result.rows[0].samples) > 3000);
  assert.equal(Number(result.rows[0].invalid), 0);
});

test('all supported overnight slot grids are accepted by the real replacement SQL validator', async () => {
  const id = await branch();
  const now = (await pg.query('select now() current_time')).rows[0].current_time;
  let checked = 0;
  for (let minutes = 15; minutes <= 240; minutes++) {
    await pg.query('update bulka_locations set slot_minutes=$1 where id=$2', [minutes, id]);
    const { slots } = await listAvailableSlots({
      branchId: id,
      orderType: 'pickup',
      horizonHours: 24,
      now,
      db: database(pg),
    });
    assert.ok(slots.length > 0, `${minutes} min`);
    const validation = await pg.query(
      'select bool_and(delivery_resolution_valid_pickup($1,at,300)) allowed from unnest($2::timestamptz[]) at',
      [id, slots.map((slot) => slot.startsAt)],
    );
    assert.equal(validation.rows[0].allowed, true, `${minutes} min grid rejected by SQL`);
    checked++;
  }
  assert.equal(checked, 226);
});

test('public and authenticated roles cannot read aggregate reservations or execute usage', async () => {
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      (
        await pg.query(
          "select has_function_privilege($1,'fulfillment_slot_usage(uuid,text,timestamptz,timestamptz,integer,integer,timestamptz,uuid)','EXECUTE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
});
