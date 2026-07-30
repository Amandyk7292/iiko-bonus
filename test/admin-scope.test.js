const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyAdminBranchSelection,
  branchScopeForAdmin,
} = require('../src/utils/admin-scope.util');

const branchA = '11111111-1111-4111-8111-111111111111';
const branchB = '22222222-2222-4222-8222-222222222222';
const branchC = '33333333-3333-4333-8333-333333333333';

test('city scope keeps every requested branch for globally scoped admins', () => {
  const selected = applyAdminBranchSelection(
    { role: 'owner', branchIds: [] },
    '',
    `${branchA},${branchB}`,
  );
  assert.equal(selected.selectedBranchId, null);
  assert.deepEqual(selected.selectedBranchIds, [branchA, branchB]);
  assert.deepEqual(branchScopeForAdmin(selected), [branchA, branchB]);
});

test('city scope permits only branches assigned to restricted staff', () => {
  const admin = { role: 'operator', branchIds: [branchA, branchB] };
  assert.deepEqual(
    branchScopeForAdmin(applyAdminBranchSelection(admin, '', `${branchA},${branchB}`)),
    [branchA, branchB],
  );
  assert.throws(
    () => applyAdminBranchSelection(admin, '', `${branchA},${branchC}`),
    (error) => error.statusCode === 403,
  );
});

test('city scope rejects malformed and ambiguous branch headers', () => {
  const admin = { role: 'owner', branchIds: [] };
  assert.throws(
    () => applyAdminBranchSelection(admin, '', 'not-a-branch'),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => applyAdminBranchSelection(admin, branchA, branchB),
    (error) => error.statusCode === 400,
  );
});
