const test = require('node:test');
const assert = require('node:assert/strict');
const {
  categoryNameKey,
  filterProductsByVisibleCategories,
  fulfillmentTypesForProduct,
  getHiddenCategoryVisibility,
  productSupportsFulfillmentType,
} = require('../src/utils/menu-visibility.util');

test('product fulfillment defaults stay backwards compatible and explicit catalogs are enforced', () => {
  assert.deepEqual(fulfillmentTypesForProduct({}), ['pickup', 'delivery', 'preorder']);
  assert.equal(productSupportsFulfillmentType({}, 'delivery'), true);
  assert.equal(
    productSupportsFulfillmentType({ fulfillment_types: ['preorder'] }, 'pickup'),
    false,
  );
  assert.equal(
    productSupportsFulfillmentType({ fulfillment_types: ['preorder'] }, 'preorder'),
    true,
  );
  assert.equal(productSupportsFulfillmentType({ fulfillment_types: [] }, 'preorder'), false);
});

test('hidden category matching covers original, custom and translated names', () => {
  const categories = [
    { id: 'delivery', name: 'ДОСТАВКА' },
    { id: 'delivery-duplicate', name: 'Доставка' },
    { id: 'buns', name: 'БУЛОЧКИ' },
  ];
  const overrides = new Map([
    [
      'delivery',
      {
        is_hidden: true,
        custom_name: 'Доставка',
        name_translations: { kk: 'Жеткізу', en: 'Delivery' },
      },
    ],
  ]);

  const hidden = getHiddenCategoryVisibility(categories, overrides);
  assert.deepEqual([...hidden.ids], ['delivery', 'delivery-duplicate']);
  assert.equal(hidden.names.has(categoryNameKey(' доставка ')), true);
  assert.equal(hidden.names.has(categoryNameKey('Жеткізу')), true);
  assert.equal(hidden.names.has(categoryNameKey('DELIVERY')), true);
  assert.equal(hidden.names.has(categoryNameKey('БУЛОЧКИ')), false);
});

test('published menu drops every product whose category is absent', () => {
  const categories = [{ id: 'visible', name: 'Булочки' }];
  const products = [
    { id: 'one', categoryId: 'visible' },
    { id: 'two', categoryId: 'hidden' },
    { id: 'three', categoryId: 'missing' },
  ];

  assert.deepEqual(filterProductsByVisibleCategories(categories, products), [products[0]]);
});

test('order catalog rejects iiko and custom products from hidden duplicate categories', async () => {
  const iikoPath = require.resolve('../src/services/iiko.service');
  const menuPath = require.resolve('../src/services/menu.service');
  const settingsPath = require.resolve('../src/services/settings.service');
  const orderPath = require.resolve('../src/services/order.service');
  const previous = new Map(
    [iikoPath, menuPath, settingsPath, orderPath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ]),
  );
  const cacheModule = (modulePath, exports) => {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  };

  cacheModule(iikoPath, {
    getMenu: async () => ({
      groups: [
        { id: 'hidden', name: 'КОФЕ' },
        { id: 'duplicate', name: 'Кофе' },
        { id: 'visible', name: 'Булочки' },
      ],
      products: [
        {
          id: 'hidden-product',
          parentGroup: 'hidden',
          name: 'A',
          sizePrices: [{ price: { currentPrice: 100 } }],
        },
        {
          id: 'duplicate-product',
          parentGroup: 'duplicate',
          name: 'B',
          sizePrices: [{ price: { currentPrice: 100 } }],
        },
        {
          id: 'visible-product',
          parentGroup: 'visible',
          name: 'C',
          sizePrices: [{ price: { currentPrice: 100 } }],
        },
        {
          id: 'preorder-product',
          parentGroup: 'visible',
          name: 'P',
          sizePrices: [{ price: { currentPrice: 100 } }],
        },
      ],
    }),
    getStopListProductIds: async () => new Set(),
  });
  cacheModule(menuPath, {
    getProductOverrides: async () => [
      { iiko_product_id: 'preorder-product', fulfillment_types: ['preorder'] },
    ],
    getCategoryOverrides: async () => [{ iiko_category_id: 'hidden', is_hidden: true }],
    getCustomProducts: async () => [
      { id: 'hidden-custom', name: 'D', category_name: ' кофе ', price: 100 },
      { id: 'visible-custom', name: 'E', category_name: 'Булочки', price: 100 },
      {
        id: 'delivery-custom',
        name: 'F',
        category_name: 'Булочки',
        price: 100,
        fulfillment_types: ['delivery'],
      },
    ],
  });
  cacheModule(settingsPath, { getSettings: async () => ({ bonus_promocodes: [] }) });
  delete require.cache[orderPath];

  try {
    const { loadOrderCatalog } = require(orderPath);
    const pickupCatalog = await loadOrderCatalog({ orderType: 'pickup' });
    const preorderCatalog = await loadOrderCatalog({ orderType: 'preorder' });
    const deliveryCatalog = await loadOrderCatalog({ orderType: 'delivery' });
    assert.deepEqual([...pickupCatalog.keys()], ['visible-product', 'visible-custom']);
    assert.deepEqual(
      [...preorderCatalog.keys()],
      ['visible-product', 'preorder-product', 'visible-custom'],
    );
    assert.deepEqual(
      [...deliveryCatalog.keys()],
      ['visible-product', 'visible-custom', 'delivery-custom'],
    );
  } finally {
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
});
