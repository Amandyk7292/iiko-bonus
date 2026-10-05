const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createCashierPayroll } = require('../src/services/cashier-payroll.service');
const {
  payrollMonthSchema,
  payrollReportQuerySchema,
  payrollPaymentBodySchema,
} = require('../src/contracts/cashier-payroll.contract');

const input = {
  month: '2026-10',
  rowKey: 'a'.repeat(64),
  snapshot: 'b'.repeat(64),
  idempotencyKey: randomUUID(),
};

test('strict payroll contracts accept only a real YYYY-MM and server-verifiable payment identifiers', () => {
  assert.deepEqual(payrollPaymentBodySchema.parse(input), input);
  assert.deepEqual(payrollReportQuerySchema.parse({ month: input.month }), { month: input.month });
  for (const month of [
    '2026-0',
    '2026-1',
    '2026-00',
    '2026-13',
    '0000-01',
    '2026-10-01',
    '2026-10 ',
    '',
    undefined,
    ['2026-10'],
  ]) {
    assert.equal(payrollMonthSchema.safeParse(month).success, false, String(month));
  }
  for (const change of [
    { rowKey: '123' },
    { rowKey: 'A'.repeat(64) },
    { snapshot: null },
    { idempotencyKey: '123' },
    { amount: 900 },
    { actor: 'forged' },
    { branchIds: [randomUUID()] },
    { employeeId: '10' },
    { registrations: 10 },
  ]) {
    assert.equal(payrollPaymentBodySchema.safeParse({ ...input, ...change }).success, false);
  }
  assert.equal(
    payrollReportQuerySchema.safeParse({ month: input.month, branches: [] }).success,
    false,
  );
});

test('service forwards the trusted actor/scope, uses database statement only and returns payment replay status', async () => {
  const calls = [];
  const service = createCashierPayroll({
    db: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data:
            name === 'cashier_payroll_statement'
              ? { month: input.month, items: [], totals: {} }
              : { payment: { id: 'payment', amount: 300 }, replayed: true },
        };
      },
    },
  });
  const branch = randomUUID();
  assert.equal(
    (await service.statement({ month: input.month, branches: [branch] })).month,
    input.month,
  );
  assert.deepEqual(calls[0], {
    name: 'cashier_payroll_statement',
    args: { p_month: input.month, p_branches: [branch] },
  });
  const result = await service.markPaid({ ...input, actor: 'verified-owner', branches: [branch] });
  assert.equal(result.replayed, true);
  assert.deepEqual(calls[1], {
    name: 'mark_cashier_payroll_paid',
    args: {
      p_month: input.month,
      p_row_key: input.rowKey,
      p_snapshot: input.snapshot,
      p_idempotency_key: input.idempotencyKey,
      p_actor: 'verified-owner',
      p_branches: [branch],
    },
  });
  await service.statement({ month: input.month });
  assert.deepEqual(calls[2].args.p_branches, []);
});

test('known SQL conflicts are safe public errors while unexpected database failures remain internal', async () => {
  for (const code of [
    'CASHIER_PAYROLL_SNAPSHOT_CHANGED',
    'CASHIER_PAYROLL_NOTHING_OUTSTANDING',
    'CASHIER_PAYROLL_IDEMPOTENCY_CONFLICT',
  ]) {
    const service = createCashierPayroll({
      db: { rpc: async () => ({ error: { code: 'P0001', message: code } }) },
    });
    await assert.rejects(
      service.markPaid({ ...input, actor: 'owner' }),
      (error) =>
        error.statusCode === 409 &&
        error.code === code &&
        error.expose &&
        !error.message.includes('P0001'),
    );
  }
  const unique = createCashierPayroll({
    db: { rpc: async () => ({ error: { code: '23505', message: 'private constraint' } }) },
  });
  await assert.rejects(unique.markPaid({ ...input, actor: 'owner' }), {
    code: 'CASHIER_PAYROLL_SNAPSHOT_CHANGED',
    statusCode: 409,
  });
  const invalid = createCashierPayroll({
    db: { rpc: async () => ({ error: { code: '22023', message: 'private database validation' } }) },
  });
  await assert.rejects(invalid.statement({ month: 'bad' }), {
    code: 'CASHIER_PAYROLL_INVALID_REQUEST',
    statusCode: 400,
  });
  const secretFailure = { code: 'XX000', message: 'private database internals' };
  const broken = createCashierPayroll({ db: { rpc: async () => ({ error: secretFailure }) } });
  await assert.rejects(
    broken.statement({ month: input.month }),
    (error) => error === secretFailure,
  );
});
