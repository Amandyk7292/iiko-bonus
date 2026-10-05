const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createCashierPayroll } = require('../src/services/cashier-payroll.service');

const db = new PGlite();
const branchA = randomUUID();
const branchB = randomUUID();
let sequence = 0;
const fixtureActor = 'payroll-test-owner';
const cashier = (id, overrides = {}) => ({
  id: String(id),
  name: 'Алия Кассир',
  pointId: '1',
  branchName: 'Историческая точка A',
  city: 'Актау',
  branchId: branchA,
  isActive: true,
  inviteToken: createHash('sha256').update(`cashier-${id}`).digest('hex'),
  ...overrides,
});
const service = createCashierPayroll({
  db: {
    async rpc(name, args) {
      try {
        const sql = `select ${name}(${Object.keys(args)
          .map((key, index) => `${key} => $${index + 1}`)
          .join(',')}) result`;
        const result = await db.query(sql, Object.values(args));
        return { data: result.rows[0].result };
      } catch (error) {
        return { error };
      }
    },
  },
});
async function sync(items) {
  return db.query('select sync_cashier_signup_directory($1)', [items]);
}
async function seedReward(employee, completedAt = '2026-10-05T12:00:00+05:00', overrides = {}) {
  const id = randomUUID();
  const row = {
    employee_id: employee.id,
    phone_key: createHash('sha256').update(`reward-${++sequence}`).digest('hex'),
    employee_name: employee.name,
    point_id: employee.pointId,
    branch_name: employee.branchName,
    city: employee.city,
    branch_id: employee.branchId,
    completed_at: completedAt,
    ...overrides,
  };
  await db.query(
    `insert into cashier_signup_rewards(id,${Object.keys(row)})
    values($1,${Object.keys(row)
      .map((_, index) => `$${index + 2}`)
      .join(',')})`,
    [id, ...Object.values(row)],
  );
  return id;
}
const statement = (month = '2026-10', branches = []) => service.statement({ month, branches });
const payment = (row, overrides = {}) => ({
  month: '2026-10',
  rowKey: row.rowKey,
  snapshot: row.snapshot,
  idempotencyKey: randomUUID(),
  actor: fixtureActor,
  branches: [],
  ...overrides,
});
const instant = (value) => new Date(value).toISOString();

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
    '20261004113000_staff_cashier_branch_mappings.sql',
    '20261005130000_cashier_payroll.sql',
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
});
test.beforeEach(async () => {
  await db.exec(`delete from cashier_payroll_payment_rewards; delete from cashier_payroll_payments;
    delete from cashier_signup_rewards; delete from cashier_signup_directory;`);
});
test.after(() => db.close());

test('monthly statement includes only accrued rows and uses half-open UTC+5 month boundaries', async () => {
  const a = cashier(10);
  const withoutRewards = cashier(11, { name: 'Без начислений' });
  await sync([a, withoutRewards]);
  await seedReward(a, '2026-09-30T23:59:59.999999+05:00');
  await seedReward(a, '2026-10-01T00:00:00+05:00');
  await seedReward(a, '2026-10-31T23:59:59.999999+05:00');
  await seedReward(a, '2026-11-01T00:00:00+05:00');
  const result = await statement();
  assert.equal(result.month, '2026-10');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].completed, 2);
  assert.equal(result.items[0].outstandingCount, 2);
  assert.deepEqual(result.totals, {
    completed: 2,
    rewardAmount: 600,
    paidAmount: 0,
    outstandingAmount: 600,
  });
  assert.equal((await statement('2026-09')).totals.completed, 1);
  assert.equal((await statement('2026-11')).totals.completed, 1);
  assert.deepEqual((await statement('2027-01')).items, []);
  assert.deepEqual((await statement('2027-01')).totals, {
    completed: 0,
    rewardAmount: 0,
    paidAmount: 0,
    outstandingAmount: 0,
  });
  assert.match(result.items[0].rowKey, /^[a-f0-9]{64}$/);
  assert.match(result.items[0].snapshot, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.items[0].payments, []);
});

