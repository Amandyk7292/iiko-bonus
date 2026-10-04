const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { database } = require('./helpers/photo-report-database.cjs');
const { calendar } = require('../src/services/branch-photo-reports.service');
const { approvedDeviceCounts } = require('../src/services/branch-photo-device-summary.service');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

test('calendar counts only authorized tablets within the admin branch scope, without exposing credentials', async (t) => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    create table bulka_locations(id uuid primary key,name text,city text,active boolean,sort_order int,
      round_the_clock boolean,photo_day_shift_start text,photo_night_shift_start text);
    create table branch_closing_reports(id uuid,branch_id uuid,business_date date);
    create table branch_closing_devices(id int,branch_id uuid,status text,last_seen_at timestamptz,token_hash text);
    insert into bulka_locations(id,name,city,active,sort_order) values
      ('${A}','Точка А','Актау',true,0),('${B}','Точка Б','Астана',true,1),('${C}','Точка В','Актау',true,2);
    insert into branch_closing_devices values
      (1,'${A}','active','2020-01-01','private-token'),(2,'${A}','active',null,'another-private-token'),
      (3,'${B}','pending',now(),'pending-token'),(4,'${B}','revoked',now(),'revoked-token'),
      (5,'${C}','active',now(),'out-of-scope-token');
  `);
  const calls = [];
  const original = database(pg);
  const db = {
    from(table) {
      calls.push(table);
      return original.from(table);
    },
  };
  const result = await calendar({ role: 'viewer', branchIds: [A, B] }, {}, { db });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.approvedDeviceCount]),
    [
      [A, 2],
      [B, 0],
    ],
  );
  assert.equal(calls.filter((table) => table === 'branch_closing_devices').length, 1);
  assert.equal(JSON.stringify(result).includes('token'), false);
  calls.length = 0;
  assert.deepEqual((await calendar({ role: 'viewer', branchIds: [] }, {}, { db })).branches, []);
  assert.equal(calls.includes('branch_closing_devices'), false);
  const broken = {
    from(table) {
      if (table !== 'branch_closing_devices') return original.from(table);
      const query = {
        then(resolve) {
          return Promise.resolve({ error: new Error('Unavailable') }).then(resolve);
        },
      };
      for (const name of ['select', 'eq', 'in', 'order', 'range']) query[name] = () => query;
      return query;
    },
  };
  const unknown = await calendar({ role: 'owner' }, {}, { db: broken });
  assert.equal(
    unknown.branches.length,
    3,
    'reports remain available when the optional summary fails',
  );
  assert.ok(unknown.branches.every((b) => b.approvedDeviceCount === null));
});

test('tablet summary pages all active rows in batches and never treats partial failure as zero', async () => {
  const calls = [];
  let failSecond = false;
  const db = {
    from(table) {
      assert.equal(table, 'branch_closing_devices');
      let offset;
      const query = {
        select(fields) {
          assert.equal(fields, 'branch_id');
          return this;
        },
        eq(key, value) {
          assert.deepEqual([key, value], ['status', 'active']);
          return this;
        },
        in(key, ids) {
          assert.deepEqual([key, ids], ['branch_id', [A, B]]);
          return this;
        },
        order(key) {
          assert.equal(key, 'id');
          return this;
        },
        range(first, last) {
          offset = first;
          calls.push([first, last]);
          return this;
        },
        then(resolve) {
          return Promise.resolve(
            offset === 0
              ? { data: Array(1000).fill({ branch_id: A }) }
              : failSecond
                ? { error: new Error('Second page unavailable') }
                : { data: [{ branch_id: B }] },
          ).then(resolve);
        },
      };
      return query;
    },
  };
  assert.deepEqual(
    [...(await approvedDeviceCounts([A, B], { db }))],
    [
      [A, 1000],
      [B, 1],
    ],
  );
  assert.deepEqual(calls, [
    [0, 999],
    [1000, 1999],
  ]);
  failSecond = true;
  assert.equal(await approvedDeviceCounts([A, B], { db }), null);
});
