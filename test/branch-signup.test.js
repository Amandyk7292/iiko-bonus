const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const branchA = randomUUID(),
  branchB = randomUUID();
let sequence = 1000000;
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table customers(id uuid primary key,phone text unique,name text,last_name text,email text,gender text,birth_date date,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,name text,city text,active boolean default true);`);
  await db.query(
    "insert into bulka_locations(id,name,city) values($1,'Актау 1','Актау'),($2,'Астана 1','Астана')",
    [branchA, branchB],
  );
  await db.exec(readFileSync('supabase/migrations/20260927140000_branch_signup_race.sql', 'utf8'));
});
test.after(() => db.close());
function person() {
  const phone = '+7700' + ++sequence;
  return { phone, key: createHash('sha256').update(phone).digest('hex'), id: randomUUID() };
}
async function claim(p, branch = branchA) {
  return (await db.query('select claim_branch_signup($1,$2,$3) r', [p.phone, p.key, branch]))
    .rows[0].r;
}
async function createCustomer(p, name = 'Новый Гость') {
  await db.query('insert into customers(id,phone,name) values($1,$2,$3)', [p.id, p.phone, name]);
}
async function finish(p) {
  return (
    await db.query('select finish_customer_registration($1,$2,$3) r', [
      p.id,
      p.key,
      { name: 'Новый Клиент', last_name: 'Клиент' },
    ])
  ).rows[0].r;
}
async function records(p) {
  return (
    await db.query('select * from branch_signup_claims where phone_key=$1 order by verified_at', [
      p.key,
    ])
  ).rows;
}
test('verified phone alone remains pending; signup awards exactly one point without any purchase', async () => {
  const p = person();
  const saved = await claim(p);
  assert.equal(saved.status, 'saved');
  assert.equal((await records(p))[0].completed_at, null);
  await createCustomer(p);
  assert.equal((await finish(p)).counted, true);
  await assert.rejects(finish(p), /already registered/);
  assert.equal((await records(p)).filter((r) => r.completed_at).length, 1);
});
test('rescanning another branch does not steal attribution or extend 30 days', async () => {
  const p = person();
  const first = await claim(p);
  const again = await claim(p, branchB);
  assert.equal(first.branchId, branchA);
  assert.deepEqual(first, again);
  assert.equal((await records(p)).length, 1);
});
test('a later registration with the same phone claims attribution independently of browser state', async () => {
  const p = person();
  await claim(p, branchB);
  await createCustomer(p);
  await finish(p);
  const row = (await records(p))[0];
  assert.equal(row.customer_id, p.id);
  assert.equal(row.branch_id, branchB);
});
test('expired invitation does not count, but still permits signup', async () => {
  const p = person();
  await claim(p);
  await db.query(
    "update branch_signup_claims set verified_at=now()-interval '31 days',expires_at=now()-interval '1 day' where phone_key=$1",
    [p.key],
  );
  await createCustomer(p);
  assert.equal((await finish(p)).counted, false);
  assert.equal((await records(p))[0].completed_at, null);
});
test('fresh verification after expiry may create a new invitation while preserving history', async () => {
  const p = person();
  await claim(p);
  await db.query(
    "update branch_signup_claims set verified_at=now()-interval '31 days',expires_at=now()-interval '1 day' where phone_key=$1",
    [p.key],
  );
  assert.equal((await claim(p, branchB)).branchId, branchB);
  await createCustomer(p);
  await finish(p);
  const rows = await records(p);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.completed_at)[0].branch_id, branchB);
});
test('existing customer is never counted; recreating a deleted account does not earn another point', async () => {
  const existing = person();
  await createCustomer(existing, 'Постоянный Клиент');
  assert.equal((await claim(existing)).status, 'existing');
  const p = person();
  await claim(p);
  await createCustomer(p);
  await finish(p);
  await db.query('delete from customers where id=$1', [p.id]);
  assert.equal((await claim(p, branchB)).status, 'existing');
});
test('signup with another phone and signup without a QR remain valid but do not count', async () => {
  const first = person(),
    other = person();
  await claim(first);
  await createCustomer(other);
  assert.equal((await finish(other)).counted, false);
  assert.equal((await records(first))[0].completed_at, null);
});
test('unavailable branches cannot capture an invitation', async () => {
  await assert.rejects(claim(person(), randomUUID()), /unavailable/);
});
test('profile persistence and scoring roll back together on invalid data', async () => {
  const p = person();
  await claim(p);
  await createCustomer(p);
  await assert.rejects(
    db.query('select finish_customer_registration($1,$2,$3)', [
      p.id,
      p.key,
      { name: 'Test', birth_date: 'not-date' },
    ]),
  );
  assert.equal((await records(p))[0].completed_at, null);
  assert.equal(
    (await db.query('select name from customers where id=$1', [p.id])).rows[0].name,
    'Новый Гость',
  );
  assert.equal((await finish(p)).counted, true);
});
test('ranking uses completion date, sorts descending, preserves ties and applies branch scope', async () => {
  const all = (
    await db.query(
      "select branch_signup_ranking(now()-interval '1 day',now()+interval '1 day','{}') r",
    )
  ).rows[0].r.items;
  assert.equal(all.length, 2);
  assert.ok(all[0].completed >= all[1].completed);
  for (const row of all) {
    assert.equal('phone_key' in row, false);
    assert.equal('customer_id' in row, false);
  }
  const scoped = (
    await db.query(
      "select branch_signup_ranking(now()-interval '1 day',now()+interval '1 day',$1) r",
      [[branchB]],
    )
  ).rows[0].r.items;
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, branchB);
  const empty = (await db.query("select branch_signup_ranking('2020-01-01','2020-02-01','{}') r"))
    .rows[0].r.items;
  assert.ok(empty.every((row) => row.completed === 0 && row.rank === 1));
});
test('all attribution data and mutation RPCs are server-only', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const fn of [
      'claim_branch_signup(text,text,uuid)',
      'finish_customer_registration(uuid,text,jsonb)',
      'branch_signup_ranking(timestamptz,timestamptz,uuid[])',
    ])
      assert.equal(
        (await db.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, fn])).rows[0]
          .ok,
        false,
      );
    assert.equal(
      (await db.query("select has_table_privilege($1,'branch_signup_claims','SELECT') ok", [role]))
        .rows[0].ok,
      false,
    );
  }
});