test('historical point/city/branch groups preserve archived earnings and historical names despite transfers and renames', async () => {
  const original = cashier(10);
  await sync([original]);
  await seedReward(original, '2026-10-02T10:00:00+05:00');
  await seedReward(
    { ...original, name: 'Алия Новое Имя', branchName: 'Переименованная точка A' },
    '2026-10-03T10:00:00+05:00',
  );
  const transferred = {
    ...original,
    pointId: '2',
    city: 'Астана',
    branchId: branchB,
    branchName: 'Точка B',
    name: 'Алия После Перевода',
  };
  await seedReward(transferred);
  await sync([
    {
      ...transferred,
      name: 'Текущие кадры не подставлять',
      branchName: 'Текущую точку не подставлять',
      isActive: false,
    },
  ]);
  const all = await statement();
  assert.equal(all.items.length, 2);
  const oldPoint = all.items.find((row) => row.pointId === '1');
  const newPoint = all.items.find((row) => row.pointId === '2');
  assert.equal(oldPoint.name, 'Алия Новое Имя');
  assert.equal(oldPoint.branchName, 'Переименованная точка A');
  assert.equal(oldPoint.completed, 2);
  assert.equal(newPoint.name, 'Алия После Перевода');
  assert.equal(newPoint.completed, 1);
  assert.ok(all.items.every((row) => row.isArchived));
  assert.notEqual(oldPoint.rowKey, newPoint.rowKey);
  assert.equal((await statement('2026-10', [branchA])).items[0].rowKey, oldPoint.rowKey);
  assert.equal((await statement('2026-10', [branchA])).items.length, 1);
  assert.equal((await statement('2026-10', [branchB])).items[0].rowKey, newPoint.rowKey);
});

test('distinct employee IDs and null point IDs stay separate without guessing or merging their bonuses', async () => {
  const a = cashier(10, {
    pointId: null,
    branchId: null,
    city: 'Не указан',
    branchName: 'Точка не назначена',
  });
  const b = cashier(11, { ...a, id: '11', inviteToken: cashier(11).inviteToken });
  await sync([a, b]);
  await seedReward(a);
  await seedReward(b);
  const result = await statement();
  assert.equal(result.items.length, 2);
  assert.notEqual(result.items[0].rowKey, result.items[1].rowKey);
  assert.deepEqual(
    result.items.map((row) => row.rewardAmount),
    [300, 300],
  );
  assert.deepEqual((await statement('2026-10', [branchA])).items, []);
});

test('marking a snapshot records a single immutable batch and allocations without mutating rewards or QR', async () => {
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  await seedReward(a);
  const before = (
    await db.query('select to_jsonb(r) reward from cashier_signup_rewards r order by id')
  ).rows;
  const qrBefore = (await db.query('select invite_token from cashier_signup_directory')).rows;
  const [row] = (await statement()).items;
  const result = await service.markPaid(payment(row));
  assert.equal(result.replayed, false);
  assert.equal(result.payment.amount, 600);
  assert.equal(result.payment.registrations, 2);
  assert.equal(result.payment.paidBy, fixtureActor);
  assert.ok(Number.isFinite(Date.parse(result.payment.paidAt)));
  assert.match(result.payment.id, /^[0-9a-f-]{36}$/);
  const after = await statement();
  assert.deepEqual(after.totals, {
    completed: 2,
    rewardAmount: 600,
    paidAmount: 600,
    outstandingAmount: 0,
  });
  assert.equal(after.items[0].outstandingCount, 0);
  assert.notEqual(after.items[0].snapshot, row.snapshot);
  assert.equal(after.items[0].rowKey, row.rowKey);
  assert.deepEqual(after.items[0].payments, [result.payment]);
  assert.deepEqual(
    (await db.query('select to_jsonb(r) reward from cashier_signup_rewards r order by id')).rows,
    before,
  );
  assert.deepEqual(
    (await db.query('select invite_token from cashier_signup_directory')).rows,
    qrBefore,
  );
  assert.equal(
    (await db.query('select count(*)::integer count from cashier_payroll_payment_rewards')).rows[0]
      .count,
    2,
  );
  assert.equal(
    (await db.query('select count(*)::integer count from cashier_payroll_payments')).rows[0].count,
    1,
  );
  assert.deepEqual(Object.keys(result.payment).sort(), [
    'amount',
    'id',
    'paidAt',
    'paidBy',
    'registrations',
  ]);
});

