const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { database } = require('./helpers/photo-report-database.cjs');
const {
  createCashierDirectoryStatus,
} = require('../src/services/cashier-directory-status.service');
const { createCashierSignup } = require('../src/services/cashier-signup.service');
const { publicError } = require('../src/utils/app-error.util');
const pg = new PGlite();
const baseDb = database(pg);
const db = {
  ...baseDb,
  async rpc(name, args) {
    if (name !== 'cashier_signup_ranking') return baseDb.rpc(name, args);
    try {
      const result = await pg.query('select cashier_signup_ranking($1,$2,$3) result', [
        args.p_from,
        args.p_to,
        args.p_branches,
      ]);
      return { data: result.rows[0].result };
    } catch (error) {
      return { error };
    }
  },
};
const status = createCashierDirectoryStatus({ db });
const cashier = {
  id: '1',
  name: 'Алия Кассир',
  pointId: '1',
  branchName: 'Точка',
  city: 'Актау',
  branchId: null,
  isActive: true,
  inviteToken: 'a'.repeat(64),
};
const outage = () => publicError(503, 'STAFF_DIRECTORY_UNAVAILABLE', 'Список временно недоступен.');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test.before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,phone text unique,name text,last_name text,email text,
      gender text,birth_date date,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,name text,city text,active boolean default true);`);
  for (const file of [
    '20260927140000_branch_signup_race.sql',
    '20261003230000_cashier_signup_race.sql',
    '20261003232000_cashier_directory_guarded_update.sql',
    '20261005093000_cashier_signup_review.sql',
    '20261005131000_cashier_directory_sync_status.sql',
  ]) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
});
test.beforeEach(async () => {
  await pg.exec(`delete from cashier_signup_directory; delete from cashier_directory_sync_attempts;
    update cashier_directory_sync_status set last_attempt_id=0,last_result_attempt_id=0,
      last_success_attempt_id=0,last_result_success=null,last_attempt_at=null,last_success_at=null,
      last_failure_at=null,failure_since=null,consecutive_failures=0,cashier_count=null where singleton;
    alter sequence cashier_directory_sync_attempt_seq restart with 1;`);
});
test.after(() => pg.close());

test('first failed sync is durable, sanitized and distinct from a successful empty directory', async () => {
  const initial = await status.getStatus();
  assert.deepEqual(initial, {
    state: 'never',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureSince: null,
    consecutiveFailures: 0,
    cashierCount: null,
  });
  const service = createCashierSignup({
    db,
    directory: {
      listCashiers: async () => {
        throw outage();
      },
    },
  });
  await assert.rejects(service.list(), { code: 'STAFF_DIRECTORY_UNAVAILABLE' });
  const failed = await createCashierDirectoryStatus({ db }).getStatus();
  assert.equal(failed.state, 'error');
  assert.equal(failed.lastSuccessAt, null);
  assert.equal(failed.cashierCount, null);
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.failureSince, failed.lastFailureAt);
  assert.ok(failed.lastAttemptAt);
  const empty = createCashierSignup({ db, directory: { listCashiers: async () => [] } });
  assert.deepEqual((await empty.list()).items, []);
  const recovered = await status.getStatus();
  assert.equal(recovered.state, 'ok');
  assert.equal(recovered.cashierCount, 0);
  assert.ok(recovered.lastSuccessAt);
  assert.equal(recovered.lastFailureAt, failed.lastFailureAt);
  assert.equal(recovered.failureSince, null);
  assert.equal(recovered.consecutiveFailures, 0);
});

test('directory and successful status commit atomically; invalid partial data retains previous roster and count', async () => {
  await status.complete(await status.begin(), [cashier]);
  const previous = await status.getStatus();
  const attempt = await status.begin();
  await assert.rejects(
    status.complete(attempt, [cashier, { ...cashier, id: '2', inviteToken: 'bad' }]),
    { code: 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE' },
  );
  await status.fail(attempt);
  const failed = await status.getStatus();
  assert.equal(failed.state, 'error');
  assert.equal(failed.cashierCount, 1);
  assert.equal(failed.lastSuccessAt, previous.lastSuccessAt);
  assert.deepEqual(
    (await pg.query('select employee_id,invite_token,is_active from cashier_signup_directory'))
      .rows,
    [{ employee_id: '1', invite_token: cashier.inviteToken, is_active: true }],
  );
});

test('late old failure and old success cannot override the newer successful empty snapshot; replay is idempotent', async () => {
  const older = await status.begin();
  const newer = await status.begin();
  await status.complete(newer, []);
  const successful = await status.getStatus();
  await status.fail(older);
  await status.fail(newer);
  assert.deepEqual(await status.getStatus(), successful);
  assert.deepEqual((await status.complete(older, [cashier])).items, []);
  assert.deepEqual((await status.complete(newer, [cashier])).items, []);
  assert.deepEqual(await status.getStatus(), successful);
  assert.deepEqual((await pg.query('select * from cashier_signup_directory')).rows, []);
});

test('a failed success-marker write rolls back the roster together with its health update', async () => {
  await status.complete(await status.begin(), [cashier]);
  const previous = await status.getStatus();
  const attempt = await status.begin();
  await pg.exec(`create function reject_sync_success_marker() returns trigger language plpgsql as $$
      begin raise exception 'status write unavailable'; end; $$;
    create trigger reject_sync_success_marker before update on cashier_directory_sync_status
      for each row when (new.last_success_attempt_id > old.last_success_attempt_id)
      execute function reject_sync_success_marker();`);
  try {
    await assert.rejects(status.complete(attempt, []), {
      code: 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE',
    });
    assert.equal((await status.getStatus()).lastSuccessAt, previous.lastSuccessAt);
    assert.deepEqual(
      (await pg.query('select employee_id,is_active from cashier_signup_directory')).rows,
      [{ employee_id: '1', is_active: true }],
    );
  } finally {
    await pg.exec(
      'drop trigger reject_sync_success_marker on cashier_directory_sync_status; drop function reject_sync_success_marker();',
    );
  }
  await status.fail(attempt);
  assert.equal((await status.getStatus()).state, 'error');
});

test('concurrent failures are counted once; an older success retains the newer failure but clears failures before it', async () => {
  const first = await status.begin();
  const successful = await status.begin();
  const newer = await status.begin();
  const newest = await status.begin();
  await status.fail(newest);
  await status.fail(first);
  await status.fail(newer);
  await status.fail(newer);
  assert.equal((await status.getStatus()).consecutiveFailures, 3);
  await status.complete(successful, [cashier]);
  const current = await status.getStatus();
  assert.equal(current.state, 'error');
  assert.equal(current.cashierCount, 1);
  assert.equal(current.consecutiveFailures, 2);
  assert.ok(current.failureSince);
  const recovered = await status.begin();
  await status.complete(recovered, [cashier]);
  assert.equal((await status.getStatus()).consecutiveFailures, 0);
  assert.equal(
    (await pg.query('select count(*)::integer count from cashier_directory_sync_attempts')).rows[0]
      .count,
    0,
  );
});

test('freshness survives a new service instance and becomes stale at fifteen minutes, including a zero count', async () => {
  await status.complete(await status.begin(), []);
  const restarted = createCashierDirectoryStatus({ db });
  assert.equal((await restarted.getStatus()).state, 'ok');
  await pg.exec(
    "update cashier_directory_sync_status set last_success_at=now()-interval '15 minutes' where singleton",
  );
  const stale = await restarted.getStatus();
  assert.equal(stale.state, 'stale');
  assert.equal(stale.cashierCount, 0);
  await status.fail(await status.begin());
  assert.equal((await restarted.getStatus()).state, 'error');
});

test('admin ranking can inspect a saved complete roster during an outage; public list and live eligibility remain strict', async () => {
  let unavailable = false;
  const directory = {
    listCashiers: async () => {
      if (unavailable) throw outage();
      return [cashier];
    },
    findCashier: async () => {
      if (unavailable) throw outage();
      return cashier;
    },
  };
  const service = createCashierSignup({ db, directory });
  const first = await service.list();
  unavailable = true;
  const saved = await service.ranking({ from: '2026-10-01', to: '2026-10-05', branches: [] });
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].id, cashier.id);
  assert.equal(saved.directoryStatus.state, 'error');
  assert.equal(saved.directoryStatus.cashierCount, 1);
  assert.equal(saved.items[0].inviteToken, first.items[0].inviteToken);
  const scoped = await service.ranking({
    from: '2026-10-01',
    to: '2026-10-05',
    branches: ['00000000-0000-0000-0000-000000000000'],
  });
  assert.equal(scoped.items.length, 0);
  assert.equal(scoped.directoryStatus.cashierCount, null);
  await assert.rejects(service.list(), { code: 'STAFF_DIRECTORY_UNAVAILABLE' });
  await assert.rejects(service.resolve(first.items[0].inviteToken), {
    code: 'STAFF_DIRECTORY_UNAVAILABLE',
  });
  await assert.rejects(
    service.finish({ id: 'unknown' }, {}, first.items[0].inviteToken, 'b'.repeat(64)),
    { code: 'STAFF_DIRECTORY_UNAVAILABLE' },
  );
});

test('first-sync failure cannot return a successful empty ranking, and failed status persistence preserves the original error', async () => {
  const expected = outage();
  const directory = {
    listCashiers: async () => {
      throw expected;
    },
  };
  await assert.rejects(
    createCashierSignup({ db, directory }).ranking({ from: '2026-10-01', to: '2026-10-05' }),
    (error) => error === expected,
  );
  const statusFault = createCashierDirectoryStatus({ db });
  statusFault.fail = async () => {
    throw new Error('Internal status write error');
  };
  await assert.rejects(
    createCashierSignup({ db, directory, status: statusFault }).list(),
    (error) => error === expected,
  );
});

test('singleflight assigns one durable attempt to overlapping ranking/list requests and records the next refresh separately', async () => {
  const entered = deferred();
  const release = deferred();
  let reads = 0;
  const directory = {
    listCashiers: async () => {
      reads++;
      entered.resolve();
      await release.promise;
      return [cashier];
    },
  };
  const service = createCashierSignup({ db, directory });
  const requests = [
    service.list(),
    service.ranking({ from: '2026-10-01', to: '2026-10-05' }),
    service.list(),
  ];
  await entered.promise;
  assert.equal(reads, 1);
  assert.equal(
    (await pg.query('select last_attempt_id::text id from cashier_directory_sync_status')).rows[0]
      .id,
    '1',
  );
  release.resolve();
  await Promise.all(requests);
  await service.list();
  assert.equal(reads, 2);
  assert.equal(
    (await pg.query('select last_attempt_id::text id from cashier_directory_sync_status')).rows[0]
      .id,
    '2',
  );
});

test('client roles cannot read health or attempt metadata and service role cannot mutate tables directly', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['cashier_directory_sync_status', 'cashier_directory_sync_attempts']) {
      assert.equal(
        (await pg.query("select has_table_privilege($1,$2,'SELECT') allowed", [role, table]))
          .rows[0].allowed,
        false,
      );
    }
    for (const fn of [
      'begin_cashier_directory_sync()',
      'sync_cashier_directory_with_status(bigint,jsonb)',
      'fail_cashier_directory_sync(bigint)',
      'get_cashier_directory_sync_status()',
    ]) {
      assert.equal(
        (await pg.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn]))
          .rows[0].allowed,
        false,
      );
    }
  }
  for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.equal(
      (
        await pg.query(
          "select has_table_privilege('service_role','cashier_directory_sync_status',$1) allowed",
          [privilege],
        )
      ).rows[0].allowed,
      false,
    );
  }
});
