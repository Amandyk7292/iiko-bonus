const assert = require('node:assert/strict');
const test = require('node:test');
const { attachOrderImages } = require('../src/services/order-images.service');

function database(rows, error, customRows = []) {
  const schemas = {
    menu_overrides: ['iiko_product_id', 'custom_image_url'],
    custom_products: ['id', 'image_url'],
  };
  return { from: (table) => ({ select: (columns) => ({ in: async (key, ids) => {
    const invalid = columns.split(',').find((column) => !schemas[table].includes(column));
    const tableError = typeof error === 'function' ? error(table) : error;
    return invalid ? { error: new Error(`column ${table}.${invalid} does not exist`) }
      : { data: (table === 'menu_overrides' ? rows : customRows).filter((row) => ids.includes(row[key])), error: tableError };
  } }) }) };
}

test('purchase images enrich missing photos without changing historical prices or existing photos', async () => {
  const orders = [{ amount: 70, items: [
    { id: 'bread', price: 35, quantity: 2 },
    { id: 'cake', price: 200, imageUrl: 'https://example.com/historical.png' },
  ] }];
  const result = await attachOrderImages(orders, { db: database([
    { iiko_product_id: 'bread', custom_image_url: 'https://example.com/bread.png' },
    { iiko_product_id: 'cake', custom_image_url: 'https://example.com/new.png' },
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
    { iiko_product_id: 'bread', custom_image_url: 'https://example.com/a.png' },
    { iiko_product_id: 'bread', custom_image_url: 'https://example.com/b.png' },
  ]) });
  assert.deepEqual(result, orders);
  assert.equal(await attachOrderImages(orders, { db: database([], new Error('unavailable')) }), orders);
});

test('iiko photo survives a failure in the separate custom product lookup', async () => {
  const id = '4fea5e9d-2762-4436-a1d1-65fff56b03a9';
  const orders = [{ items: [{ id, price: 35, quantity: 2 }] }];
  const result = await attachOrderImages(orders, { db: database([
    { iiko_product_id: id, custom_image_url: 'https://example.com/bun.webp' },
  ], (table) => table === 'custom_products' ? new Error('unavailable') : undefined) });
  assert.equal(result[0].items[0].imageUrl, 'https://example.com/bun.webp');
});

test('custom products use their own image_url column', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const result = await attachOrderImages([{ items: [{ productId: id, price: 200 }] }],
    { db: database([], undefined, [{ id, image_url: 'https://example.com/custom.webp' }]) });
  assert.equal(result[0].items[0].imageUrl, 'https://example.com/custom.webp');
});
