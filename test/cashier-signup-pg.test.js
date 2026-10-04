const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createStaffDirectory } = require('../src/services/staff-directory.service');
const { createCashierSignup } = require('../src/services/cashier-signup.service');
const { database } = require('./helpers/photo-report-database.cjs');
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
  await db.exec(
    readFileSync('supabase/migrations/20261003232000_cashier_directory_guarded_update.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20261004113000_staff_cashier_branch_mappings.sql', 'utf8'),
  );
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
test('forward migration guards the refresh UPDATE and never rewrites omitted inactive employees', async () => {
  const definition = (
    await db.query(
      "select pg_get_functiondef('public.sync_cashier_signup_directory(jsonb)'::regprocedure) definition",
    )
  ).rows[0].definition;
  assert.match(
    definition,
    /update public\.cashier_signup_directory set is_active = false where is_active;/i,
  );
  await sync([cashierA]);
  const archivedBefore = (
    await db.query("select * from cashier_signup_directory where employee_id='11'")
  ).rows[0];
  await db.exec(`
    create function reject_inactive_directory_rewrite() returns trigger language plpgsql as $$
    begin raise exception 'Already-inactive identity was rewritten'; end; $$;
    create trigger reject_inactive_directory_rewrite before update on cashier_signup_directory
      for each row when (old.is_active = false and new.is_active = false)
      execute function reject_inactive_directory_rewrite();
  `);
  try {
    const refreshed = await sync([{ ...cashierA, inviteToken: 'e'.repeat(64) }]);
    assert.equal(refreshed.items.length, 1);
    assert.equal(refreshed.items[0].invite_token, tokenA);
    assert.deepEqual(
      (await db.query("select * from cashier_signup_directory where employee_id='11'")).rows[0],
      archivedBefore,
    );
    // Restoring an active identity still reuses its permanent QR token.
    assert.equal(
      (await sync([cashierA, cashierB])).items.find((item) => item.employee_id === '11')
        .invite_token,
      tokenB,
    );
  } finally {
    await db.exec(
      'drop trigger reject_inactive_directory_rewrite on cashier_signup_directory; drop function reject_inactive_directory_rewrite();',
    );
    await sync([cashierA, cashierB]);
  }
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

test('reviewed point mapping fills missing historical scope without moving known rewards', async () => {
  const employee = {
    ...cashierA,
    id: '13',
    pointId: '13',
    branchId: null,
    inviteToken: 'f'.repeat(64),
  };
  await sync([cashierA, cashierB, employee]);
  const p = await person();
  await finish(p, employee);
  assert.equal(
    (await ranking([branch])).some((row) => row.id === employee.id),
    false,
  );
  await db.query(
    "insert into staff_cashier_branch_mappings(point_id,branch_id,reviewed_by) values('13',$1,'audit')",
    [branch],
  );
  assert.equal((await rewards(p))[0].branch_id, branch);
  const included = (await ranking([branch])).find((row) => row.id === employee.id);
  assert.equal(included.completed, 1);
  assert.equal(included.rewardAmount, 300);
  await db.query("update staff_cashier_branch_mappings set branch_id=$1 where point_id='13'", [
    secondBranch,
  ]);
  assert.equal((await rewards(p))[0].branch_id, branch, 'an existing historical UUID never moves');
  await sync([cashierA, cashierB, { ...employee, branchId: secondBranch }]);
  assert.equal((await ranking([branch])).find((row) => row.id === employee.id).completed, 1);
  assert.equal((await ranking([secondBranch])).find((row) => row.id === employee.id).completed, 0);
  await sync([cashierA, cashierB]);
});

test('canonical HR source plus reviewed mapping reaches branch-scoped 300 KZT attribution', async () => {
  await db.query(
    "insert into staff_cashier_branch_mappings(point_id,branch_id,reviewed_by) values('14',$1,'audit')",
    [branch],
  );
  const directory = createStaffDirectory({
    mappingDb: database(db),
    client: {
      rpc(name) {
        assert.equal(name, 'bulka_cashier_signup_directory');
        return {
          order(field) {
            assert.equal(field, 'id');
            return this;
          },
          gt(field) {
            assert.equal(field, 'id');
            return this;
          },
          range: async () => ({
            data: [
              {
                id: '14',
                name: 'Кассир из HR',
                point_id: '14',
                branch_name: 'Точка 1',
                city: 'Актау',
              },
            ],
          }),
        };
      },
    },
  });
  const [imported] = await directory.listCashiers();
  assert.equal(imported.branchId, branch);
  const employee = { ...imported, inviteToken: 'e'.repeat(64) };
  await sync([cashierA, cashierB, employee]);
  const p = await person();
  await finish(
    p,
    await directory
      .findCashier('14')
      .then((row) => ({ ...row, inviteToken: employee.inviteToken })),
  );
  const row = (await ranking([branch])).find((row) => row.id === employee.id);
  assert.equal(row.completed, 1);
  assert.equal(row.rewardAmount, 300);
  assert.equal(
    (await ranking([secondBranch])).some((row) => row.id === employee.id),
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

test('canonical source refresh follows hire, transfer, archive, deletion and restore without changing QR or earned history', async () => {
  await db.exec(`
    create table public.points(id bigint primary key, name text, city text);
    create table public.bulka_users(id bigint primary key, display_name text, first_name text,
      last_name text, position text, point_id bigint, role text, is_deleted boolean, deleted_at timestamptz);
    insert into public.points values (501,'Кадровая точка A','Актау'),(502,'Кадровая точка B','Астана');
    insert into public.bulka_users values (9001,'Кассир Первый',null,null,'Кассир',501,'cashier',false,null);
  `);
  await db.exec(readFileSync('docs/integrations/cashier-directory-source.sql', 'utf8'));
  await db.query(
    `insert into staff_cashier_branch_mappings(point_id,branch_id,reviewed_by)
    values('501',$1,'test'),('502',$2,'test')`,
    [branch, secondBranch],
  );
  const directory = createStaffDirectory({
    mappingDb: database(db),
    client: {
      rpc(name) {
        assert.equal(name, 'bulka_cashier_signup_directory');
        let cursor = null;
        return {
          order(field) {
            assert.equal(field, 'id');
            return this;
          },
          gt(field, value) {
            assert.equal(field, 'id');
            cursor = value;
            return this;
          },
          async range(first, last) {
            assert.equal(first, 0);
            const result = await db.query(
              `select * from public.bulka_cashier_signup_directory()
              where ($1::text is null or id > $1) order by id limit $2`,
              [cursor, last + 1],
            );
            return { data: result.rows };
          },
        };
      },
    },
  });
  const service = createCashierSignup({ db: database(db), directory });
  try {
    const hired = (await service.list()).items;
    assert.equal(hired.length, 1);
    const original = hired[0];
    assert.equal(original.id, '9001');
    const firstCustomer = await person();
    await service.finish(
      firstCustomer,
      { name: 'Первый Клиент' },
      original.inviteToken,
      firstCustomer.key,
    );
    const firstReward = (await rewards(firstCustomer))[0];
    assert.equal(firstReward.amount, 300);
    assert.equal(firstReward.branch_id, branch);

    await db.exec(
      "update public.bulka_users set display_name='Кассир Новое Имя',point_id=502 where id=9001",
    );
    const transferred = (await service.list()).items[0];
    assert.equal(transferred.inviteToken, original.inviteToken);
    assert.equal(transferred.name, 'Кассир Новое Имя');
    assert.equal(transferred.branchName, 'Кадровая точка B');
    assert.equal(transferred.city, 'Астана');
    assert.equal((await service.resolve(original.inviteToken)).branchId, secondBranch);
    assert.deepEqual((await rewards(firstCustomer))[0], firstReward);
    const secondCustomer = await person();
    await service.finish(
      secondCustomer,
      { name: 'Второй Клиент' },
      original.inviteToken,
      secondCustomer.key,
    );
    assert.equal((await rewards(secondCustomer))[0].branch_id, secondBranch);

    await db.exec('update public.bulka_users set is_deleted=true where id=9001');
    assert.deepEqual((await service.list()).items, []);
    await assert.rejects(service.resolve(original.inviteToken), {
      code: 'CASHIER_INVITE_UNAVAILABLE',
    });
    const archived = (await ranking()).find((row) => row.id === original.id);
    assert.equal(archived.isArchived, true);
    assert.equal(archived.inviteToken, null);
    assert.equal(archived.completed, 2);
    assert.equal(archived.rewardAmount, 600);
    assert.deepEqual((await rewards(firstCustomer))[0], firstReward);

    await db.exec('update public.bulka_users set is_deleted=false where id=9001');
    assert.equal((await service.list()).items[0].inviteToken, original.inviteToken);
    await db.exec('update public.bulka_users set deleted_at=now() where id=9001');
    assert.deepEqual((await service.list()).items, []);
    await assert.rejects(service.resolve(original.inviteToken), {
      code: 'CASHIER_INVITE_UNAVAILABLE',
    });
    await db.exec('delete from public.bulka_users where id=9001');
    assert.deepEqual((await service.list()).items, []);
    await assert.rejects(service.resolve(original.inviteToken), {
      code: 'CASHIER_INVITE_UNAVAILABLE',
    });

    await db.exec(`insert into public.bulka_users values
      (9001,'Кассир Восстановлен',null,null,'Кассир',502,'cashier',false,null),
      (9002,'Новый Сотрудник',null,null,'Кассир',501,'cashier',false,null)`);
    const restored = (await service.list()).items;
    assert.equal(restored.length, 2);
    assert.equal(restored.find((row) => row.id === original.id).inviteToken, original.inviteToken);
    assert.notEqual(restored.find((row) => row.id === '9002').inviteToken, original.inviteToken);
    assert.equal((await ranking()).find((row) => row.id === original.id).rewardAmount, 600);
    assert.deepEqual((await rewards(firstCustomer))[0], firstReward);
  } finally {
    await sync([cashierA, cashierB]);
  }
});