test('reviewed mapping of a previously unassigned historical point preserves paid history in the newly authorized branch', async () => {
  const a = cashier(10, { pointId: '501', branchId: null });
  await sync([a]);
  await seedReward(a);
  await seedReward(a);
  const [before] = (await statement()).items;
  const args = payment(before);
  const paid = await service.markPaid(args);
  const originalBatch = (await db.query('select to_jsonb(p) batch from cashier_payroll_payments p'))
    .rows;
  await db.query(
    "insert into staff_cashier_branch_mappings(point_id,branch_id,reviewed_by) values('501',$1,'fixture reviewed mapping')",
    [branchA],
  );
  const [mapped] = (await statement('2026-10', [branchA])).items;
  assert.notEqual(mapped.rowKey, before.rowKey);
  assert.equal(mapped.paidAmount, 600);
  assert.equal(mapped.outstandingAmount, 0);
  assert.deepEqual(mapped.payments, [paid.payment]);
  assert.deepEqual(
    (await db.query('select to_jsonb(p) batch from cashier_payroll_payments p')).rows,
    originalBatch,
  );
  assert.deepEqual((await service.markPaid(args)).payment, paid.payment);
  await db.query("delete from staff_cashier_branch_mappings where point_id='501'");
});

test('a batch split by historical branch corrections exposes only each visible group allocation amount/count', async () => {
  const a = cashier(10, { branchId: null });
  await sync([a]);
  const firstId = await seedReward(a);
  await seedReward(a);
  const [before] = (await statement()).items;
  const paid = await service.markPaid(payment(before));
  // The normal reviewed mapping fills all NULL rewards at a point. A partial
  // historical correction still must not duplicate or leak the whole batch.
  await db.query('update cashier_signup_rewards set branch_id=$1 where id=$2', [branchA, firstId]);
  const all = await statement();
  assert.equal(all.items.length, 2);
  assert.equal(all.totals.paidAmount, 600);
  assert.ok(
    all.items.every(
      (row) =>
        row.paidAmount === 300 &&
        row.payments[0].amount === 300 &&
        row.payments[0].registrations === 1,
    ),
  );
  const scoped = await statement('2026-10', [branchA]);
  assert.equal(scoped.items.length, 1);
  assert.equal(scoped.totals.paidAmount, 300);
  assert.deepEqual(scoped.items[0].payments[0], { ...paid.payment, amount: 300, registrations: 1 });
});

