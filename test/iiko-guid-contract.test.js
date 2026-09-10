const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { activatePosSchema } = require('../src/contracts/pos-pairing.contract');
const { frontInventorySnapshotSchema } = require('../src/contracts/front-inventory.contract');
const {
  frontOrderPollSchema,
  frontOrderDecisionSchema,
} = require('../src/contracts/front-order-inbox.contract');
const {
  frontStockHeartbeatSchema,
  frontReceiptLookupSchema,
  frontStockSaleSchema,
  frontStockFinishSchema,
  frontStockRecountSchema,
} = require('../src/contracts/front-stock-guard.contract');

// iiko/.NET Guid values need not carry the RFC UUID version or variant bits.
const terminalId = 'a1234567-1234-0123-0123-123456789abc';
const terminalGroupId = 'b1234567-1234-f123-c123-123456789abc';
const productId = 'c1234567-1234-4123-1123-123456789abc';
const receiptId = 'd1234567-1234-e123-8123-123456789abc';
const item = { productId, quantity: 5 };
const stockItem = { ...item, productName: 'Булочка' };
const sale = { terminalId, receiptId, items: [item], total: 1000 };
const activation = {
  code: '123456',
  terminalId,
  terminalGroupId,
  terminalName: 'Касса 1',
  terminalToken: 'pt1_' + 'a'.repeat(64),
};
const cases = [
  ['activation', activatePosSchema, activation],
  ['order polling', frontOrderPollSchema, { terminalId }],
  [
    'order acceptance',
    frontOrderDecisionSchema,
    { terminalId, orderId: randomUUID(), action: 'accept' },
  ],
  ['heartbeat', frontStockHeartbeatSchema, { terminalId, connected: true }],
  ['receipt lookup', frontReceiptLookupSchema, { terminalId, receiptId }],
  ['sale reservation', frontStockSaleSchema, sale],
  ['receipt closing', frontStockFinishSchema, { ...sale, state: 'closed' }],
  ['receipt cancellation', frontStockFinishSchema, { ...sale, state: 'voided' }],
  ['recount', frontStockRecountSchema, { terminalId, recountId: randomUUID(), items: [stockItem] }],
  [
    'snapshot',
    frontInventorySnapshotSchema,
    {
      terminalId,
      terminalGroupId,
      sessionId: randomUUID(),
      sequence: 1,
      capturedAt: new Date().toISOString(),
      items: [stockItem],
    },
  ],
];

test('iiko GUIDs pass activation and every subsequent stock/order request', () => {
  for (const [name, schema, payload] of cases) {
    assert.deepEqual(schema.parse(payload), payload, name);
  }
});

test('iiko identifiers normalize casing consistently with PostgreSQL UUID storage', () => {
  for (const [name, schema, payload] of cases) {
    const upper = JSON.parse(JSON.stringify(payload), (_key, value) =>
      [terminalId, terminalGroupId, productId, receiptId].includes(value)
        ? value.toUpperCase()
        : value,
    );
    assert.deepEqual(schema.parse(upper), payload, name);
  }
});

test('malformed external IDs cannot reach pairing or POS operations', () => {
  for (const [, schema, payload] of cases) {
    for (const bad of [
      undefined,
      null,
      123,
      '',
      'not-a-guid',
      terminalId.replaceAll('-', ''),
      `{${terminalId}}`,
      ` ${terminalId}`,
      `${terminalId}\n`,
      terminalId.replace('a', 'g'),
    ]) {
      assert.equal(schema.safeParse({ ...payload, terminalId: bad }).success, false);
    }
  }
  assert.equal(
    activatePosSchema.safeParse({ ...activation, terminalGroupId: 'bad' }).success,
    false,
  );
  assert.equal(frontReceiptLookupSchema.safeParse({ terminalId, receiptId: 'bad' }).success, false);
  assert.equal(
    frontStockSaleSchema.safeParse({ ...sale, items: [{ ...item, productId: 'bad' }] }).success,
    false,
  );
});

test('Bulka IDs, session IDs, activation secrets and unrelated fields retain strict checks', () => {
  for (const change of [
    { expectedBranchId: terminalId },
    { code: '12345' },
    { terminalToken: 'short' },
    { branchId: randomUUID() },
  ]) {
    assert.equal(activatePosSchema.safeParse({ ...activation, ...change }).success, false);
  }
  assert.equal(
    frontOrderDecisionSchema.safeParse({ terminalId, orderId: receiptId, action: 'accept' })
      .success,
    false,
  );
  assert.equal(
    frontStockRecountSchema.safeParse({ terminalId, recountId: receiptId }).success,
    false,
  );
  const snapshot = cases.find(([name]) => name === 'snapshot')[2];
  assert.equal(
    frontInventorySnapshotSchema.safeParse({ ...snapshot, sessionId: receiptId }).success,
    false,
  );
});

test('case changes cannot bypass duplicate snapshot product detection', () => {
  const snapshot = cases.find(([name]) => name === 'snapshot')[2];
  assert.equal(
    frontInventorySnapshotSchema.safeParse({
      ...snapshot,
      items: [stockItem, { ...stockItem, productId: productId.toUpperCase() }],
    }).success,
    false,
  );
});
