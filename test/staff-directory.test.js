const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createStaffDirectory: directoryFactory,
} = require('../src/services/staff-directory.service');
const mappings = (rows = [], error = null) => ({
  from(table) {
    assert.equal(table, 'staff_cashier_branch_mappings');
    return {
      select() {
        return this;
      },
      order() {
        return this;
      },
      async range(first, last) {
        return { data: rows.slice(first, last + 1), error };
      },
    };
  },
});
const createStaffDirectory = (options) => directoryFactory({ mappingDb: mappings(), ...options });
const employee = {
  id: '123',
  name: 'Алия Кассир',
  point_id: '4',
  branch_name: 'ЖК Жасыл дала',
  city: 'Актау',
};
function fixture(rows = [employee], error = null) {
  const calls = [];
  return {
    calls,
    client: {
      from() {
        assert.fail('HR tables must not be queried');
      },
      rpc(name, args) {
        let afterId = null;
        let order = null;
        return {
          order(field) {
            assert.equal(field, 'id');
            order = field;
            return this;
          },
          gt(field, value) {
            assert.equal(field, 'id');
            afterId = value;
            return this;
          },
          async range(first, last) {
            calls.push({ name, args, order, afterId, first, last });
            const sorted = Array.isArray(rows)
              ? rows
                  .filter((row) => afterId == null || String(row.id) > afterId)
                  .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))
              : rows;
            return { data: Array.isArray(sorted) ? sorted.slice(first, last + 1) : sorted, error };
          },
        };
      },
    },
  };
}
test('source access is limited to the dedicated public-fields RPC with string bigint identities', async () => {
  const f = fixture();
  const rows = await createStaffDirectory({ client: f.client }).listCashiers();
  assert.deepEqual(rows, [
    {
      id: '123',
      name: employee.name,
      pointId: '4',
      branchName: employee.branch_name,
      city: employee.city,
      branchId: null,
      isActive: true,
    },
  ]);
  assert.deepEqual(f.calls, [
    {
      name: 'bulka_cashier_signup_directory',
      args: undefined,
      order: 'id',
      afterId: null,
      first: 0,
      last: 499,
    },
  ]);
});
test('every eligibility lookup rechecks source omission after archive or role changes', async () => {
  const rows = [employee];
  const f = fixture(rows);
  const directory = createStaffDirectory({ client: f.client });
  assert.equal((await directory.findCashier('123')).name, employee.name);
  rows.length = 0;
  assert.equal(await directory.findCashier('123'), null);
  assert.equal(f.calls.length, 2);
});
test('missing configuration, denied/missing RPC and source errors fail closed without revealing details', async () => {
  await assert.rejects(createStaffDirectory({ env: {} }).listCashiers(), {
    statusCode: 503,
    code: 'STAFF_DIRECTORY_UNAVAILABLE',
  });
  for (const error of [
    { code: 'PGRST202', message: 'RPC missing' },
    { code: '42501', message: 'Access denied' },
    { message: 'secret database failure' },
  ]) {
    await assert.rejects(
      createStaffDirectory({ client: fixture(null, error).client }).listCashiers(),
      (failure) => failure.statusCode === 503 && !failure.message.includes('secret'),
    );
  }
});
test('source validation rejects malformed/duplicate identities, excess results and missing display fields', async () => {
  for (const rows of [
    [{ ...employee, id: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...employee, id: '0' }],
    [employee, employee],
    [{ ...employee, point_id: 'invalid' }],
    [{ ...employee, name: '' }],
    [{ ...employee, city: 'x'.repeat(121) }],
    Array.from({ length: 20001 }, (_, index) => ({ ...employee, id: String(index + 1) })),
  ]) {
    await assert.rejects(createStaffDirectory({ client: fixture(rows).client }).listCashiers(), {
      code: 'STAFF_DIRECTORY_UNAVAILABLE',
    });
  }
});
test('an authorized empty directory is valid and a roster beyond one thousand is not truncated', async () => {
  assert.deepEqual(await createStaffDirectory({ client: fixture([]).client }).listCashiers(), []);
  const rows = Array.from({ length: 1003 }, (_, index) => ({ ...employee, id: String(index + 1) }));
  const f = fixture(rows);
  assert.equal((await createStaffDirectory({ client: f.client }).listCashiers()).length, 1003);
  assert.deepEqual(
    f.calls.map(({ first, last }) => [first, last]),
    [
      [0, 499],
      [0, 499],
      [0, 499],
    ],
  );
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  assert.deepEqual(
    f.calls.map((call) => call.afterId),
    [null, sorted[499].id, sorted[999].id],
  );
});

