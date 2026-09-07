const assert = require('node:assert/strict');
const test = require('node:test');
const { attachOrderImages } = require('../src/services/order-images.service');

function database(rows, error) {
  return { from: () => ({ select: () => ({ in: async () => ({ data: rows, error }) }) }) };
}

test('purchase images enrich missing photos without changing historical prices or existing photos', async () => {
  const orders = [{ amount: 70, items: [
    { id: 'bread', price: 35, quantity: 2 },
    { id: 'cake', price: 200, imageUrl: 'https://example.com/historical.png' },
  ] }];
  const result = await attachOrderImages(orders, { db: database([
    { iiko_product_id: 'bread', image_url: 'https://example.com/bread.png' },
    { iiko_product_id: 'cake', image_url: 'https://example.com/new.png' },
  ]) });
  assert.equal(result[0].items[0].imageUrl, 'https://example.com/bread.png');
  assert.equal(result[0].items[0].price, 35);
  assert.equal(result[0].items[0].quantity, 2);
  assert.equal(result[0].amount, 70);
  assert.equal(result[0].items[1].imageUrl, orders[0].items[1].imageUrl);
  assert.equal(orders[0].items[0].imageUrl, undefined);
});

test('conflicting branch images and unavailable storage never hide purchases', async () => {
  const orders = [{ items: [{ id: 'bread', price: 35 }] }];
  const result = await attachOrderImages(orders, { db: database([
    { iiko_product_id: 'bread', image_url: 'https://example.com/a.png' },
    { iiko_product_id: 'bread', image_url: 'https://example.com/b.png' },
  ]) });
  assert.deepEqual(result, orders);
  assert.equal(await attachOrderImages(orders, { db: database([], new Error('unavailable')) }), orders);
});
