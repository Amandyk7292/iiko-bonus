const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cashierBranch,
  visibleCashierProducts,
} = require('../src/services/cashier-catalog.service');

test('cashier scope comes only from their assigned branch', () => {
  assert.equal(cashierBranch({ role: 'cashier', branchIds: ['a'], selectedBranchId: 'b' }), 'a');
  for (const admin of [
    { role: 'cashier', branchIds: [] },
    { role: 'cashier', branchIds: ['a', 'b'] },
    { role: 'viewer', branchIds: ['a'] },
  ]) {
    assert.throws(() => cashierBranch(admin), { statusCode: 403 });
  }
});
test('renamed and translated iiko listings keep their stock ID; matching names never share stock', () => {
  for (const name of ['Хот-дог', 'Хот-дог қазақша', 'Hot dog']) {
    const products = visibleCashierProducts({
      rawMenu: { products: [{ id: 'stable-iiko-id', name: 'Хот дог', price: 500 }] },
      overrides: [{ iiko_product_id: 'stable-iiko-id', custom_name: name }],
      categories: [],
      custom: [{ id: 'independent', name, price: 500, is_available: true }],
      stopIds: new Set(),
      inventory: new Map([['stable-iiko-id', { sourceQuantity: 5, availableQuantity: 5 }]]),
    });
    assert.equal(products[0].id, 'stable-iiko-id');
    assert.equal(products[0].name, name);
    assert.equal(products[0].availableQuantity, 5);
    assert.equal(products[1].availableQuantity, null);
    assert.equal(products[1].isIikoProduct, false);
  }
});
test('cashier catalog uses the product photograph and respects the administrator image override', () => {
  const products = visibleCashierProducts({
    rawMenu: {
      products: [
        { id: 'iiko', name: 'Круассан', price: 100, imageLinks: ['https://example.com/iiko.jpg'] },
        { id: 'override', name: 'Плюшка', price: 35, imageLinks: ['https://example.com/old.jpg'] },
      ],
    },
    overrides: [{ iiko_product_id: 'override', custom_image_url: 'https://example.com/bun.jpg' }],
    categories: [],
    custom: [
      {
        id: 'custom',
        name: 'Десерт',
        price: 500,
        is_available: true,
        image_url: 'https://example.com/dessert.jpg',
      },
    ],
    stopIds: new Set(),
    inventory: new Map(),
  });
  assert.deepEqual(
    products.map((p) => p.imageUrl),
    [
      'https://example.com/iiko.jpg',
      'https://example.com/bun.jpg',
      'https://example.com/dessert.jpg',
    ],
  );
});
test('hidden products are excluded; external stops remain visible but locked', () => {
  const products = visibleCashierProducts({
    rawMenu: {
      groups: [{ id: 'hidden-category', name: 'Скрыто' }],
      products: ['open', 'hidden', 'stopped', 'iiko-stop', 'local-stop', 'zero', 'category'].map(
        (id) => ({
          id,
          name: id,
          price: 100,
          parentGroup: id === 'category' ? 'hidden-category' : 'normal',
        }),
      ),
    },
    overrides: [
      { iiko_product_id: 'hidden', is_hidden: true },
      { iiko_product_id: 'stopped', is_stop_listed: true },
    ],
    categories: [{ iiko_category_id: 'hidden-category', is_hidden: true }],
    custom: [
      { id: 'disabled-custom', is_available: false, price: 100 },
      { id: 'hidden-custom-category', is_available: true, price: 100, category_name: 'Скрыто' },
    ],
    stopIds: new Set(['iiko-stop']),
    inventory: new Map([
      ['local-stop', { sourceQuantity: 5, availableQuantity: 3, reserved: 2, manualStop: true }],
      ['zero', { sourceQuantity: 0, availableQuantity: 0, manualStop: false }],
    ]),
  });
  assert.deepEqual(
    products.map((p) => p.id),
    ['open', 'stopped', 'iiko-stop', 'local-stop', 'zero', 'disabled-custom'],
  );
  assert.equal(products[1].blockedBy, 'admin');
  assert.equal(products[2].blockedBy, 'iiko');
  assert.equal(products[3].availableQuantity, 3);
  assert.equal(products[3].manualStop, true);
});