test('an archive and rename between pages do not shift an active cashier out of the roster', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    ...employee,
    id: String(1001 + index),
  }));
  const f = fixture(rows);
  const rpc = f.client.rpc.bind(f.client);
  let changed = false;
  f.client.rpc = (...args) => {
    const query = rpc(...args);
    const range = query.range.bind(query);
    query.range = async (...limits) => {
      const response = await range(...limits);
      if (!changed) {
        changed = true;
        rows.shift();
        rows.at(-1).name = 'Имя теперь первым по алфавиту';
      }
      return response;
    };
    return query;
  };
  const directory = createStaffDirectory({ client: f.client });
  const imported = await directory.listCashiers();
  assert.equal(imported.length, 501);
  assert.ok(
    imported.some((row) => row.id === '1501'),
    'last active ID is not skipped after archive',
  );
  assert.ok(rows.every((row) => imported.some((item) => item.id === row.id)));
  assert.deepEqual(
    f.calls.map((call) => call.afterId),
    [null, '1500'],
  );
  assert.equal(
    await directory.findCashier('1001'),
    null,
    'fresh eligibility rejects the newly archived ID',
  );
});

test('an ID hired below an in-progress cursor is included by the next fresh read', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    ...employee,
    id: String(1001 + index),
  }));
  const f = fixture(rows);
  const rpc = f.client.rpc.bind(f.client);
  let hired = false;
  f.client.rpc = (...args) => {
    const query = rpc(...args);
    const range = query.range.bind(query);
    query.range = async (...limits) => {
      const response = await range(...limits);
      if (!hired) {
        hired = true;
        rows.unshift({ ...employee, id: '1000' });
      }
      return response;
    };
    return query;
  };
  const directory = createStaffDirectory({ client: f.client });
  const first = await directory.listCashiers();
  assert.equal(first.length, 501);
  assert.ok(first.some((row) => row.id === '1501'));
  assert.equal(
    first.some((row) => row.id === '1000'),
    false,
  );
  const next = await directory.listCashiers();
  assert.equal(next.length, 502);
  assert.ok(next.some((row) => row.id === '1000'));
});
test('active cashier without an assigned point keeps their QR identity and useful display fallbacks', async () => {
  const directory = createStaffDirectory({
    client: fixture([{ ...employee, point_id: null, branch_name: '', city: '' }]).client,
  });
  const [row] = await directory.listCashiers();
  assert.equal(row.id, '123');
  assert.equal(row.pointId, null);
  assert.equal(row.branchName, 'Точка не назначена');
  assert.equal(row.city, 'Не указан');
});

test('only reviewed point IDs establish customer branch scope; identical names do not', async () => {
  const branch = '11111111-1111-4111-8111-111111111111';
  const f = fixture([employee, { ...employee, id: '124', point_id: '5' }]);
  const directory = createStaffDirectory({
    client: f.client,
    mappingDb: mappings([{ point_id: '4', branch_id: branch }]),
  });
  const rows = await directory.listCashiers();
  assert.equal(rows[0].branchId, branch);
  assert.equal(rows[1].branchId, null);
  assert.equal((await directory.findCashier('123')).branchId, branch);
});

test('mapping failures and malformed identities cannot silently remove branch permissions', async () => {
  for (const mappingDb of [
    mappings([], { message: 'source secret' }),
    mappings([{ point_id: '4', branch_id: 'bad' }]),
    mappings([
      { point_id: '4', branch_id: '11111111-1111-4111-8111-111111111111' },
      { point_id: '4', branch_id: '22222222-1111-4111-8111-111111111111' },
    ]),
  ]) {
    await assert.rejects(
      createStaffDirectory({ client: fixture().client, mappingDb }).listCashiers(),
      {
        statusCode: 503,
        code: 'STAFF_DIRECTORY_UNAVAILABLE',
      },
    );
  }
});
