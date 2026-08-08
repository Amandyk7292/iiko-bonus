const assert = require('node:assert/strict');
const test = require('node:test');

const { applyPromoCode, calculateOrderTotal } = require('../src/services/order.service');

test('order total uses server catalog and ignores client price fields', () => {
  const catalog = new Map([
    [
      'p1',
      {
        name: 'Круассан',
        price: 900,
        isAvailable: true,
        iikoProductId: 'p1',
        preparationMinutes: 18,
      },
    ],
  ]);
  const result = calculateOrderTotal(
    [{ id: 'p1', quantity: 2, price: 1, name: 'Подмена' }],
    catalog,
  );
  assert.equal(result.subtotal, 1800);
  assert.equal(result.canonicalItems[0].price, 900);
  assert.equal(result.canonicalItems[0].name, 'Круассан');
  assert.equal(result.canonicalItems[0].preparationMinutes, 18);
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

test('stock validation aggregates the same product across configurations', () => {
  const catalog = new Map([
    [
      'p1',
      {
        name: 'Булочка',
        price: 100,
        isAvailable: true,
        availableQuantity: 10,
      },
    ],
  ]);

  assert.throws(
    () =>
      calculateOrderTotal(
        [
          { id: 'p1', quantity: 6, configuration: { filling: 'apple' } },
          { id: 'p1', quantity: 6, configuration: { filling: 'cherry' } },
        ],
        catalog,
      ),
    /Доступно: 10/,
  );
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
