const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const sql = fs.readFileSync('supabase/migrations/20260909200000_delivery_budget.sql', 'utf8');
const one = async (query, args = []) => (await db.query(query, args)).rows[0];
const rpc = async (name, args = []) =>
  (await one(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).value;
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key);
    create table kaspi_orders(id uuid primary key, customer_id uuid, client_request_id uuid,
      status text default 'pending', fulfillment_status text default 'pending');
    create table delivery_jobs(id uuid primary key,order_id uuid,provider_status text,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table checkout_delivery_probes(id uuid primary key,state text,provider_status text,external_claim_id text,
      created_at timestamptz default now(),updated_at timestamptz default now());`);
  await db.exec(sql);
  await db.exec(sql);
});
test.after(() => db.close());
test.beforeEach(async () => {
  await db.exec(
    'truncate delivery_budget_entries,delivery_budget_reservations,delivery_jobs,checkout_delivery_probes,kaspi_orders,customers;',
  );
  await db.exec(
    "update delivery_budget_account set balance=5000,revision=1,buffer_percent=50,created_at=now()-interval '1 hour';",
  );
});
async function hold(estimate = 1000, customer = randomUUID(), request = randomUUID()) {
  await db.query('insert into customers values($1) on conflict do nothing', [customer]);
  return {
    customer,
    request,
    result: await rpc('reserve_delivery_budget', [customer, request, estimate]),
  };
}
async function order(h, status = 'paid') {
  const id = randomUUID();
  await db.query(
    'insert into kaspi_orders(id,customer_id,client_request_id,status) values($1,$2,$3,$4)',
    [id, h.customer, h.request, status],
  );
  return id;
}
async function job(orderId, status) {
  const id = randomUUID();
  await db.query('insert into delivery_jobs(id,order_id,provider_status) values($1,$2,$3)', [
    id,
    orderId,
    status,
  ]);
  return id;
}

test('5000 opening balance, 1000 estimate reserves 1500 and leaves 3500', async () => {
  const h = await hold();
  assert.equal(h.result.status, 'reserved');
  const state = await rpc('delivery_budget_snapshot');
  assert.equal(state.balance, 5000);
  assert.equal(state.reserved, 1500);
  assert.equal(state.available, 3500);
  assert.equal((await hold(1000, h.customer, h.request)).result.id, h.result.id);
  assert.equal((await rpc('delivery_budget_snapshot')).reserved, 1500);
});

test('simultaneous admission and duplicate retries never spend the same budget twice', async () => {
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => hold()));
  assert.equal(outcomes.filter((h) => h.result.status === 'reserved').length, 3);
  assert.equal((await rpc('delivery_budget_snapshot')).available, 500);
  const rejected = outcomes.find((h) => h.result.status === 'unavailable');
  assert.equal(
    (await hold(1000, rejected.customer, rejected.request)).result.status,
    'unavailable',
  );
});

test('unstarted checkout expires, but an unknown bank payment keeps its hold', async () => {
  const a = await hold();
  const b = await hold();
  await rpc('mark_delivery_budget_payment', [b.result.id]);
  await db.exec("update delivery_budget_reservations set expires_at=now()-interval '1 minute';");
  const state = await rpc('delivery_budget_snapshot');
  assert.equal(state.reserved, 1500);
  assert.equal(state.attentionCount, 1);
  assert.equal(await rpc('mark_delivery_budget_payment', [a.result.id]), false);
  await rpc('release_unstarted_delivery_budget', [b.customer, b.request]);
  assert.equal((await rpc('delivery_budget_snapshot')).reserved, 1500);
});

test('failed payment and a cancelled order without a courier release reservations', async () => {
  const a = await hold();
  const first = await order(a, 'pending');
  await db.query("update kaspi_orders set status='failed' where id=$1", [first]);
  assert.equal((await rpc('delivery_budget_snapshot')).reserved, 0);
  const b = await hold();
  const second = await order(b);
  await db.query("update kaspi_orders set fulfillment_status='cancelled' where id=$1", [second]);
  assert.equal((await rpc('delivery_budget_snapshot')).available, 5000);
});

test('actual dispatch uses the 500 buffer and settlement deducts the actual bill once', async () => {
  const h = await hold();
  const id = await order(h);
  const jid = await job(id, 'accepted');
  const dispatch = await rpc('reserve_delivery_budget', [h.customer, h.request, 1500, id, true]);
  assert.equal(dispatch.amount, 1500);
  await db.query("update kaspi_orders set fulfillment_status='completed' where id=$1", [id]);
  assert.equal((await rpc('delivery_budget_snapshot')).reserved, 1500);
  await db.query("update delivery_jobs set provider_status='delivered' where id=$1", [jid]);
  // Terminal status without a final bill must not free the money.
  assert.equal((await rpc('delivery_budget_snapshot')).reserved, 1500);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 1500, id]);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 1500, id]);
  const state = await rpc('delivery_budget_snapshot');
  assert.equal(state.balance, 3500);
  assert.equal(state.reserved, 0);
  assert.equal(state.available, 3500);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 1400, id]);
  assert.equal((await rpc('delivery_budget_snapshot')).balance, 3600);
});

test('active or unbilled courier prevents a premature release during order cancellation', async () => {
  const h = await hold();
  const id = await order(h);
  const jid = await job(id, 'accepted');
  await db.query(
    "update kaspi_orders set fulfillment_status='cancelled',status='refunded' where id=$1",
    [id],
  );
  assert.equal((await rpc('delivery_budget_snapshot')).reserved, 1500);
  await db.query("update delivery_jobs set provider_status='cancelled_with_payment' where id=$1", [
    jid,
  ]);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 200, id]);
  const state = await rpc('delivery_budget_snapshot');
  assert.equal(state.balance, 4800);
  assert.equal(state.reserved, 0);
});

test('paid cancellation on an ongoing order keeps a budget for the replacement courier', async () => {
  const h = await hold();
  const id = await order(h);
  const jid = await job(id, 'cancelled_with_payment');
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 200, id]);
  assert.equal((await rpc('delivery_budget_snapshot')).available, 3300);
  const next = await rpc('reserve_delivery_budget', [h.customer, h.request, 1100, id, true]);
  assert.equal(next.amount, 1500);
});

test('a released paid-order budget must be reacquired and can be declined before fulfilment', async () => {
  const h = await hold();
  const id = await order(h, 'expired');
  await Promise.all([hold(), hold(), hold()]);
  await db.query("update kaspi_orders set status='paid' where id=$1", [id]);
  const reacquire = await rpc('reserve_delivery_budget', [h.customer, h.request, 1000, id, false]);
  assert.equal(reacquire.status, 'unavailable');
});

test('top-up is idempotent; reconciliation preserves holds and rejects a stale balance', async () => {
  await hold();
  const before = await rpc('delivery_budget_snapshot');
  const key = randomUUID();
  const after = await rpc('adjust_delivery_budget', [
    key,
    before.revision,
    2000,
    'top_up',
    'owner',
  ]);
  assert.equal(after.balance, 7000);
  assert.equal(after.available, 5500);
  assert.equal(
    (await rpc('adjust_delivery_budget', [key, before.revision, 2000, 'top_up', 'owner'])).balance,
    7000,
  );
  assert.equal(
    (await rpc('adjust_delivery_budget', [randomUUID(), before.revision, 5000, 'balance', 'owner']))
      .status,
    'stale',
  );
  const corrected = await rpc('adjust_delivery_budget', [
    randomUUID(),
    after.revision,
    4000,
    'balance',
    'owner',
  ]);
  assert.equal(corrected.reserved, 1500);
  assert.equal(corrected.available, 2500);
  await db.exec(sql);
  assert.equal((await rpc('delivery_budget_snapshot')).balance, 4000);
});

test('historical deliveries cannot debit the newly confirmed opening balance', async () => {
  const h = await hold();
  const id = await order(h);
  const jid = await job(id, 'delivered');
  await db.query("update delivery_jobs set created_at=now()-interval '2 hours' where id=$1", [jid]);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 1200, id]);
  assert.equal((await rpc('delivery_budget_snapshot')).balance, 5000);
});

test('unsettled courier costs block rebasing but allow a confirmed top-up', async () => {
  const h = await hold();
  const id = await order(h);
  const jid = await job(id, 'accepted');
  const state = await rpc('delivery_budget_snapshot');
  assert.equal(
    (await rpc('adjust_delivery_budget', [randomUUID(), state.revision, 5000, 'balance', 'owner']))
      .status,
    'unsettled',
  );
  const toppedUp = await rpc('adjust_delivery_budget', [
    randomUUID(),
    state.revision,
    1000,
    'top_up',
    'owner',
  ]);
  assert.equal(toppedUp.balance, 6000);
  assert.equal(toppedUp.reserved, 1500);
  await db.query("update delivery_jobs set provider_status='cancelled_with_payment' where id=$1", [
    jid,
  ]);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 200, id]);
  const settled = await rpc('delivery_budget_snapshot');
  const corrected = await rpc('adjust_delivery_budget', [
    randomUUID(),
    settled.revision,
    5800,
    'balance',
    'owner',
  ]);
  assert.equal(corrected.balance, 5800);
  assert.equal(corrected.reserved, 1500);
});

test('cost worker selects only pending terminal jobs and clears a duplicate bill retry', async () => {
  const h = await hold();
  const id = await order(h);
  await job(id, 'accepted');
  const jid = await job(id, 'delivered');
  const pending = await rpc('pending_delivery_budget_costs');
  assert.deepEqual(
    pending.jobs.map((j) => j.id),
    [jid],
  );
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 1200, id]);
  assert.equal((await rpc('pending_delivery_budget_costs')).jobs.length, 0);
  await db.query('update delivery_jobs set updated_at=now() where id=$1', [jid]);
  assert.equal((await rpc('pending_delivery_budget_costs')).jobs.length, 1);
  await rpc('record_delivery_budget_cost', [`job:${jid}`, 1200, id]);
  assert.equal((await rpc('pending_delivery_budget_costs')).jobs.length, 0);
  assert.equal((await rpc('delivery_budget_snapshot')).balance, 3800);
});

test('an unbilled physical probe prevents rebasing until its cancellation cost is recorded', async () => {
  const probe = randomUUID();
  await db.query(
    "insert into checkout_delivery_probes(id,state,provider_status,external_claim_id) values($1,'rejected','cancelled_with_payment','claim-1')",
    [probe],
  );
  const state = await rpc('delivery_budget_snapshot');
  assert.equal(
    (await rpc('adjust_delivery_budget', [randomUUID(), state.revision, 4800, 'balance', 'owner']))
      .status,
    'unsettled',
  );
  assert.equal((await rpc('pending_delivery_budget_costs')).probes.length, 1);
  await rpc('record_delivery_budget_cost', [`probe:${probe}`, 200]);
  const settled = await rpc('delivery_budget_snapshot');
  assert.equal(settled.balance, 4800);
  assert.equal((await rpc('pending_delivery_budget_costs')).probes.length, 0);
  assert.equal(
    (
      await rpc('adjust_delivery_budget', [
        randomUUID(),
        settled.revision,
        4800,
        'balance',
        'owner',
      ])
    ).balance,
    4800,
  );
});

test('customer roles cannot read or modify the courier budget', async () => {
  const privileges =
    await one(`select has_table_privilege('authenticated','delivery_budget_account','update') as writable,
    has_function_privilege('anon','reserve_delivery_budget(uuid,uuid,numeric,uuid,boolean)','execute') as callable`);
  assert.equal(privileges.writable, false);
  assert.equal(privileges.callable, false);
});
