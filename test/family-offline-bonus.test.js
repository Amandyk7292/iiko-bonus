const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const uuid = () => crypto.randomUUID();

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,name text,phone text,balance numeric default 0,
      total_spent numeric default 0,created_at timestamptz default now(),deleted_at timestamptz);`);
  for (const migration of [
    '20261002170000_customer_family.sql',
    '20261002172500_family_offline_bonus.sql',
  ]) {
    await db.exec(fs.readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  }
});
test.after(() => db.close());

async function fixture({
  status = 'active',
  blocked = false,
  joinedAt = '2026-09-01T10:00:00Z',
  updatedAt = joinedAt,
} = {}) {
  const owner = uuid(),
    customer = uuid(),
    group = uuid(),
    member = uuid();
  await db.query(
    "insert into customers(id,name,phone) values($1,'Owner','77000000001'),($2,'Adult','77000000002')",
    [owner, customer],
  );
  await db.query('insert into family_groups(id,owner_customer_id) values($1,$2)', [group, owner]);
  await db.query(
    "insert into family_members(id,group_id,customer_id,name,relation,status,blocked,created_at,updated_at) values($1,$2,$3,'Adult','wife',$4,$5,$6,$7)",
    [member, group, customer, status, blocked, joinedAt, updatedAt],
  );
  return { owner, customer, group, member };
}
async function audit(f, action, at, details = {}) {
  await db.query(
    'insert into family_audit(group_id,actor_customer_id,member_id,action,details,created_at) values($1,$2,$3,$4,$5,$6)',
    [f.group, f.owner, f.member, action, JSON.stringify(details), at],
  );
}
async function ownerAt(f, at) {
  return (await one('select family_bonus_owner_at($1,$2) owner', [f.customer, at])).owner;
}

test('offline earnings use the family at scan time across leave, gap and rejoin', async () => {
  const f = await fixture({ status: 'removed', updatedAt: '2026-09-25T10:00:00Z' });
  await audit(f, 'member_removed', '2026-09-20T10:00:00Z');
  await audit(f, 'member_removed', '2026-09-25T10:00:00Z');
  const second = { ...f, owner: uuid(), group: uuid(), member: uuid() };
  await db.query("insert into customers(id,name,phone) values($1,'New owner','77000000003')", [
    second.owner,
  ]);
  await db.query('insert into family_groups(id,owner_customer_id) values($1,$2)', [
    second.group,
    second.owner,
  ]);
  await db.query(
    "insert into family_members(id,group_id,customer_id,name,relation,created_at,updated_at) values($1,$2,$3,'Adult','wife','2026-09-21T10:00:00Z','2026-09-21T10:00:00Z')",
    [second.member, second.group, f.customer],
  );
  assert.equal(
    (await one('select family_bonus_owner($1) owner', [f.customer])).owner,
    second.owner,
  );
  assert.equal(await ownerAt(f, '2026-09-01T09:59:59Z'), f.customer);
  assert.equal(await ownerAt(f, '2026-09-01T10:00:00Z'), f.owner);
  assert.equal(await ownerAt(f, '2026-09-19T23:00:00Z'), f.owner);
  assert.equal(await ownerAt(f, '2026-09-20T10:00:00Z'), f.customer);
  assert.equal(await ownerAt(f, '2026-09-21T09:59:59Z'), f.customer);
  assert.equal(await ownerAt(f, '2026-09-21T10:00:00Z'), second.owner);
  assert.equal(await ownerAt(f, '2026-09-26T10:00:00Z'), second.owner);
});

test('pause and resume history is evaluated at scan, ignoring later cap or password edits', async () => {
  const f = await fixture({ blocked: false, updatedAt: '2026-09-15T10:00:00Z' });
  await audit(f, 'member_updated', '2026-09-05T10:00:00Z', { blocked: true });
  await audit(f, 'member_updated', '2026-09-06T10:00:00Z', { dailyLimitMinor: 50000 });
  await audit(f, 'member_updated', '2026-09-07T10:00:00Z', { passwordChanged: true });
  await audit(f, 'member_updated', '2026-09-10T10:00:00Z', { blocked: false });
  await audit(f, 'member_updated', '2026-09-15T10:00:00Z', { dailyLimitMinor: 100000 });
  assert.equal(await ownerAt(f, '2026-09-05T09:59:59Z'), f.owner);
  assert.equal(await ownerAt(f, '2026-09-05T10:00:00Z'), f.customer);
  assert.equal(await ownerAt(f, '2026-09-09T10:00:00Z'), f.customer);
  assert.equal(await ownerAt(f, '2026-09-10T10:00:00Z'), f.owner);
  assert.equal(await ownerAt(f, '2026-09-16T10:00:00Z'), f.owner);
});

test('current blocking never rewrites previously valid family scans', async () => {
  const f = await fixture({ blocked: true, updatedAt: '2026-09-10T10:00:00Z' });
  await audit(f, 'member_updated', '2026-09-10T10:00:00Z', { blocked: true });
  assert.equal(await ownerAt(f, '2026-09-09T10:00:00Z'), f.owner);
  assert.equal(await ownerAt(f, '2026-09-10T10:00:00Z'), f.customer);
});

test('deletion without a removal audit uses its captured terminal timestamp', async () => {
  const f = await fixture({ status: 'removed', blocked: true, updatedAt: '2026-09-20T10:00:00Z' });
  await db.query("update customers set deleted_at='2026-09-20T10:00:00Z' where id=$1", [f.owner]);
  assert.equal(await ownerAt(f, '2026-09-19T10:00:00Z'), f.owner);
  assert.equal(await ownerAt(f, '2026-09-20T10:00:00Z'), f.customer);
  assert.equal(await ownerAt(f, '2026-09-21T10:00:00Z'), f.customer);
});

test('same-time pause decisions use the latest audit entry deterministically', async () => {
  const f = await fixture();
  await audit(f, 'member_updated', '2026-09-05T10:00:00Z', { blocked: true });
  await audit(f, 'member_updated', '2026-09-05T10:00:00Z', { blocked: false });
  assert.equal(await ownerAt(f, '2026-09-05T10:00:00Z'), f.owner);
});

test('personal customers retain their identity and historical lookup is service-only', async () => {
  const customer = uuid();
  await db.query("insert into customers(id,name,phone) values($1,'Individual','77000000009')", [
    customer,
  ]);
  assert.equal(await ownerAt({ customer }, '2026-09-26T10:00:00Z'), customer);
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      (
        await one(
          "select has_function_privilege($1,'family_bonus_owner_at(uuid,timestamp with time zone)','EXECUTE') allowed",
          [role],
        )
      ).allowed,
      false,
    );
  }
  assert.equal(
    (
      await one(
        "select has_function_privilege('service_role','family_bonus_owner_at(uuid,timestamp with time zone)','EXECUTE') allowed",
      )
    ).allowed,
    true,
  );
});
