const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const branchA = randomUUID();
const branchB = randomUUID();
let sequence = 0;
const expectedPolicy = { rapidCount: 5, rapidMinutes: 10, dailyCount: 20, timeZone: 'Asia/Almaty' };
const employee = (id, overrides = {}) => ({
  id: String(id),
  name: 'Алия Кассир',
  pointId: '1',
  branchName: 'Точка A',
  city: 'Актау',
  branchId: branchA,
  isActive: true,
  inviteToken: createHash('sha256').update(String(id)).digest('hex'),
  ...overrides,
});
async function sync(items) {
  return db.query('select sync_cashier_signup_directory($1)', [items]);
}
async function seedRewards(cashier, times, branchId = cashier.branchId) {
  const rows = times.map((completedAt) => ({
    employee_id: cashier.id,
    phone_key: createHash('sha256').update(`fixture-${++sequence}`).digest('hex'),
    employee_name: cashier.name,
    point_id: cashier.pointId,
    branch_name: cashier.branchName,
    city: cashier.city,
    branch_id: branchId,
    completed_at: completedAt,
  }));
  await db.query(
    `insert into cashier_signup_rewards(employee_id,phone_key,employee_name,
    point_id,branch_name,city,branch_id,completed_at)
    select employee_id,phone_key,employee_name,point_id,branch_name,city,branch_id,completed_at
    from jsonb_to_recordset($1) as r(employee_id text,phone_key text,employee_name text,
      point_id text,branch_name text,city text,branch_id uuid,completed_at timestamptz)`,
    [rows],
  );
}
async function ranking(
  branches = [],
  from = '2026-10-01T00:00:00+05:00',
  to = '2026-10-04T00:00:00+05:00',
) {
  const result = (
    await db.query('select cashier_signup_ranking($1,$2,$3) result', [from, to, branches])
  ).rows[0].result;
  assert.deepEqual(result.reviewPolicy, expectedPolicy);
  return result.items;
}
const instant = (value) => new Date(value).toISOString();
const signal = (row, type) => row.reviewSignals.find((hint) => hint.type === type);
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,phone text unique,name text,last_name text,email text,
      gender text,birth_date date,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,name text,city text,active boolean default true);`);
  await db.query('insert into bulka_locations(id,name,city) values($1,$2,$3),($4,$5,$6)', [
    branchA,
    'Точка A',
    'Актау',
    branchB,
    'Точка B',
    'Астана',
  ]);
  for (const file of [
    '20260927140000_branch_signup_race.sql',
    '20261003230000_cashier_signup_race.sql',
    '20261003232000_cashier_directory_guarded_update.sql',
    '20261005093000_cashier_signup_review.sql',
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
});
test.beforeEach(async () => {
  await db.exec('delete from cashier_signup_rewards; delete from cashier_signup_directory;');
});
test.after(() => db.close());

test('possible duplicates normalize only FIO whitespace/case and require active same point and city', async () => {
  await sync([
    employee(10, { name: ' АЛИЯ  Кассир ' }),
    employee(11, { name: '\tалия кассир\n' }),
    employee(12, { pointId: '2' }),
    employee(13, { city: 'Астана' }),
    employee(14, { isActive: false }),
    employee(15, { branchId: branchB }),
    employee(16, { name: 'Кассир Алия' }),
    employee(17, { pointId: null }),
    employee(18, { pointId: null }),
  ]);
  const all = await ranking();
  assert.deepEqual(
    all.find((row) => row.id === '10').duplicateCandidates.map((row) => row.id),
    ['11', '15'],
  );
  assert.equal(all.find((row) => row.id === '10').pointId, '1');
  for (const id of ['12', '13', '16', '17', '18']) {
    assert.deepEqual(all.find((row) => row.id === id).duplicateCandidates, []);
  }
  assert.equal(
    all.some((row) => row.id === '14'),
    false,
  );
  const scoped = await ranking([branchA]);
  const candidates = scoped.find((row) => row.id === '10').duplicateCandidates;
  assert.deepEqual(
    candidates.map((row) => row.id),
    ['11'],
  );
  assert.deepEqual(Object.keys(candidates[0]).sort(), [
    'branchName',
    'city',
    'id',
    'name',
    'pointId',
  ]);
  assert.equal(
    scoped.some((row) => row.id === '15'),
    false,
  );
  assert.ok(scoped.every((row) => row.rewardAmount === 0 && row.completed === 0));
});

test('historical branch earnings do not expose duplicate peers at a transferred employee current point', async () => {
  const original = employee(10);
  await sync([original]);
  await seedRewards(
    original,
    Array.from({ length: 5 }, (_, index) => `2026-10-01T10:0${index}:00+05:00`),
  );
  const transferred = {
    ...original,
    pointId: '2',
    branchId: branchB,
    city: 'Астана',
    branchName: 'Точка B',
  };
  await sync([
    transferred,
    employee(11, { ...transferred, id: '11', inviteToken: employee(11).inviteToken }),
  ]);
  const historicalScope = await ranking([branchA]);
  assert.equal(historicalScope.length, 1);
  assert.equal(historicalScope[0].completed, 5);
  assert.deepEqual(historicalScope[0].duplicateCandidates, []);
  assert.equal(signal(historicalScope[0], 'rapid_registrations').count, 5);
  const currentScope = await ranking([branchB]);
  assert.equal(currentScope.find((row) => row.id === '10').completed, 0);
  assert.deepEqual(currentScope.find((row) => row.id === '10').reviewSignals, []);
  assert.deepEqual(
    currentScope.find((row) => row.id === '10').duplicateCandidates.map((row) => row.id),
    ['11'],
  );
});

test('rolling ten minute detection excludes the exact end boundary and never combines cashiers or unauthorized rewards', async () => {
  const a = employee(10);
  const b = employee(11, { name: 'Марат Кассир' });
  await sync([a, b]);
  await seedRewards(a, [
    '2026-10-01T10:00:00+05:00',
    '2026-10-01T10:01:00+05:00',
    '2026-10-01T10:02:00+05:00',
    '2026-10-01T10:03:00+05:00',
    '2026-10-01T10:10:00+05:00',
  ]);
  await seedRewards(b, ['2026-10-01T10:04:00+05:00']);
  assert.ok((await ranking()).every((row) => row.reviewSignals.length === 0));
  await seedRewards(a, ['2026-10-01T10:09:59.999999+05:00'], branchB);
  assert.deepEqual((await ranking([branchA])).find((row) => row.id === '10').reviewSignals, []);
  const row = (await ranking()).find((row) => row.id === '10');
  assert.equal(row.completed, 6);
  assert.equal(row.rewardAmount, 1800);
  const hint = signal(row, 'rapid_registrations');
  assert.equal(hint.count, 5);
  assert.equal(instant(hint.from), '2026-10-01T05:00:00.000Z');
  assert.equal(instant(hint.to), '2026-10-01T05:10:00.000Z');
});

test('rapid peaks select the largest rolling burst and the earliest equal peak, including timestamp peers', async () => {
  const a = employee(10);
  await sync([a]);
  await seedRewards(a, [
    ...Array(5).fill('2026-10-01T09:00:00+05:00'),
    ...Array(6).fill('2026-10-01T10:00:00+05:00'),
    ...Array(6).fill('2026-10-01T11:00:00+05:00'),
  ]);
  const row = (await ranking())[0];
  assert.equal(row.reviewSignals.length, 1);
  const hint = signal(row, 'rapid_registrations');
  assert.equal(hint.count, 6);
  assert.equal(instant(hint.from), '2026-10-01T05:00:00.000Z');
});

test('daily signals use UTC+5 calendar days rather than UTC and choose one peak with deterministic ties', async () => {
  const a = employee(10);
  await sync([a]);
  // These are October 2 locally, although five belong to October 1 in UTC.
  await seedRewards(
    a,
    Array.from({ length: 19 }, (_, index) =>
      new Date(Date.parse('2026-10-02T00:00:00+05:00') + index * 3600000).toISOString(),
    ),
  );
  assert.deepEqual((await ranking())[0].reviewSignals, []);
  await seedRewards(a, ['2026-10-02T19:00:00+05:00']);
  await seedRewards(
    a,
    Array.from({ length: 20 }, (_, index) =>
      new Date(Date.parse('2026-10-03T00:00:00+05:00') + index * 3600000).toISOString(),
    ),
  );
  const row = (await ranking())[0];
  assert.equal(row.reviewSignals.length, 1);
  const hint = signal(row, 'daily_registrations');
  assert.equal(hint.count, 20);
  assert.equal(instant(hint.from), '2026-10-01T19:00:00.000Z');
  assert.equal(instant(hint.to), '2026-10-02T19:00:00.000Z');
  assert.equal(row.completed, 40);
  assert.equal(row.rewardAmount, 12000);
});

test('selected period is half open, clips signal times and cannot pull outside registrations into a flag', async () => {
  const a = employee(10);
  await sync([a]);
  await seedRewards(a, [
    '2026-10-01T23:55:00+05:00',
    '2026-10-01T23:56:00+05:00',
    '2026-10-01T23:57:00+05:00',
    '2026-10-01T23:58:00+05:00',
    '2026-10-01T23:59:00+05:00',
    '2026-10-02T00:00:00+05:00',
  ]);
  const to = '2026-10-02T00:00:00+05:00';
  const row = (await ranking([], '2026-10-01T23:55:00+05:00', to))[0];
  assert.equal(row.completed, 5);
  assert.equal(signal(row, 'rapid_registrations').count, 5);
  assert.equal(instant(signal(row, 'rapid_registrations').to), instant(to));
  assert.deepEqual((await ranking([], '2026-10-01T23:56:00+05:00', to))[0].reviewSignals, []);
  assert.deepEqual((await ranking([], to, '2026-10-02T00:01:00+05:00'))[0].reviewSignals, []);
});

test('review hints preserve archived salary history, permanent QR and every reward byte; client roles stay denied', async () => {
  const a = employee(10);
  await sync([a]);
  await seedRewards(a, Array(20).fill('2026-10-01T11:00:00+05:00'));
  const before = (
    await db.query('select to_jsonb(r) reward from cashier_signup_rewards r order by id')
  ).rows;
  const qrBefore = (await db.query('select invite_token from cashier_signup_directory')).rows[0]
    .invite_token;
  await sync([{ ...a, isActive: false }]);
  const row = (await ranking())[0];
  assert.equal(row.isArchived, true);
  assert.equal(row.inviteToken, null);
  assert.equal(row.completed, 20);
  assert.equal(row.rewardAmount, 6000);
  assert.deepEqual(
    row.reviewSignals.map((hint) => hint.type),
    ['rapid_registrations', 'daily_registrations'],
  );
  assert.deepEqual(row.duplicateCandidates, []);
  assert.deepEqual(
    (await db.query('select to_jsonb(r) reward from cashier_signup_rewards r order by id')).rows,
    before,
  );
  assert.equal(
    (await db.query('select invite_token from cashier_signup_directory')).rows[0].invite_token,
    qrBefore,
  );
  assert.deepEqual(await ranking([randomUUID()]), []);
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'cashier_signup_ranking(timestamptz,timestamptz,uuid[])','EXECUTE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  }
  for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('service_role','cashier_signup_rewards',$1) allowed",
          [privilege],
        )
      ).rows[0].allowed,
      false,
    );
  }
});
