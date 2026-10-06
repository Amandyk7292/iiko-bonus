const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { receiptDraft } = require('../src/services/front-receipt-draft.service');
test('receipt import uses product IDs despite translated names, exact weight and merchandise amount after promo and bonuses', () => {
  const product = randomUUID();
  const result = receiptDraft({
    id: randomUUID(),
    status: 'paid',
    fulfillment_status: 'preparing',
    subtotal: 1050,
    discount_amount: 50,
    bonus_spent: 200,
    delivery_fee: 1200,
    cart_items: [
      {
        id: 'hot-dog',
        iikoProductId: product,
        name: 'Хот-дог',
        quantity: 0.7,
        quantityStep: 0.001,
        price: 1500,
        lineTotal: 1050,
      },
    ],
  });
  assert.equal(result.items[0].productId, product);
  assert.equal(result.items[0].quantity, 0.7);
  assert.equal(result.merchandiseTotal, 800);
});
test('deferred tablet receipt is permitted once; cancelled, refunded and mismatched orders cannot import', () => {
  const order = {
    status: 'paid',
    fulfillment_status: 'completed',
    pos_receipt_due: true,
    subtotal: 35,
    cart_items: [{ iikoProductId: randomUUID(), price: 35, quantity: 1 }],
  };
  assert.equal(receiptDraft(order).merchandiseTotal, 35);
  for (const changes of [
    { pos_receipt_due: false },
    { refund_status: 'unknown' },
    { fulfillment_status: 'cancelled' },
    { subtotal: 36 },
  ])
    assert.throws(() => receiptDraft({ ...order, ...changes }));
});
test('receipt draft identifies an attached pickup photo without exposing the image', () => {
  const photoId = randomUUID();
  const order = {
    id: randomUUID(),
    order_number: 147,
    status: 'paid',
    fulfillment_status: 'preparing',
    subtotal: 35,
    cart_items: [{ iikoProductId: randomUUID(), price: 35, quantity: 1 }],
  };
  assert.equal(receiptDraft(order).pickupPhotoId, null);
  const draft = receiptDraft({ ...order, pickup_photo_id: photoId });
  assert.equal(draft.pickupPhotoId, photoId);
  assert.equal(draft.id, order.id);
  assert.equal(draft.number, order.order_number);
  assert.equal('pickupPhotoUrl' in draft, false);
});
test('unresolved replacement cannot print; accepted draft retains replacement badge and requested time', () => {
  const order = {
    status: 'paid',
    fulfillment_status: 'ready',
    subtotal: 35,
    cart_items: [{ iikoProductId: randomUUID(), price: 35, quantity: 1 }],
  };
  const resolution = {
    id: randomUUID(),
    reason: 'courier_not_found',
    pickupTime: '2026-10-03T14:00:00Z',
  };
  for (const status of [
    'pending',
    'pickup_cancelling',
    'cancel_cancelling',
    'pickup_pending_approval',
    'pickup_accepting',
    'pickup_rejecting',
    'cancel_refunding',
  ])
    assert.throws(
      () => receiptDraft({ ...order, delivery_resolution: { ...resolution, status } }),
      (e) => e.statusCode === 409,
    );
  const result = receiptDraft({
    ...order,
    scheduled_at: resolution.pickupTime,
    delivery_resolution: { ...resolution, status: 'pickup_accepted' },
  });
  assert.equal(result.deliveryResolution.status, 'pickup_accepted');
  assert.equal(result.scheduledAt, resolution.pickupTime);
});
