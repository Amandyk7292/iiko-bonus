const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PaymentCleanupService,
  widgetExpirationMs,
} = require('../src/services/payment-cleanup.service');

const now = new Date('2026-07-27T12:00:00.000Z');
const silentLogger = { warn() {}, error() {} };

const baseOrder = (overrides = {}) => ({
  id: 'order-1',
  operation_id: 'payment-1',
  customer_id: 'customer-1',
  branch_id: 'branch-1',
  status: 'pending',
  fulfillment_status: 'pending',
  payment_method: 'invoice',
  created_at: '2026-07-27T10:00:00.000Z',
  updated_at: '2026-07-27T10:00:00.000Z',
  ...overrides,
});

const createHarness = ({
  pending = [],
  unfinished = [],
  widgetSync,
  widgetAvailable = true,
  forteSync,
  updateFulfillmentResult,
} = {}) => {
  const calls = {
    cancelledInvoices: [],
    statusUpdates: [],
    released: [],
    published: [],
    recorded: [],
  };
  const service = new PaymentCleanupService({
    listPendingOrders: async () => pending,
    listUnfinishedOrders: async () => unfinished,
    updateFulfillment: async (order, status) =>
      updateFulfillmentResult === null
        ? null
        : {
            ...order,
            status,
            fulfillment_status: 'cancelled',
          },
    releaseReservations: async (orderId) => calls.released.push(orderId),
    orderState: {
      updateOrderStatus: async (operationId, status) => {
        calls.statusUpdates.push([operationId, status]);
        const source = [...pending, ...unfinished].find(
          (order) => order.operation_id === operationId,
        );
        return { ...source, status };
      },
    },
    forte: {
      availability: () => true,
      syncOrder: forteSync || (async (order) => ({ order, status: 'pending' })),
    },
    widget: {
      availability: () => widgetAvailable,
      syncOrder: widgetSync || (async (order) => ({ order, status: 'pending' })),
    },
    operations: {
      recordCleanupResult: async (summary) => calls.recorded.push(summary),
    },
    publish: (...args) => calls.published.push(args),
    loggerInstance: silentLogger,
  });
  return { service, calls };
};

test('expired Widget checkout is cancelled and its reservation is released', async () => {
  const order = baseOrder({
    provider_payment_system: 'forte_widget',
    payment_expires_at: '2026-07-27T11:30:00.000Z',
  });
  const { service, calls } = createHarness({ pending: [order] });
  const summary = await service.cleanupExpiredPayments({ now });

  assert.deepEqual(calls.statusUpdates, [['payment-1', 'expired']]);
  assert.deepEqual(calls.released, ['order-1']);
  assert.equal(calls.published.length, 1);
  assert.deepEqual(summary, {
    inspected: 1,
    expired: 1,
    cancelled: 1,
    released: 1,
    errors: 0,
  });
});

test('legacy Forte /flex order is never force-expired while the bank says pending', async () => {
  const order = baseOrder({
    payment_method: 'forte_card',
    created_at: '2026-07-25T10:00:00.000Z',
  });
  const { service, calls } = createHarness({ pending: [order] });
  const summary = await service.cleanupExpiredPayments({ now });

  assert.deepEqual(calls.statusUpdates, []);
  assert.deepEqual(calls.released, []);
  assert.equal(summary.cancelled, 0);
});

test('Widget order is not expired when its provider state cannot be verified', async () => {
  const order = baseOrder({
    provider_payment_system: 'forte_widget',
    payment_expires_at: '2026-07-27T11:30:00.000Z',
  });
  const { service, calls } = createHarness({
    pending: [order],
    widgetSync: async () => {
      throw new Error('network unavailable');
    },
  });
  const summary = await service.cleanupExpiredPayments({ now });

  assert.deepEqual(calls.statusUpdates, []);
  assert.deepEqual(calls.released, []);
  assert.equal(summary.cancelled, 0);
  assert.equal(summary.errors, 1);
});

test('historical invoice expires locally without contacting the retired provider', async () => {
  const order = baseOrder({ created_at: '2026-07-26T10:00:00.000Z' });
  const { service, calls } = createHarness({ pending: [order] });
  const summary = await service.cleanupExpiredPayments({ now });

  assert.deepEqual(calls.cancelledInvoices, []);
  assert.deepEqual(calls.statusUpdates, [['payment-1', 'expired']]);
  assert.deepEqual(calls.released, ['order-1']);
  assert.equal(summary.expired, 1);
  assert.equal(summary.cancelled, 1);
});

test('recent historical invoice is not expired early', async () => {
  const order = baseOrder({ created_at: '2026-07-27T10:00:00.000Z' });
  const { service, calls } = createHarness({ pending: [order] });
  const summary = await service.cleanupExpiredPayments({ now });

  assert.deepEqual(calls.cancelledInvoices, []);
  assert.deepEqual(calls.statusUpdates, []);
  assert.deepEqual(calls.released, []);
  assert.equal(summary.expired, 0);
  assert.equal(summary.cancelled, 0);
});

test('concurrent cleanup does not report or release an order it did not update', async () => {
  const order = baseOrder({ status: 'failed' });
  const { service, calls } = createHarness({
    unfinished: [order],
    updateFulfillmentResult: null,
  });
  const summary = await service.cleanupExpiredPayments({ now });

  assert.deepEqual(calls.released, []);
  assert.equal(summary.cancelled, 0);
  assert.equal(summary.released, 0);
});

test('Widget expiration uses the explicit provider deadline', () => {
  assert.equal(
    widgetExpirationMs(
      baseOrder({
        payment_expires_at: '2026-07-27T11:30:00.000Z',
      }),
    ),
    Date.parse('2026-07-27T11:30:00.000Z'),
  );
});
