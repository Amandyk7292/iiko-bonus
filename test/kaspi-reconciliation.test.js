const assert = require('node:assert/strict');
const test = require('node:test');

const modulePath = (value) => require.resolve(value);

function installModule(t, path, exports) {
  const resolved = modulePath(path);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

function hasFilter(query, method, column, ...expectedValue) {
  return query.steps.some(
    (step) =>
      step.method === method &&
      step.column === column &&
      (expectedValue.length === 0 ||
        JSON.stringify(step.value) === JSON.stringify(expectedValue[0])),
  );
}

function reconciliationDatabase(fixtures) {
  const queries = [];

  const resolveSelect = (query) => {
    if (hasFilter(query, 'in', 'status', ['paid', 'refunded'])) return fixtures.receipts;
    if (hasFilter(query, 'eq', 'status', 'refunded')) return fixtures.missingReversal;
    if (hasFilter(query, 'eq', 'status', 'pending')) return fixtures.pending;
    if (hasFilter(query, 'eq', 'refund_status', 'failed')) return fixtures.failedAutoRefund;
    if (hasFilter(query, 'eq', 'fulfillment_status', 'pending')) return fixtures.paidPending;
    if (hasFilter(query, 'is', 'bonus_awarded_at', null)) return fixtures.missingBonus;
    throw new Error(`Unexpected reconciliation query: ${JSON.stringify(query.steps)}`);
  };

  const client = {
    from(table) {
      assert.equal(table, 'kaspi_orders');
      const query = {
        operation: 'select',
        steps: [],
        select(fields) {
          this.steps.push({ method: 'select', value: fields });
          return this;
        },
        update(payload) {
          this.operation = 'update';
          this.steps.push({ method: 'update', value: payload });
          return this;
        },
        eq(column, value) {
          this.steps.push({ method: 'eq', column, value });
          return this;
        },
        in(column, value) {
          this.steps.push({ method: 'in', column, value });
          return this;
        },
        is(column, value) {
          this.steps.push({ method: 'is', column, value });
          return this;
        },
        or(value) {
          this.steps.push({ method: 'or', value });
          return this;
        },
        like(column, value) {
          this.steps.push({ method: 'like', column, value });
          return this;
        },
        lt(column, value) {
          this.steps.push({ method: 'lt', column, value });
          return this;
        },
        gte(column, value) {
          this.steps.push({ method: 'gte', column, value });
          return this;
        },
        order(column, value) {
          this.steps.push({ method: 'order', column, value });
          return this;
        },
        limit(value) {
          this.steps.push({ method: 'limit', value });
          return this;
        },
        then(resolve, reject) {
          queries.push(this);
          const result =
            this.operation === 'update'
              ? { data: null, error: null }
              : { data: structuredClone(resolveSelect(this)), error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };

  return { client, queries };
}

function loadService(t, database, receiptEvents) {
  installModule(t, '../src/config/supabase', { supabase: database.client });
  installModule(t, '../src/services/inventory.service', {
    commitOrReacquireOrderReservations: async () => ({ status: 'committed' }),
    releaseOrderReservations: async () => undefined,
  });
  installModule(t, '../src/services/realtime.service', { publish: () => undefined });
  installModule(t, '../src/services/analytics-event.service', {
    recordSystemEvent: async () => undefined,
  });
  installModule(t, '../src/services/loyalty-sync.service', {
    queueCustomerLoyaltySync: () => undefined,
  });
  installModule(t, '../src/services/payment-receipt.service', {
    ensurePaymentReceipt: async (order) => receiptEvents.push(order.id),
  });

  const servicePath = modulePath('../src/services/kaspi.service');
  const previousService = require.cache[servicePath];
  delete require.cache[servicePath];
  const { KaspiService } = require(servicePath);
  t.after(() => {
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  return new KaspiService();
}

test('reconciliation selects only unfinished work, deduplicates it and handles newest first', async (t) => {
  const duplicatePaid = {
    id: 'paid-pending',
    operation_id: 'op-paid-pending',
    status: 'paid',
    fulfillment_status: 'pending',
    bonus_awarded_at: null,
    updated_at: '2026-07-29T10:00:00.000Z',
  };
  const fixtures = {
    paidPending: [duplicatePaid],
    missingBonus: [
      duplicatePaid,
      {
        id: 'paid-missing-bonus',
        operation_id: 'op-paid-missing-bonus',
        status: 'paid',
        fulfillment_status: 'new',
        bonus_awarded_at: null,
        updated_at: '2026-07-29T12:00:00.000Z',
      },
    ],
    failedAutoRefund: [
      {
        id: 'failed-auto-refund',
        operation_id: 'op-failed-auto-refund',
        status: 'paid',
        fulfillment_status: 'cancelled',
        bonus_awarded_at: '2026-07-29T09:00:00.000Z',
        refund_status: 'failed',
        cancellation_reason: 'Автоматический возврат поздней оплаты: товар уже недоступен',
        updated_at: '2026-07-29T13:00:00.000Z',
      },
    ],
    missingReversal: [
      {
        id: 'refunded-missing-reversal',
        operation_id: 'op-refunded-missing-reversal',
        status: 'refunded',
        bonus_reversed_at: null,
        updated_at: '2026-07-29T11:00:00.000Z',
      },
    ],
    pending: [
      {
        id: 'remote-pending',
        operation_id: 'op-remote-pending',
        status: 'pending',
        updated_at: '2026-07-29T14:00:00.000Z',
      },
    ],
    receipts: [],
  };
  const database = reconciliationDatabase(fixtures);
  const service = loadService(t, database, []);
  const actions = [];
  service.recordPaidOrder = async (operationId) => actions.push(['paid', operationId]);
  service.reverseOrderLoyalty = async (order) => actions.push(['reversed', order.operation_id]);
  service.syncRemoteOrder = async (operationId) => actions.push(['pending', operationId]);
  service.recoverPaymentCreationClaims = async () => 0;

  const processed = await service.reconcileOrders({ syncKaspiPending: true });

  assert.equal(processed, 5);
  assert.deepEqual(actions, [
    ['pending', 'op-remote-pending'],
    ['paid', 'op-failed-auto-refund'],
    ['paid', 'op-paid-missing-bonus'],
    ['reversed', 'op-refunded-missing-reversal'],
    ['paid', 'op-paid-pending'],
  ]);

  const selects = database.queries.filter((query) =>
    query.steps.some((step) => step.method === 'select'),
  );
  assert.equal(selects.length, 6);
  assert.equal(
    selects.filter(
      (query) =>
        hasFilter(query, 'in', 'status', ['paid', 'refunded']) &&
        !hasFilter(query, 'is', 'receipt_created_at', null),
    ).length,
    0,
  );
  assert.equal(
    selects.some(
      (query) =>
        hasFilter(query, 'eq', 'status', 'paid') &&
        hasFilter(query, 'eq', 'fulfillment_status', 'pending'),
    ),
    true,
  );
  assert.equal(
    selects.some(
      (query) =>
        hasFilter(query, 'eq', 'status', 'paid') &&
        hasFilter(query, 'is', 'bonus_awarded_at', null) &&
        hasFilter(
          query,
          'or',
          undefined,
          'fulfillment_status.is.null,fulfillment_status.neq.cancelled',
        ),
    ),
    true,
  );
  assert.equal(
    selects.some(
      (query) =>
        hasFilter(query, 'eq', 'refund_status', 'failed') &&
        query.steps.some(
          (step) =>
            step.method === 'like' &&
            step.column === 'cancellation_reason' &&
            step.value === 'Автоматический возврат поздней оплаты: %',
        ),
    ),
    true,
  );
  assert.equal(
    selects.some(
      (query) =>
        hasFilter(query, 'eq', 'status', 'refunded') &&
        hasFilter(query, 'is', 'bonus_reversed_at', null),
    ),
    true,
  );
  for (const query of selects) {
    const order = query.steps.find((step) => step.method === 'order');
    assert.equal(order?.value?.ascending, false);
    assert.equal(query.steps.find((step) => step.method === 'limit')?.value, 50);
  }
});

test('paid-order finalization still runs when Kaspi is disabled', async (t) => {
  const paidForteOrder = {
    id: 'forte-paid',
    operation_id: 'forte-operation',
    payment_method: 'forte_card',
    status: 'paid',
    fulfillment_status: 'pending',
    bonus_awarded_at: null,
    updated_at: '2026-07-29T12:00:00.000Z',
  };
  const fixtures = {
    paidPending: [paidForteOrder],
    missingBonus: [paidForteOrder],
    failedAutoRefund: [],
    missingReversal: [],
    pending: [],
    receipts: [],
  };
  const database = reconciliationDatabase(fixtures);
  const service = loadService(t, database, []);
  const actions = [];
  service.recordPaidOrder = async (operationId) => actions.push(['paid', operationId]);
  service.syncRemoteOrder = async () => {
    throw new Error('Kaspi provider must not be called');
  };
  service.reverseOrderLoyalty = async () => undefined;

  const processed = await service.reconcileOrders({ syncKaspiPending: false });

  assert.equal(processed, 1);
  assert.deepEqual(actions, [['paid', 'forte-operation']]);
  assert.equal(
    database.queries.some((query) => hasFilter(query, 'eq', 'status', 'pending')),
    false,
  );
});
