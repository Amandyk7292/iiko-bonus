const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createChatgptCatalogService,
  publicImageUrl,
} = require('../src/services/chatgpt-catalog.service');

const branchId = '89f46387-37aa-4916-b3bb-9d453028cb51';
const branch = {
  id: branchId,
  name: '19-й микрорайон',
  city: 'Актау',
  cityId: 'aktau',
  address: '19-й микрорайон, 33',
  active: true,
  pickupEnabled: true,
  deliveryEnabled: false,
  preorderEnabled: true,
  hours: { daily: { open: '08:00', close: '21:00', private_note: 'secret' } },
  inventory_token: 'secret',
};
const product = {
  id: 'bun',
  name: 'Булочка',
  description: 'Свежая выпечка',
  categoryId: 'bread',
  price: 500,
  isAvailable: true,
  onlineOrderable: true,
  inStopList: false,
  quantityStep: 0.1,
  unit: 'кг',
  availableQuantity: 2.5,
  inStockCount: 2.5,
  fulfillmentTypes: ['pickup', 'preorder'],
  ingredients: 'Мука, масло',
  allergens: ['Глютен'],
  nutrition: { caloriesKcal: 200, proteinGrams: 5 },
  employee_notes: 'secret',
};
const menu = {
  categories: [{ id: 'bread', name: 'Выпечка', internal_cost: 100 }],
  products: [product],
  revision: 1000,
  iikoProfile: 'private-profile',
};
const service = (extra = {}) =>
  createChatgptCatalogService({
    loadLocations: async () => [branch],
    loadMenu: async () => menu,
    loadOptionFlags: async (ids) => new Map(ids.map((id) => [id, false])),
    loadOptions: async () => new Map(),
    ...extra,
  });

test('ChatGPT lists only active public branches and supports city then point search', async () => {
  const catalog = service({
    loadLocations: async () => [
      branch,
      { ...branch, id: 'astana', name: 'Улы Дала', city: 'Астана', cityId: 'astana' },
      { ...branch, id: 'archived', active: false },
    ],
  });
  const result = await catalog.findBranches({ city: 'АКТАУ', query: '19-й' });
  assert.deepEqual(result.cities, ['Актау', 'Астана']);
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0].id, branchId);
  assert.equal(result.branches[0].inventory_token, undefined);
  assert.equal(result.branches[0].hours.daily.private_note, undefined);
  assert.equal((await catalog.findBranches({ city: 'astana' })).branches[0].id, 'astana');
});

test('ChatGPT shares public prices and stock with the app without exposing internal fields', async () => {
  let request;
  const catalog = service({
    loadMenu: async (input) => {
      request = input;
      return {
        ...menu,
        products: [{ ...product, isAvailable: false, onlineOrderable: false, inStopList: true }],
      };
    },
  });
  const result = await catalog.getMenu({ branchId, language: 'kk-KZ', orderType: 'preorder' });
  assert.deepEqual(request, { branchId, language: 'kk', orderType: 'preorder' });
  const item = result.products[0];
  assert.equal(item.price, product.price);
  assert.equal(item.quantityStep, 0.1);
  assert.equal(item.availableQuantity, 2.5);
  assert.equal(item.unit, 'кг');
  assert.equal(item.inStopList, true);
  assert.equal(item.onlineOrderable, false);
  assert.equal(item.nutrition.caloriesKcal, 200);
  assert.deepEqual(item.allergens, ['Глютен']);
  assert.equal(item.employee_notes, undefined);
  assert.equal(result.iikoProfile, undefined);
  assert.equal(result.categories[0].internal_cost, undefined);
});

test('ChatGPT refuses unsupported branches and fails closed on a public menu source error', async () => {
  let loaded = false;
  const catalog = service({
    loadMenu: async () => {
      loaded = true;
      return menu;
    },
  });
  await assert.rejects(catalog.getMenu({ branchId, orderType: 'delivery' }), /временно недоступен/);
  assert.equal(loaded, false);
  await assert.rejects(catalog.getMenu({ branchId: 'unknown' }), { statusCode: 404 });
  const unavailable = service({
    loadMenu: async () => {
      throw new Error('strict source failed');
    },
  });
  await assert.rejects(unavailable.getMenu({ branchId }), /strict source failed/);
});

test('ChatGPT paginates filtered products and checks a product remains published before returning options', async () => {
  let optionsReads = 0;
  const catalog = service({
    loadMenu: async () => ({
      ...menu,
      products: [product, { ...product, id: 'bun2' }, { ...product, id: 'milk', name: 'Молоко' }],
    }),
    loadOptionFlags: async (ids) => new Map(ids.map((id) => [id, true])),
    loadOptions: async () => {
      optionsReads++;
      return new Map([
        [
          'bun',
          {
            configuration: null,
            modifierGroups: [
              {
                id: 'size',
                productId: 'bun',
                code: 'size',
                title: { ru: 'Размер' },
                selectionType: 'single',
                required: true,
                minSelected: 1,
                maxSelected: 1,
                private_cost: 2,
                options: [
                  {
                    id: 'large',
                    code: 'large',
                    title: { ru: 'Большой' },
                    priceDelta: 100,
                    private_cost: 1,
                  },
                ],
              },
            ],
          },
        ],
      ]);
    },
  });
  const result = await catalog.getMenu({ branchId, query: 'булоч', limit: 1, offset: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.products[0].id, 'bun2');
  assert.equal(result.products[0].hasOptions, true);
  assert.equal(result.hasMore, false);
  await assert.rejects(catalog.getMenu({ branchId, limit: 500 }), /страница меню/);
  await assert.rejects(catalog.getProductOptions({ branchId, productId: 'hidden' }), {
    statusCode: 404,
  });
  assert.equal(optionsReads, 0);
  const optionResult = await catalog.getProductOptions({ branchId, productId: 'bun' });
  const group = optionResult.options.modifierGroups[0];
  assert.equal(group.options[0].priceDelta, 100);
  assert.equal(group.private_cost, undefined);
  assert.equal(group.options[0].private_cost, undefined);
});

test('ChatGPT image URLs use only Bulka and permitted public image storage paths', (t) => {
  const previousStorage = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://storage.example';
  t.after(() => {
    if (previousStorage === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousStorage;
  });
  const base = 'https://bulka.com.kz';
  const image = new URL(
    publicImageUrl('https://storage.example/storage/v1/object/public/menu_images/bun.jpg', base),
  );
  assert.equal(image.origin, base);
  assert.equal(image.pathname, '/api/public/image');
  assert.equal(image.searchParams.get('path'), 'menu_images/bun.jpg');
  assert.equal(image.searchParams.get('edge'), '384');
  assert.equal(
    publicImageUrl('https://storage.example/storage/v1/object/private/menu_images/bun.jpg', base),
    null,
  );
  assert.equal(publicImageUrl('https://external.example/food.jpg', base), null);
  assert.equal(
    publicImageUrl('http://storage.example/storage/v1/object/public/menu_images/bun.jpg', base),
    null,
  );
  assert.equal(publicImageUrl('https://user:secret@bulka.com.kz/food.jpg', base), null);
});
