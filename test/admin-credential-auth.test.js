const assert = require('node:assert/strict');
const test = require('node:test');

const {
  authenticateCashier,
  createCashierAccess,
  isValidCashierPassword,
  isValidCashierUsername,
  resetCashierPassword,
  updateCashierAccess,
} = require('../src/services/admin-credential-auth.service');

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const VALID_HASH = '$2b$12$4ojkOJkkZ0OkGMSV5W8oKuR0nm4G9Djwrn1XF.7z9KqNhxQH1Ugkq';

test('cashier username and password rules reject weak credentials', () => {
  assert.equal(isValidCashierUsername('cashier.aktau-1'), true);
  assert.equal(isValidCashierUsername('+77001234567'), false);
  assert.equal(isValidCashierPassword('Bulka2026Secure'), true);
  assert.equal(isValidCashierPassword('onlyletters'), false);
  assert.equal(isValidCashierPassword('1234567890'), false);
});

test('cashier password login requires an active cashier assigned to exactly one branch', async () => {
  const rows = {
    credential: {
      username: 'cashier.aktau',
      password_hash: VALID_HASH,
      auth_version: 1,
      role: 'cashier',
      branch_ids: [BRANCH_ID],
      active: true,
    },
  };
  const rpcCalls = [];
  const db = {
    rpc: async (name, params) => {
      rpcCalls.push({ name, params });
      return { data: rows.credential ? [rows.credential] : [], error: null };
    },
  };
  const bcryptImpl = {
    compare: async (password, hash) => password === 'Bulka2026Secure' && hash === VALID_HASH,
  };

  assert.deepEqual(
    await authenticateCashier(' Cashier.Aktau ', 'Bulka2026Secure', { db, bcryptImpl }),
    {
      username: 'cashier.aktau',
      role: 'cashier',
      branchIds: [BRANCH_ID],
      authVersion: 1,
    },
  );
  assert.deepEqual(rpcCalls[0], {
    name: 'get_cashier_auth_record',
    params: { p_username: 'cashier.aktau' },
  });
  assert.equal(
    await authenticateCashier('cashier.aktau', 'wrong-password', { db, bcryptImpl }),
    null,
  );

  rows.credential.branch_ids = [BRANCH_ID, '22222222-2222-4222-8222-222222222222'];
  assert.equal(
    await authenticateCashier('cashier.aktau', 'Bulka2026Secure', { db, bcryptImpl }),
    null,
  );
});

test('cashier creation and password reset only send hashes to database RPCs', async () => {
  const calls = [];
  const db = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return {
        data: ['create_cashier_access', 'update_cashier_access'].includes(name)
          ? {
              username: params.p_username,
              display_name: params.p_display_name,
              role: 'cashier',
              branch_ids: [params.p_branch_id],
              active: params.p_active ?? true,
            }
          : true,
        error: null,
      };
    },
  };
  const bcryptImpl = { hash: async () => VALID_HASH };

  const profile = await createCashierAccess(
    {
      username: 'Cashier.Aktau',
      displayName: 'Кассир Актау',
      branchId: BRANCH_ID,
      password: 'Bulka2026Secure',
    },
    { db, bcryptImpl },
  );
  assert.equal(profile.username, 'cashier.aktau');
  assert.equal(calls[0].name, 'create_cashier_access');
  assert.equal(calls[0].params.p_password_hash, VALID_HASH);
  assert.equal(JSON.stringify(calls[0]).includes('Bulka2026Secure'), false);

  assert.equal(
    await resetCashierPassword('cashier.aktau', 'NewBulka2027', { db, bcryptImpl }),
    true,
  );
  assert.equal(calls[1].name, 'reset_cashier_password');
  assert.equal(calls[1].params.p_password_hash, VALID_HASH);

  const updated = await updateCashierAccess(
    {
      username: 'cashier.aktau',
      displayName: 'Кассир Актау',
      branchId: BRANCH_ID,
      active: false,
    },
    { db },
  );
  assert.equal(updated.active, false);
  assert.deepEqual(calls[2], {
    name: 'update_cashier_access',
    params: {
      p_username: 'cashier.aktau',
      p_display_name: 'Кассир Актау',
      p_branch_id: BRANCH_ID,
      p_active: false,
    },
  });
});
