const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const hash = 'a'.repeat(64);
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key);`);
  const sql = fs.readFileSync(
    'supabase/migrations/20260909190000_checkout_delivery_probes.sql',
    'utf8',
  );
  await db.exec(sql);
  await db.exec(sql);
});
test.beforeEach(() => db.exec('truncate checkout_delivery_probes, customers;'));
test.after(() => db.close());
async function customer() {
  const id = crypto.randomUUID();
  await db.query('insert into customers(id) values ($1)', [id]);
  return id;
}
async function acquire(id, route = hash, after = null) {
  return (
    await one('select acquire_checkout_delivery_probe($1,$2,$3,$4,$5) as data', [
      id,
      route,
      '{}',
      crypto.randomUUID(),
      after,
    ])
  ).data;
}
async function complete(id) {
  await db.query(
    `update checkout_delivery_probes set state='complete',
    accepted_at=now(),cancelled_at=now(),checked_at=now(),provider_status='cancelled',request_payload=null
    where id=$1`,
    [id],
  );
}

test('duplicate requests and changed routes cannot create concurrent claims for one customer', async () => {
  const id = await customer();
  const first = await acquire(id);
  assert.equal(first.kind, 'created');
  assert.equal((await acquire(id)).kind, 'busy');
  assert.equal((await acquire(id, 'b'.repeat(64))).kind, 'busy');
  assert.equal((await one('select count(*)::int as total from checkout_delivery_probes')).total, 1);
});

test('only confirmed acceptance and free cancellation can be cached, including after restart', async () => {
  const id = await customer();
  const first = await acquire(id);
  await assert.rejects(
    db.query("update checkout_delivery_probes set state='complete' where id=$1", [first.probe.id]),
    /checkout_delivery_probe_complete/,
  );
  await complete(first.probe.id);
  assert.equal((await acquire(id)).kind, 'cached');
  assert.notEqual(
    (await acquire(id, hash, new Date(Date.now() + 1000).toISOString())).kind,
    'cached',
  );
  await db.query(
    "update checkout_delivery_probes set created_at=now()-interval '3 minutes', checked_at=now()-interval '3 minutes'",
  );
  assert.equal((await acquire(id)).kind, 'created');
});

test('overdue acceptance prevents another physical probe; cleanup ownership is exclusive', async () => {
  const first = await acquire(await customer());
  await db.query(
    `update checkout_delivery_probes set state='cancelling',
    accept_attempted_at=now()-interval '6 seconds',lease_until=now()-interval '1 second' where id=$1`,
    [first.probe.id],
  );
  assert.equal((await acquire(await customer())).kind, 'busy');
  const lease = crypto.randomUUID();
  const result = await one('select lease_checkout_delivery_probe($1) as data', [lease]);
  assert.equal(result.data.id, first.probe.id);
  assert.equal(result.data.lease_token, lease);
  assert.equal(
    (await one('select lease_checkout_delivery_probe($1) as data', [crypto.randomUUID()])).data,
    null,
  );
});

test('admission bounds physical concurrency and repeated route switching', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await acquire(await customer())).kind, 'created');
  assert.equal((await acquire(await customer())).kind, 'busy');
  await db.exec(
    "update checkout_delivery_probes set state='rejected',checked_at=now(),request_payload=null",
  );
  const previous = await one('select customer_id from checkout_delivery_probes limit 1');
  assert.equal((await acquire(previous.customer_id)).kind, 'busy');
});

test('customer-facing database roles cannot read addresses or invoke probes', async () => {
  const result =
    await one(`select has_table_privilege('authenticated','checkout_delivery_probes','select') as readable,
    has_function_privilege('authenticated','acquire_checkout_delivery_probe(uuid,text,jsonb,uuid,timestamptz)','execute') as callable`);
  assert.equal(result.readable, false);
  assert.equal(result.callable, false);
});
