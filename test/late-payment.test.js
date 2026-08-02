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

function fakeOrderDb(initialOrder) {
  let order = structuredClone(initialOrder);
  return {
    get order() {
      return order;
    },
    set order(value) {
      order = structuredClone(value);
    },
    client: {
      from(table) {
        assert.equal(table, 'kaspi_orders');
        let operation = 'select';
        let updatePayload = null;
        return {
          select() {
            return this;
          },
          update(payload) {
            operation = 'update';
            updatePayload = payload;
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            if (operation === 'update') order = { ...order, ...updatePayload };
            return Promise.resolve({ data: structuredClone(order), error: null });
          },
        };
      },
    },
  };
}

function loadKaspiService(t, { order, reservationStatus, promotionStatus, refundFailures = 0 }) {
  const events = [];
  const database = fakeOrderDb(order);
  let refundAttempts = 0;

  installModule(t, '../src/config/supabase', { supabase: database.client });
  installModule(t, '../src/services/inventory.service', {
    commitOrReacquireOrderReservations: async (_orderId, options) => {
      events.push(['reservation', options.allowReacquire]);
      return { status: reservationStatus };
    },
    releaseOrderReservations: async () => undefined,
  });
  installModule(t, '../src/services/realtime.service', {
    publish: (...args) => events.push(['publish', args[0]]),
  });
  installModule(t, '../src/services/analytics-event.service', {
    recordSystemEvent: async () => events.push(['analytics']),
  });
  installModule(t, '../src/services/loyalty-sync.service', {
    queueCustomerLoyaltySync: () => undefined,
  });
  installModule(t, '../src/services/commerce-marketing.service', {
    consumePromotionReservation: async () => {
      events.push(['promotion']);
      return { status: promotionStatus };
    },
    qualifyReferralForOrder: async () => events.push(['referral']),
    releasePromotionReservation: async () => events.push(['promotion-release']),
  });
  installModule(t, '../src/services/customer-order.service', {
    cancelPaidOrder: async (_current, reason, options) => {
      refundAttempts += 1;
      events.push(['refund', reason, options.cancelBeforeRefund, options.reuseRefundRequestId]);
      const cancelled = {
        ...database.order,
        fulfillment_status: 'cancelled',
        cancellation_reason: reason,
        refund_status: 'failed',
        refund_request_id:
          database.order.refund_request_id || '33333333-3333-4333-8333-333333333333',
      };
      database.order = cancelled;
      if (refundAttempts <= refundFailures) throw new Error('temporary refund failure');
      const refunded = {
        ...cancelled,
        status: 'refunded',
        refund_status: 'succeeded',
      };
      database.order = refunded;
      return refunded;
    },
  });
  installModule(t, '../src/services/payment-receipt.service', {
    ensurePaymentReceipt: async () => events.push(['receipt']),
  });

  const servicePath = modulePath('../src/services/kaspi.service');
  const previousService = require.cache[servicePath];
  delete require.cache[servicePath];
  const { KaspiService } = require(servicePath);
  t.after(() => {
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  return { service: new KaspiService(), database, events };
}

test('late paid order is automatically refunded before bonuses when capacity is gone', async (t) => {
  const { service, events } = loadKaspiService(t, {
    order: {
      id: '11111111-1111-4111-8111-111111111111',
      operation_id: '12345',
      status: 'paid',
      fulfillment_status: 'cancelled',
      cancellation_reason: 'Срок оплаты истёк',
      refund_status: null,
      customer_id: '22222222-2222-4222-8222-222222222222',
      order_number: 10,
    },
    reservationStatus: 'unavailable',
    promotionStatus: 'no_promotion',
  });
  service.awardOrderBonus = async () => {
    throw new Error('bonus must not run');
  };

  const result = await service.recordPaidOrder('12345');
  assert.equal(result.status, 'refunded');
  assert.deepEqual(events[0], ['reservation', true]);
  assert.equal(
    events.some(([name]) => name === 'promotion'),
    false,
  );
  assert.equal(
    events.some(([name]) => name === 'refund'),
    true,
  );
  assert.equal(
    events.some(([name]) => name === 'analytics'),
    false,
  );
});

test('paid order becomes new only after inventory and promotion are secured', async (t) => {
  const { service, events, database } = loadKaspiService(t, {
    order: {
      id: '11111111-1111-4111-8111-111111111111',
      operation_id: '67890',
      status: 'paid',
      fulfillment_status: 'pending',
      cancellation_reason: null,
      refund_status: null,
      customer_id: '22222222-2222-4222-8222-222222222222',
      order_number: 11,
      amount: 1000,
      fulfillment_type: 'pickup',
    },
    reservationStatus: 'committed',
    promotionStatus: 'consumed',
  });
  service.awardOrderBonus = async (paidOrder) => {
    events.push(['bonus']);
    return { ...paidOrder, bonus_awarded_at: '2026-07-29T00:00:00.000Z' };
  };

  const result = await service.recordPaidOrder('67890');
  assert.equal(result.fulfillment_status, 'new');
  assert.equal(database.order.fulfillment_status, 'new');
  assert.deepEqual(
    events.filter(([name]) => ['reservation', 'promotion', 'bonus'].includes(name)),
    [['reservation', true], ['promotion'], ['bonus']],
  );
  assert.equal(
    events.some(([name]) => name === 'receipt'),
    true,
  );
});

test('failed late-payment auto-refund is retried without reacquiring capacity', async (t) => {
  const { service, events, database } = loadKaspiService(t, {
    order: {
      id: '11111111-1111-4111-8111-111111111111',
      operation_id: '24680',
      status: 'paid',
      fulfillment_status: 'cancelled',
      cancellation_reason: 'Срок оплаты истёк',
      refund_status: null,
      customer_id: '22222222-2222-4222-8222-222222222222',
      order_number: 12,
    },
    reservationStatus: 'unavailable',
    promotionStatus: 'no_promotion',
    refundFailures: 1,
  });

  await assert.rejects(() => service.recordPaidOrder('24680'), /temporary refund failure/);
  assert.equal(database.order.refund_status, 'failed');
  assert.match(database.order.cancellation_reason, /^Автоматический возврат поздней оплаты:/);

  const result = await service.recordPaidOrder('24680');
  assert.equal(result.status, 'refunded');
  assert.equal(events.filter(([name]) => name === 'reservation').length, 1);
  const refundEvents = events.filter(([name]) => name === 'refund');
  assert.equal(refundEvents.length, 2);
  assert.equal(
    refundEvents.every((event) => event[3] === true),
    true,
  );
});
