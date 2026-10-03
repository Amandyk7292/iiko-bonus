const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const branch = randomUUID();
const secondBranch = randomUUID();
const tokenA = 'a'.repeat(64),
  tokenB = 'b'.repeat(64);
const cashierA = {
  id: '10',
  name: 'Алия Кассир',
  pointId: '1',
  branchName: 'Точка 1',
  city: 'Актау',
  branchId: branch,
  isActive: true,
  inviteToken: tokenA,
};
const cashierB = {
  id: '11',
  name: 'Марат Кассир',
  pointId: '2',
  branchName: 'Точка 2',
  city: 'Астана',
  branchId: secondBranch,
  isActive: true,
  inviteToken: tokenB,
};
let sequence = 2000000;
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges grant all on tables to service_role;
    create table customers(id uuid primary key,phone text unique,name text,last_name text,email text,gender text,birth_date date,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,name text,city text,active boolean default true);`);
  await db.query(
    "insert into bulka_locations(id,name,city) values($1,'Точка 1','Актау'),($2,'Точка 2','Астана')",
    [branch, secondBranch],
  );
  await db.exec(readFileSync('supabase/migrations/20260927140000_branch_signup_race.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261003230000_cashier_signup_race.sql', 'utf8'));
  await sync([cashierA, cashierB]);
});
test.after(() => db.close());
async function sync(items) {
  return (await db.query('select sync_cashier_signup_directory($1) r', [items])).rows[0].r;
}
async function person(name = 'Новый Гость', phone) {
  phone ||= '+7700' + ++sequence;
  const p = { id: randomUUID(), phone, key: createHash('sha256').update(phone).digest('hex') };
  await db.query('insert into customers(id,phone,name) values($1,$2,$3)', [p.id, p.phone, name]);
  return p;
}
async function finish(p, employee = cashierA, profile = { name: 'Новый Клиент' }) {
  return (
    await db.query('select finish_customer_registration_with_cashier($1,$2,$3,$4,$5) r', [
      p.id,
      p.key,
      profile,
      employee.inviteToken,
      employee,
    ])
  ).rows[0].r;
}
async function rewards(p) {
  return (await db.query('select * from cashier_signup_rewards where phone_key=$1', [p.key])).rows;
}
async function ranking(branches = [], from = '2020-01-01', to = '2030-01-01') {
  return (await db.query('select cashier_signup_ranking($1,$2,$3) r', [from, to, branches])).rows[0]
    .r.items;
}

test('directory refresh preserves QR tokens; archived cashiers disappear from the public list', async () => {
  const refreshed = await sync([
    { ...cashierA, inviteToken: 'c'.repeat(64) },
    { ...cashierB, isActive: false },
  ]);
  assert.equal(refreshed.items.length, 1);
  assert.equal(refreshed.items[0].invite_token, tokenA);
  await sync([cashierA, cashierB]);
  await assert.rejects(sync(null), /Invalid cashier directory/);
  assert.equal((await ranking()).length, 2);
});
test('an active cashier without a point can accrue salary without inventing a customer branch', async () => {
  const unassigned = {
    ...cashierA,
    id: '12',
    pointId: null,
    branchId: null,
    branchName: 'Точка не назначена',
    city: 'Не указан',
    inviteToken: 'd'.repeat(64),
  };
  await sync([cashierA, cashierB, unassigned]);
  const p = await person();
  assert.equal((await finish(p, unassigned)).cashierCounted, true);
  const [row] = await rewards(p);
  assert.equal(row.point_id, null);
  assert.equal(row.branch_id, null);
  assert.equal(row.amount, 300);
  assert.equal(
    (await ranking([branch])).some((item) => item.id === unassigned.id),
    false,
  );
  await sync([cashierA, cashierB]);
});
test('only completed signup creates exactly one immutable 300 KZT salary accrual', async () => {
  const p = await person();
  assert.equal((await rewards(p)).length, 0);
  assert.equal((await finish(p)).cashierRewardAmount, 300);
  const [row] = await rewards(p);
  assert.equal(row.employee_id, cashierA.id);
  assert.equal(row.amount, 300);
  await assert.rejects(finish(p, cashierB), /already registered/);
  assert.equal((await rewards(p)).length, 1);
  assert.equal(
    (await db.query('select name from customers where id=$1', [p.id])).rows[0].name,
    'Новый Клиент',
  );
});
test('invalid archive status, mismatched employee or bad profile leave both profile and reward unchanged', async () => {
  for (const employee of [
    { ...cashierA, isActive: false },
    { ...cashierB, inviteToken: tokenA },
  ]) {
    const p = await person();
    await assert.rejects(finish(p, employee), /unavailable/);
    assert.equal((await rewards(p)).length, 0);
    assert.equal(
      (await db.query('select name from customers where id=$1', [p.id])).rows[0].name,
      'Новый Гость',
    );
  }
  const p = await person();
  await assert.rejects(finish(p, cashierA, { name: 'Client', birth_date: 'not-date' }), /date/);
  assert.equal((await rewards(p)).length, 0);
  assert.equal(
    (await db.query('select app_registered_at from customers where id=$1', [p.id])).rows[0]
      .app_registered_at,
    null,
  );
  assert.equal((await finish(p)).cashierCounted, true);
});
test('an established customer is not paid for; account deletion never resets the phone reward', async () => {
  const established = await person('Постоянный Клиент');
  await assert.rejects(finish(established), /already registered/);
  const p = await person();
  await finish(p);
  await db.query('delete from customers where id=$1', [p.id]);
  const recreated = await person('Новый Гость', p.phone);
  assert.equal((await finish(recreated, cashierB)).cashierCounted, false);
  const [row] = await rewards(recreated);
  assert.equal(row.employee_id, cashierA.id);
  assert.equal(row.customer_id, null);
  assert.equal(row.amount, 300);
});
test('ordinary signup and historical branch attribution remain compatible without a cashier reward', async () => {
  const p = await person();
  await db.query('select claim_branch_signup($1,$2,$3)', [p.phone, p.key, branch]);
  const result = (
    await db.query('select finish_customer_registration($1,$2,$3) r', [
      p.id,
      p.key,
      { name: 'Обычный Клиент' },
    ])
  ).rows[0].r;
  assert.equal(result.counted, true);
  assert.equal((await rewards(p)).length, 0);
});
test('rank uses completion dates and branch authorization; archived earnings stay visible', async () => {
  const p = await person();
  await finish(p, cashierB);
  const all = await ranking();
  assert.ok(all[0].completed >= all[1].completed);
  assert.ok(all.every((row) => row.rewardAmount === row.completed * 300));
  assert.equal((await ranking([secondBranch])).length, 1);
  assert.equal((await ranking([randomUUID()])).length, 0);
  assert.ok((await ranking([], '2019-01-01', '2019-02-01')).every((row) => row.completed === 0));
  await sync([{ ...cashierA, isActive: false }, cashierB]);
  const archived = (await ranking()).find((row) => row.id === cashierA.id);
  assert.equal(archived.isArchived, true);
  assert.equal(archived.inviteToken, null);
  assert.ok(archived.rewardAmount > 0);
  assert.equal('phone_key' in archived, false);
  assert.equal('customer_id' in archived, false);
});
test('client roles cannot read/mutate attribution; the service cannot rewrite accrued reward amounts', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['cashier_signup_directory', 'cashier_signup_rewards']) {
      assert.equal(
        (await db.query("select has_table_privilege($1,$2,'SELECT') ok", [role, table])).rows[0].ok,
        false,
      );
    }
    for (const fn of [
      'sync_cashier_signup_directory(jsonb)',
      'finish_customer_registration_with_cashier(uuid,text,jsonb,text,jsonb)',
      'cashier_signup_ranking(timestamptz,timestamptz,uuid[])',
    ]) {
      assert.equal(
        (await db.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, fn])).rows[0]
          .ok,
        false,
      );
    }
  }
  for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('service_role','cashier_signup_rewards',$1) ok",
          [privilege],
        )
      ).rows[0].ok,
      false,
    );
  }
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('service_role','cashier_signup_directory','DELETE') ok",
      )
    ).rows[0].ok,
    false,
  );
  const p = await person();
  await assert.rejects(
    db.query(
      'insert into cashier_signup_rewards(employee_id,phone_key,customer_id,amount,employee_name,point_id,branch_name,city) values($1,$2,$3,900,$4,$5,$6,$7)',
      ['10', p.key, p.id, 'Employee', '1', 'Point', 'City'],
    ),
    /check constraint/,
  );
});
