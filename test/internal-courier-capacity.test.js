const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const Module = require('node:module');

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table couriers(id uuid primary key,name text,phone text,vehicle text,transport_type text default 'car',
      active boolean default true,availability_status text default 'available',max_active_orders int default 1,
      current_latitude numeric,current_longitude numeric,location_updated_at timestamptz,last_assigned_at timestamptz);
    create table kaspi_orders(id uuid primary key,branch_id uuid,status text default 'paid',fulfillment_type text default 'delivery',
      fulfillment_status text default 'preparing',kitchen_status text default 'preparing',courier_id uuid,
      delivery_status text default 'unassigned',courier_dispatch_status text,courier_dispatch_provider text,
      courier_dispatch_requested_at timestamptz,delivery_pin text,delivery_confirmed_at timestamptz,
      courier_assigned_at timestamptz,estimated_delivery_at timestamptz,updated_at timestamptz,refund_status text);
    create table delivery_jobs(id uuid primary key,order_id uuid,provider text,api_family text,
      provider_status text,internal_status text,projection_guarded boolean,created_at timestamptz default now());`);
  const guard = readFileSync(
    'supabase/migrations/20260813100000_yandex_business_api.sql',
    'utf8',
  ).match(
    /create or replace function public\.guard_internal_courier_provider_reservation\([\s\S]*?\$\$;/i,
  )[0];
  await db.exec(guard);
  await db.exec(
    'create trigger provider_guard before update on kaspi_orders for each row execute function guard_internal_courier_provider_reservation()',
  );
  await db.exec(
    readFileSync('supabase/migrations/20261008151000_internal_courier_capacity.sql', 'utf8'),
  );
  const courier = randomUUID(),
    branch = randomUUID(),
    secondBranch = randomUUID();
  await db.query("insert into couriers(id,name,phone) values($1,'Driver','77770000000')", [
    courier,
  ]);
  async function order(ownerBranch = branch) {
    const id = randomUUID();
    await db.query('insert into kaspi_orders(id,branch_id) values($1,$2)', [id, ownerBranch]);
    return id;
  }
  const assign = async (id, scope = null) =>
    (
      await db.query("select assign_internal_courier($1,$2,null,'1234',$3::uuid[]) result", [
        id,
        courier,
        scope,
      ])
    ).rows[0].result;
  return { db, courier, branch, secondBranch, order, assign };
}

test('parallel assignment callers cannot exceed courier capacity across branches', async (t) => {
  const f = await fixture(t),
    first = await f.order(),
    second = await f.order(f.secondBranch);
  const results = await Promise.allSettled([
    f.assign(first, [f.branch]),
    f.assign(second, [f.secondBranch]),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(
    results.find((r) => r.status === 'rejected').reason.message,
    /COURIER_CAPACITY_REACHED/,
  );
  const assigned = results.find((r) => r.status === 'fulfilled').value;
  assert.equal(assigned.courier_id, f.courier);
  assert.equal(assigned.couriers.id, f.courier);
  assert.equal(
    Number(
      (await f.db.query('select count(*) from kaspi_orders where courier_id=$1', [f.courier]))
        .rows[0].count,
    ),
    1,
  );
  assert.ok((await f.db.query('select last_assigned_at from couriers')).rows[0].last_assigned_at);
  // PGlite serializes local queries; the production function's courier row lock
  // serializes independent PostgreSQL transactions before this same workload check.
});

test('delivered work releases capacity, retry does not replace the assigned PIN', async (t) => {
  const f = await fixture(t),
    first = await f.order(),
    second = await f.order();
  assert.ok(await f.assign(first));
  assert.equal(await f.assign(first), null);
  assert.equal(
    (await f.db.query('select delivery_pin from kaspi_orders where id=$1', [first])).rows[0]
      .delivery_pin,
    '1234',
  );
  await f.db.query(
    "update kaspi_orders set delivery_status='delivered',fulfillment_status='completed' where id=$1",
    [first],
  );
  assert.ok(await f.assign(second));
});

test('transaction rechecks branch scope, kitchen acceptance, receipt and closing states', async (t) => {
  const f = await fixture(t),
    id = await f.order();
  assert.equal(await f.assign(id, [f.secondBranch]), null);
  for (const [column, value] of [
    ['kitchen_status', 'queued'],
    ['courier_dispatch_status', 'awaiting_receipt'],
    ['fulfillment_status', 'cancelled'],
    ['status', 'pending'],
  ]) {
    await f.db.query(`update kaspi_orders set ${column}=$2 where id=$1`, [id, value]);
    assert.equal(await f.assign(id), null);
    await f.db.query(
      "update kaspi_orders set status='paid',fulfillment_status='preparing',kitchen_status='preparing',courier_dispatch_status=null where id=$1",
      [id],
    );
  }
  assert.equal(
    (await f.db.query('select courier_id from kaspi_orders where id=$1', [id])).rows[0].courier_id,
    null,
  );
});

test('dispatcher availability and vehicle are rechecked inside assignment transaction', async (t) => {
  const f = await fixture(t),
    id = await f.order();
  for (const status of ['busy', 'break', 'offline']) {
    await f.db.query('update couriers set availability_status=$1', [status]);
    await assert.rejects(f.assign(id), /COURIER_UNAVAILABLE/);
  }
  await f.db.exec("update couriers set availability_status='available',transport_type='bicycle'");
  await assert.rejects(f.assign(id), /COURIER_UNAVAILABLE/);
  await f.db.exec("update couriers set transport_type='car',active=false");
  await assert.rejects(f.assign(id), /COURIER_UNAVAILABLE/);
});

test('existing active-provider guard blocks atomic assignment and RPC remains server-only', async (t) => {
  const f = await fixture(t),
    id = await f.order();
  await f.db.query(
    "insert into delivery_jobs(id,order_id,provider,api_family,provider_status,internal_status,projection_guarded) values($1,$2,'yandex','cargo_v2','new','unassigned',false)",
    [randomUUID(), id],
  );
  await assert.rejects(f.assign(id), /DELIVERY_PROVIDER_RESERVATION_CONFLICT/);
  assert.equal(
    (await f.db.query('select courier_id from kaspi_orders where id=$1', [id])).rows[0].courier_id,
    null,
  );
  for (const [role, expected] of [
    ['anon', false],
    ['authenticated', false],
    ['service_role', true],
  ]) {
    assert.equal(
      (
        await f.db.query(
          "select has_function_privilege($1,'assign_internal_courier(uuid,uuid,timestamptz,text,uuid[])','execute') allowed",
          [role],
        )
      ).rows[0].allowed,
      expected,
    );
  }
});

test('manual courier service uses the atomic SQL path and returns a capacity conflict', async (t) => {
  const f = await fixture(t),
    first = await f.order(),
    second = await f.order();
  const adapter = {
    from(table) {
      let id;
      const q = {
        select() {
          return q;
        },
        eq(column, value) {
          if (column === 'id') id = value;
          return q;
        },
        async maybeSingle() {
          assert.ok(['couriers', 'kaspi_orders'].includes(table));
          return {
            data: (await f.db.query(`select * from ${table} where id=$1`, [id])).rows[0],
            error: null,
          };
        },
      };
      return q;
    },
    async rpc(name, args) {
      assert.equal(name, 'assign_internal_courier');
      try {
        return {
          data: (
            await f.db.query('select assign_internal_courier($1,$2,$3,$4,$5) result', [
              args.p_order,
              args.p_courier,
              args.p_eta,
              args.p_pin,
              args.p_branch_ids,
            ])
          ).rows[0].result,
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  const filename = require.resolve('../src/services/courier.service'),
    previous = require.cache[filename],
    original = Module._load;
  delete require.cache[filename];
  Module._load = function (request, parent, main) {
    if (parent?.filename === filename) {
      if (request === '../config/supabase') return { supabase: adapter };
      if (request === '../utils/background-task.util') return { runBackgroundTask() {} };
      if (
        [
          './otpStore.service',
          './push.service',
          './live-activity.service',
          './realtime.service',
          './eta.service',
        ].includes(request)
      )
        return {};
    }
    return original.call(this, request, parent, main);
  };
  let courierService;
  try {
    courierService = require(filename);
  } finally {
    Module._load = original;
  }
  t.after(() => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  });
  const assigned = await courierService.assignCourier(first, f.courier, null, {
    branchIds: [f.branch],
  });
  assert.equal(assigned.courier_id, f.courier);
  assert.match(assigned.delivery_pin, /^\d{4}$/);
  await assert.rejects(
    courierService.assignCourier(second, f.courier),
    (error) => error.statusCode === 409 && error.code === 'COURIER_CAPACITY_REACHED',
  );
  assert.equal(
    (await f.db.query('select courier_id from kaspi_orders where id=$1', [second])).rows[0]
      .courier_id,
    null,
  );
});
