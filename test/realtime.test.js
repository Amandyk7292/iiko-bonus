const assert = require('node:assert/strict');
const test = require('node:test');

const realtime = require('../src/services/realtime.service');

const admin = (overrides = {}) => ({
  admin: true,
  role: 'operator',
  areas: ['orders'],
  branchIds: [],
  selectedBranchId: null,
  globalBranchAccess: false,
  ...overrides,
});

const orderEvent = (overrides = {}) => ({
  type: 'order.updated',
  audience: {
    includeAdmins: true,
    customerId: 'customer-a',
    branchId: 'branch-a',
  },
  ...overrides,
});

test('realtime keeps restricted and unassigned staff out of branch events', () => {
  assert.equal(realtime.canReceive(admin(), orderEvent()), false);
  assert.equal(
    realtime.canReceive(admin({ branchIds: ['branch-a'] }), orderEvent()),
    true,
  );
  assert.equal(
    realtime.canReceive(admin({ branchIds: ['branch-b'] }), orderEvent()),
    false,
  );
});

test('realtime applies the selected branch even for globally scoped administrators', () => {
  assert.equal(
    realtime.canReceive(
      admin({ role: 'owner', areas: ['*'], globalBranchAccess: true }),
      orderEvent(),
    ),
    true,
  );
  assert.equal(
    realtime.canReceive(
      admin({
        role: 'owner',
        areas: ['*'],
        globalBranchAccess: true,
        selectedBranchId: 'branch-b',
      }),
      orderEvent(),
    ),
    false,
  );
});

test('realtime isolates customers and respects admin feature areas', () => {
  assert.equal(
    realtime.canReceive({ customerId: 'customer-a', admin: false }, orderEvent()),
    true,
  );
  assert.equal(
    realtime.canReceive({ customerId: 'customer-b', admin: false }, orderEvent()),
    false,
  );
  assert.equal(
    realtime.canReceive(admin({ areas: ['support'], branchIds: ['branch-a'] }), orderEvent()),
    false,
  );
});

test('admin-only events never reach customer streams', () => {
  assert.equal(
    realtime.canReceive(
      { customerId: 'customer-a', admin: false },
      {
        type: 'support.updated',
        audience: { adminOnly: true },
      },
    ),
    false,
  );
});
