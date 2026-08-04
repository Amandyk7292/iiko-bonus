const assert = require('node:assert/strict');
const test = require('node:test');

const { ForteWidgetService } = require('../src/services/forte-widget.service');
const {
  reconcileUnknownFullRefundOrder,
} = require('../src/services/full-refund-reconciliation.service');

const reference = '2e9f2c5c-3abe-49b1-b6aa-cf40d569b998';
const parentUid = '9467f5d5-199f-4b59-9f41-3bff10aba236';
const requestId = '35defd45-f8e2-4d8b-a722-b175ea310b72';
const order = {
  id: '84ba800e-3275-457b-b079-184d870bd89a',
  order_number: 100039,
  status: 'paid',
  refund_status: 'unknown',
  amount: 35,
  partially_refunded_amount: 0,
  payment_method: 'forte_card',
  provider_payment_system: 'forte_widget',
  provider_transaction_id: parentUid,
  refund_reference: reference,
  refund_request_id: requestId,
  payment_test: false,
};
const env = {
  FORTE_WIDGET_ENABLED: 'true',
  FORTE_WIDGET_SHOP_ID: '123456',
  FORTE_WIDGET_SECRET_KEY: 'widget-secret-key-longer-than-sixteen',
  FORTE_WIDGET_TOKEN_KEY: 'widget-token-key-longer-than-thirty-two-characters',
  FORTE_WIDGET_TEST_MODE: 'false',
  FORTE_WIDGET_TRANSACTION_API_URL: 'https://gateway.fortebank.com',
  PUBLIC_BASE_URL: 'https://bulka.com.kz',
};

test('Forte full refund reconciliation confirms an exact read-only provider match', async () => {
  const service = new ForteWidgetService({ env });
  service.assertConfigured = () => ({ test: false });
  service.request = async (path, options) => {
    assert.equal(path, `/transactions/${reference}`);
    assert.deepEqual(options, { base: 'transaction', apiVersion: 3 });
    return {
      response: { ok: true, status: 200 },
      body: {
        uid: reference,
        status: 'successful',
        amount: 3500,
        currency: 'KZT',
        type: 'refund',
        test: false,
        parent_uid: parentUid,
        closed_at: '2026-08-04T09:26:00.131Z',
      },
    };
  };

  assert.deepEqual(await service.reconcileRefund(order), {
    status: 'confirmed',
    reference,
    requestId,
    confirmedAt: '2026-08-04T09:26:00.131Z',
  });
});

test('Forte full refund reconciliation never confirms mismatched amount or parent', async () => {
  const service = new ForteWidgetService({ env });
  service.assertConfigured = () => ({ test: false });
  service.request = async () => ({
    response: { ok: true, status: 200 },
    body: {
      uid: reference,
      status: 'successful',
      amount: 3600,
      currency: 'KZT',
      type: 'refund',
      test: false,
      parent_uid: '11111111-1111-4111-8111-111111111111',
    },
  });

  const result = await service.reconcileRefund(order);
  assert.equal(result.status, 'pending');
  assert.match(result.message, /не совпали/i);
});

test('confirmed unknown full refund is finalized without another bank mutation', async () => {
  let completed = 0;
  let declined = 0;
  const decision = {
    status: 'confirmed',
    reference,
    requestId,
    confirmedAt: '2026-08-04T09:26:00.131Z',
  };
  const result = await reconcileUnknownFullRefundOrder(order, {
    resolve: async () => decision,
    complete: async (current, resolved) => {
      completed += 1;
      assert.equal(current.id, order.id);
      assert.deepEqual(resolved, decision);
      return { ...current, status: 'refunded', refund_status: 'succeeded' };
    },
    decline: async () => {
      declined += 1;
    },
  });

  assert.equal(result.status, 'confirmed');
  assert.equal(result.order.refund_status, 'succeeded');
  assert.equal(completed, 1);
  assert.equal(declined, 0);
});
