const test = require('node:test');
const assert = require('node:assert/strict');
const iiko = require('../src/services/iiko.service');
const menuService = require('../src/services/menu.service');
const router = require('../src/routes/legacy.routes');
const handler = router.stack.find((layer) => layer.route?.path === '/api/guest/menu').route.stack[0]
  .handle;

const menu = {
  groups: [{ id: 'bread', name: 'Выпечка', isIncludedInMenu: true }],
  products: [
    {
      id: 'bun',
      name: 'Булочка',
      parentGroup: 'bread',
      type: 'Dish',
      sizePrices: [{ price: { currentPrice: 300 } }],
    },
  ],
};
const response = () => ({
  statusCode: 200,
  set() {
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('guest menu starts override reads before slow iiko completes and preserves strict stop lists', async (t) => {
  let finishMenu;
  const pendingMenu = new Promise((resolve) => {
    finishMenu = resolve;
  });
  const started = [];
  t.mock.method(iiko, 'getMenu', async (options) => {
    assert.equal(options.strict, true);
    return pendingMenu;
  });
  t.mock.method(iiko, 'getStopListProductIds', async (_, options) => {
    assert.equal(options.strict, true);
    return new Set(['bun']);
  });
  for (const method of ['getProductOverrides', 'getCategoryOverrides', 'getCustomProducts']) {
    t.mock.method(menuService, method, async (options) => {
      assert.equal(options.strict, true);
      assert.equal(options.profileKey, iiko.profileKey);
      started.push(method);
      return [];
    });
  }
  const res = response();
  const request = handler({ query: {}, headers: {} }, res);
  await new Promise(setImmediate);
  // Complete the deferred source even when the concurrency assertion fails.
  const startedBeforeMenu = [...started];
  finishMenu(menu);
  await request;
  assert.equal(startedBeforeMenu.length, 3);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.products[0].price, 300);
  assert.equal(res.body.products[0].onlineOrderable, false);
});

test('guest menu fails closed when an override source fails', async (t) => {
  t.mock.method(iiko, 'getMenu', async () => menu);
  t.mock.method(iiko, 'getStopListProductIds', async () => new Set());
  t.mock.method(menuService, 'getProductOverrides', async () => {
    throw new Error('source unavailable');
  });
  t.mock.method(menuService, 'getCategoryOverrides', async () => []);
  t.mock.method(menuService, 'getCustomProducts', async () => []);
  const res = response();
  await handler({ query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(res.body.products, undefined);
});
