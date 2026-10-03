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
        return {
          async range(first, last) {
            calls.push({ name, args, first, last });
            return { data: Array.isArray(rows) ? rows.slice(first, last + 1) : rows, error };
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
    { name: 'bulka_cashier_signup_directory', args: undefined, first: 0, last: 499 },
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
      [500, 999],
      [1000, 1499],
    ],
  );
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