test('a lost-response retry returns the original batch even after new rewards; all request/actor/scope fields must match', async () => {
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  const [row] = (await statement()).items;
  const args = payment(row, { branches: [branchB, branchA, branchA] });
  const first = await service.markPaid(args);
  await seedReward(a);
  const repeated = await service.markPaid({ ...args, branches: [branchA, branchB] });
  assert.equal(repeated.replayed, true);
  assert.deepEqual(repeated.payment, first.payment);
  for (const change of [
    { actor: 'another-owner' },
    { month: '2026-09' },
    { rowKey: 'a'.repeat(64) },
    { snapshot: 'b'.repeat(64) },
    { branches: [branchA] },
    { branches: [] },
  ])
    await assert.rejects(service.markPaid({ ...args, ...change }), {
      code: 'CASHIER_PAYROLL_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  const current = await statement();
  assert.deepEqual(current.totals, {
    completed: 2,
    rewardAmount: 600,
    paidAmount: 300,
    outstandingAmount: 300,
  });
  assert.equal(current.items[0].payments.length, 1);
});

test('registrations added before confirmation invalidate stale snapshots; later registrations form a new unpaid batch', async () => {
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  const [stale] = (await statement()).items;
  await seedReward(a);
  await assert.rejects(service.markPaid(payment(stale)), {
    code: 'CASHIER_PAYROLL_SNAPSHOT_CHANGED',
    statusCode: 409,
  });
  assert.equal(
    (await db.query('select count(*)::integer count from cashier_payroll_payments')).rows[0].count,
    0,
  );
  const [fresh] = (await statement()).items;
  const first = await service.markPaid(payment(fresh));
  assert.equal(first.payment.amount, 600);
  await seedReward(a);
  const [next] = (await statement()).items;
  assert.equal(next.outstandingAmount, 300);
  const second = await service.markPaid(payment(next));
  assert.equal(second.payment.amount, 300);
  assert.notEqual(first.payment.id, second.payment.id);
  const [paid] = (await statement()).items;
  assert.equal(paid.paidAmount, 900);
  assert.equal(paid.outstandingAmount, 0);
  assert.equal(paid.payments.length, 2);
  await assert.rejects(service.markPaid(payment(paid)), {
    code: 'CASHIER_PAYROLL_NOTHING_OUTSTANDING',
    statusCode: 409,
  });
});

test('selected branch scope blocks a forged row or unassigned reward and never leaks payment metadata', async () => {
  const a = cashier(10);
  const b = cashier(11, { branchId: branchB, pointId: '2', city: 'Астана' });
  const unknown = cashier(12, { branchId: null, pointId: null });
  await sync([a, b, unknown]);
  await seedReward(a);
  await seedReward(b);
  await seedReward(unknown);
  const all = await statement();
  for (const employeeId of ['11', '12']) {
    const row = all.items.find((item) => item.id === employeeId);
    await assert.rejects(service.markPaid(payment(row, { branches: [branchA] })), {
      code: 'CASHIER_PAYROLL_NOTHING_OUTSTANDING',
      statusCode: 409,
    });
  }
  await assert.rejects(
    service.markPaid(payment(all.items[0], { rowKey: 'c'.repeat(64), branches: [branchA] })),
    { code: 'CASHIER_PAYROLL_NOTHING_OUTSTANDING', statusCode: 409 },
  );
  assert.equal((await statement('2026-10', [branchA])).items.length, 1);
  assert.deepEqual((await statement('2026-10', [randomUUID()])).items, []);
  const rowB = all.items.find((item) => item.id === '11');
  await service.markPaid(payment(rowB));
  assert.deepEqual((await statement('2026-10', [branchA])).items[0].payments, []);
});

test('parallel retries share one batch and different keys cannot double allocate a snapshot', async () => {
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  await seedReward(a);
  const [row] = (await statement()).items;
  const args = payment(row);
  // PGlite serializes transactions on its one connection; these simultaneous
  // client calls exercise both retry paths and the unique allocation guard.
  const sameKey = await Promise.all([service.markPaid(args), service.markPaid(args)]);
  assert.deepEqual(sameKey.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(sameKey[0].payment.id, sameKey[1].payment.id);
  await seedReward(a);
  const [fresh] = (await statement()).items;
  const differentKeys = await Promise.allSettled([
    service.markPaid(payment(fresh)),
    service.markPaid(payment(fresh)),
  ]);
  assert.equal(differentKeys.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    differentKeys.find((result) => result.status === 'rejected').reason.code,
    'CASHIER_PAYROLL_NOTHING_OUTSTANDING',
  );
  assert.equal(
    (await db.query('select count(*)::integer count from cashier_payroll_payment_rewards')).rows[0]
      .count,
    3,
  );
  assert.equal(
    (await db.query('select count(*)::integer count from cashier_payroll_payments')).rows[0].count,
    2,
  );
});

test('failure while assigning rewards rolls back the whole batch so the same idempotency key can retry', async () => {
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  const [row] = (await statement()).items;
  const args = payment(row);
  await db.exec(`create function fixture_reject_payroll_allocation() returns trigger language plpgsql as $$
    begin raise exception 'fixture allocation failure'; end; $$;
    create trigger fixture_reject_payroll_allocation before insert on cashier_payroll_payment_rewards
      for each row execute function fixture_reject_payroll_allocation();`);
  try {
    await assert.rejects(service.markPaid(args), /fixture allocation failure/);
    assert.equal(
      (await db.query('select count(*)::integer count from cashier_payroll_payments')).rows[0]
        .count,
      0,
    );
    assert.equal((await statement()).items[0].outstandingAmount, 300);
  } finally {
    await db.exec(
      'drop trigger fixture_reject_payroll_allocation on cashier_payroll_payment_rewards; drop function fixture_reject_payroll_allocation();',
    );
  }
  assert.equal((await service.markPaid(args)).replayed, false);
});

test('a registration inserted after a paid snapshot was read remains unpaid rather than entering its batch', async () => {
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  const [row] = (await statement()).items;
  // Simulate a concurrently committed registration between the snapshot read
  // and allocations, at the narrow insert boundary inside the transaction.
  const extraId = randomUUID();
  await db.exec(`create function fixture_add_late_payroll_reward() returns trigger language plpgsql as $$
    begin insert into cashier_signup_rewards(id,employee_id,phone_key,employee_name,point_id,branch_name,city,branch_id,completed_at)
      values('${extraId}','10','${'d'.repeat(64)}','Алия Кассир','1','Историческая точка A','Актау','${branchA}','2026-10-05T13:00:00+05:00');
      return new; end; $$;
    create trigger fixture_add_late_payroll_reward after insert on cashier_payroll_payments
      for each row execute function fixture_add_late_payroll_reward();`);
  try {
    const result = await service.markPaid(payment(row));
    assert.equal(result.payment.registrations, 1);
    const after = await statement();
    assert.equal(after.items[0].completed, 2);
    assert.equal(after.items[0].paidAmount, 300);
    assert.equal(after.items[0].outstandingAmount, 300);
    assert.equal(
      (
        await db.query('select * from cashier_payroll_payment_rewards where reward_id=$1', [
          extraId,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.exec(
      'drop trigger fixture_add_late_payroll_reward on cashier_payroll_payments; drop function fixture_add_late_payroll_reward();',
    );
  }
});

test('payroll grants are service-only reads/RPCs and direct changes to ledger/batches/allocations are denied', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['cashier_payroll_payments', 'cashier_payroll_payment_rewards']) {
      assert.equal(
        (await db.query("select has_table_privilege($1,$2,'SELECT') allowed", [role, table]))
          .rows[0].allowed,
        false,
      );
    }
    for (const fn of [
      'cashier_payroll_statement(text,uuid[])',
      'mark_cashier_payroll_paid(text,text,text,uuid,text,uuid[])',
    ]) {
      assert.equal(
        (await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn]))
          .rows[0].allowed,
        false,
      );
    }
  }
  for (const table of [
    'cashier_signup_rewards',
    'cashier_payroll_payments',
    'cashier_payroll_payment_rewards',
  ]) {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(
        (
          await db.query("select has_table_privilege('service_role',$1,$2) allowed", [
            table,
            privilege,
          ])
        ).rows[0].allowed,
        false,
      );
    }
  }
  const definition = (
    await db.query(
      "select pg_get_functiondef('mark_cashier_payroll_paid(text,text,text,uuid,text,uuid[])'::regprocedure) definition",
    )
  ).rows[0].definition;
  assert.match(definition, /pg_advisory_xact_lock\(hashtextextended\('cashier-payroll-key:/);
  assert.match(definition, /pg_advisory_xact_lock\(hashtextextended\('cashier-payroll-row:/);
  const a = cashier(10);
  await sync([a]);
  const id = await seedReward(a);
  const result = await service.markPaid(payment((await statement()).items[0]));
  await assert.rejects(
    db.query('insert into cashier_payroll_payment_rewards(reward_id,payment_id) values($1,$2)', [
      id,
      result.payment.id,
    ]),
    /duplicate key/,
  );
});

test('database rejects invalid month/digests/actor/null scope rather than normalizing or widening access', async () => {
  for (const month of ['2026-00', '2026-13', '2026-1', '0000-01', '2026-10-01', null]) {
    await assert.rejects(statement(month), {
      code: 'CASHIER_PAYROLL_INVALID_REQUEST',
      statusCode: 400,
    });
  }
  await assert.rejects(statement('2026-10', null), {
    code: 'CASHIER_PAYROLL_INVALID_REQUEST',
    statusCode: 400,
  });
  await assert.rejects(statement('2026-10', [null]), {
    code: 'CASHIER_PAYROLL_INVALID_REQUEST',
    statusCode: 400,
  });
  const a = cashier(10);
  await sync([a]);
  await seedReward(a);
  const args = payment((await statement()).items[0]);
  for (const change of [
    { actor: '' },
    { actor: ' ' },
    { actor: 'x'.repeat(161) },
    { actor: null },
    { rowKey: 'invalid' },
    { snapshot: null },
    { idempotencyKey: null },
    { branches: null },
  ]) {
    await assert.rejects(service.markPaid({ ...args, ...change }), {
      code: 'CASHIER_PAYROLL_INVALID_REQUEST',
      statusCode: 400,
    });
  }
  assert.equal(instant('2026-10-01T00:00:00+05:00'), '2026-09-30T19:00:00.000Z');
});
