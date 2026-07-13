const assert = require('node:assert/strict');
const test = require('node:test');

const { applyPromoCode, calculateOrderTotal } = require('../src/services/order.service');
const iikoApi = require('../src/services/iiko.service');

test('order total uses server catalog and ignores client price fields', () => {
  const catalog = new Map([
    ['p1', { name: 'Круассан', price: 900, isAvailable: true, iikoProductId: 'p1' }],
  ]);
  const result = calculateOrderTotal(
    [{ id: 'p1', quantity: 2, price: 1, name: 'Подмена' }],
    catalog,
  );
  assert.equal(result.subtotal, 1800);
  assert.equal(result.canonicalItems[0].price, 900);
  assert.equal(result.canonicalItems[0].name, 'Круассан');
});

test('order total rejects unavailable, missing and invalid quantities', () => {
  const catalog = new Map([['p1', { name: 'Пирог', price: 2500, isAvailable: false }]]);
  assert.throws(() => calculateOrderTotal([{ id: 'p1', quantity: 1 }], catalog), /недоступен/);
  assert.throws(() => calculateOrderTotal([{ id: 'missing', quantity: 1 }], catalog), /недоступен/);
  assert.throws(() => calculateOrderTotal([{ id: 'p1', quantity: 0 }], catalog), /Некорректная/);
  const custom = calculateOrderTotal(
    [{ id: 'custom', quantity: 1 }],
    new Map([['custom', { name: 'Ручной товар', price: 1000, isAvailable: true }]]),
  );
  assert.equal(custom.subtotal, 1000);
  assert.equal(custom.canonicalItems[0].iikoProductId, null);
});

test('promo is calculated server-side with minimum order and cap', () => {
  const promos = [{ code: 'BULKA10', type: 'percent', value: 10, min_order: 1000, active: true }];
  assert.deepEqual(applyPromoCode(2500, 'bulka10', promos), {
    promoCode: 'BULKA10',
    discount: 250,
    total: 2250,
  });
  assert.throws(() => applyPromoCode(500, 'BULKA10', promos), /от суммы/);
  assert.throws(() => applyPromoCode(2500, 'UNKNOWN', promos), /не найден/);
});

test('order export to iiko stays disabled unless explicitly enabled', async () => {
  const previous = process.env.IIKO_ORDER_EXPORT_ENABLED;
  delete process.env.IIKO_ORDER_EXPORT_ENABLED;
  try {
    await assert.rejects(() => iikoApi.createDeliveryOrder({}), /отправка заказов в iiko отключена/);
  } finally {
    if (previous === undefined) delete process.env.IIKO_ORDER_EXPORT_ENABLED;
    else process.env.IIKO_ORDER_EXPORT_ENABLED = previous;
  }
});
