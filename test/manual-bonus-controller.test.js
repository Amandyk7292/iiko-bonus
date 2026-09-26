const assert = require('node:assert/strict');
const test = require('node:test');
const { supabase } = require('../src/config/supabase');
const customers = require('../src/services/customer.service');
const branchId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';

test('manual bonus duplicate preserves selected owner branch and skips repeat notifications', async (t) => {
  const calls = [];
  t.mock.method(customers, 'addManualBonus', async (...args) => {
    calls.push(args);
    return { balance: 125, duplicate: true };
  });
  const recipientRead = t.mock.method(supabase, 'from', () => {
    throw new Error('Duplicate must not read notification recipients');
  });
  const controllerPath = require.resolve('../src/controllers/admin.controller');
  delete require.cache[controllerPath];
  const { addBonusHandler } = require(controllerPath);
  const response = {
    statusCode: 200,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await addBonusHandler(
    {
      admin: { role: 'owner', branchIds: [], selectedBranchIds: [branchId] },
      body: { customerId, operationId, amount: 25, reason: 'Manual correction' },
    },
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true });
  assert.equal(recipientRead.mock.callCount(), 0);
  assert.deepEqual(calls, [[customerId, 25, 'Manual correction', { branchId, operationId }]]);
  delete require.cache[controllerPath];
});

test('manual bonus service forwards identity and maps reservation/payload conflicts', async (t) => {
  const calls = [];
  let result = { data: { balance: 125, duplicate: true }, error: null };
  t.mock.method(supabase, 'rpc', async (...args) => {
    calls.push(args);
    return result;
  });
  assert.deepEqual(
    await customers.addManualBonus(customerId, 25, 'Manual correction', { branchId, operationId }),
    result.data,
  );
  assert.deepEqual(calls[0], [
    'apply_manual_bonus_once',
    {
      p_operation_id: operationId,
      p_customer_id: customerId,
      p_amount_change: 25,
      p_reason: 'Manual correction',
      p_branch_id: branchId,
    },
  ]);
  for (const [message, code] of [
    ['manual bonus idempotency conflict', 'MANUAL_BONUS_IDEMPOTENCY_CONFLICT'],
    ['manual bonus balance is reserved', 'MANUAL_BONUS_BALANCE_RESERVED'],
  ]) {
    result = { data: null, error: { message } };
    await assert.rejects(
      customers.addManualBonus(customerId, 25, 'Manual correction', { branchId, operationId }),
      { statusCode: 409, code },
    );
  }
});
