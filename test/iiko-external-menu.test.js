const assert = require('node:assert/strict');
const test = require('node:test');

const fetchPath = require.resolve('node-fetch');
const servicePath = require.resolve('../src/services/iiko.service');
const organizationId = '11111111-1111-4111-8111-111111111111';
const managedEnvironment = [
  'IIKO_EXTERNAL_MENU_ID',
  'IIKO_EXTERNAL_MENU_NAME',
  'IIKO_PRICE_CATEGORY_ID',
  'IIKO_PRICE_CATEGORY_NAME',
  'IIKO_MENU_CACHE_TTL_SECONDS',
  'IIKO_EMPTY_MENU_CACHE_TTL_SECONDS',
];

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return payload;
  },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  },
});

const v1Menu = (price = 100) => ({
  groups: [{ id: 'v1-group', name: 'Nomenclature' }],
  products: [
    {
      id: 'product-1',
      name: 'Плюшка v1',
      parentGroup: 'v1-group',
      sizePrices: [{ price: { currentPrice: price } }],
    },
  ],
});

const externalItems = (
  price,
  name = 'Плюшка External',
  {
    priceShape = 'organizationId',
    categoryOverrides = {},
    itemOverrides = {},
    sizeOverrides = {},
  } = {},
) => ({
  id: 17,
  name: 'Основное меню',
  formatVersion: 2,
  itemCategories: [
    {
      id: 'external-group',
      name: 'Выпечка',
      isHidden: false,
      ...categoryOverrides,
      items: [
        {
          itemId: 'product-1',
          name,
          type: 'DISH',
          orderItemType: 'Product',
          isHidden: false,
          ...itemOverrides,
          itemSizes: [
            {
              sizeId: 'size-1',
              isDefault: true,
              isHidden: false,
              prices: [
                priceShape === 'organizations'
                  ? { organizations: [organizationId], price }
                  : { organizationId, price },
              ],
              ...sizeOverrides,
            },
          ],
        },
      ],
    },
  ],
});

async function withIikoService({ environment = {}, fetchMock }, callback) {
  const previousFetch = require.cache[fetchPath];
  const previousService = require.cache[servicePath];
  const previousEnvironment = new Map(managedEnvironment.map((key) => [key, process.env[key]]));
  for (const key of managedEnvironment) delete process.env[key];
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: fetchMock,
  };
  delete require.cache[servicePath];

  try {
    const service = require(servicePath);
    service.getToken = async () => 'test-token';
    service.getOrganizationId = async () => organizationId;
    return await callback(service);
  } finally {
    delete require.cache[servicePath];
    if (previousService) require.cache[servicePath] = previousService;
    if (previousFetch) require.cache[fetchPath] = previousFetch;
    else delete require.cache[fetchPath];
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('External Menu price wins even when nomenclature v1 is non-empty', async () => {
  let externalPrice = 650;
  let externalItemRequests = 0;
  let nomenclatureRequests = 0;
  let requestedVersion = null;
  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse(v1Menu(100));
    }
    if (path === '/api/2/menu') {
      assert.deepEqual(JSON.parse(options.body), { organizationIds: [organizationId] });
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') {
      externalItemRequests += 1;
      requestedVersion = JSON.parse(options.body).version;
      return jsonResponse(externalItems(externalPrice));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService(
    {
      environment: { IIKO_MENU_CACHE_TTL_SECONDS: '45' },
      fetchMock,
    },
    async (service) => {
      const first = await service.getMenu({ strict: true, forceRefresh: true });
      assert.equal(first.menuSource, 'external-v2');
      assert.ok(Date.parse(first.fetchedAt));
      assert.equal(first.products[0].sizePrices[0].price.currentPrice, 650);
      assert.equal(first.products[0].sizePrices[0].sizeId, 'size-1');
      assert.equal(requestedVersion, 2);
      assert.ok(service.cachedMenuExpiresAt - Date.now() <= 45_000);
      assert.ok(service.cachedMenuExpiresAt - Date.now() > 40_000);

      externalPrice = 700;
      const cached = await service.getMenu({ strict: true });
      assert.equal(cached.products[0].sizePrices[0].price.currentPrice, 650);
      assert.equal(externalItemRequests, 1);

      const refreshed = await service.getMenu({ strict: true, forceRefresh: true });
      assert.equal(refreshed.products[0].sizePrices[0].price.currentPrice, 700);
      assert.equal(externalItemRequests, 2);
      assert.equal(nomenclatureRequests, 0);
    },
  );
});

test('External Menu restores a canonical name when full name contains composition', async () => {
  let nomenclatureRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') {
      return jsonResponse(externalItems(750, 'Құрамы: ұн, тұз, шұжық'));
    }
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse({
        groups: [{ id: 'v1-group', name: 'ХЛЕБА' }],
        products: [
          {
            id: 'product-1',
            name: 'Хот дог',
            parentGroup: 'v1-group',
            sizePrices: [{ price: { currentPrice: 750 } }],
          },
        ],
      });
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const menu = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(menu.products[0].name, 'Хот дог');
    assert.equal(menu.products[0].description, '');
    assert.equal(nomenclatureRequests, 1);
  });
});

test('External Menu matches both grouped and direct organization price shapes', async () => {
  let groupedShape = true;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') {
      const payload = externalItems(groupedShape ? 720 : 740);
      payload.itemCategories[0].items[0].itemSizes[0].prices = groupedShape
        ? [
            {
              organizations: ['22222222-2222-4222-8222-222222222222'],
              price: 999,
            },
            { organizations: [organizationId], price: 720 },
          ]
        : [{ organizationId, price: 740 }];
      return jsonResponse(payload);
    }
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu());
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const grouped = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(grouped.products[0].sizePrices[0].price.currentPrice, 720);

    groupedShape = false;
    const direct = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(direct.products[0].sizePrices[0].price.currentPrice, 740);
  });
});

test('External Menu excludes hidden content and prefers a visible default size', async () => {
  const payload = externalItems(100);
  const visibleItem = payload.itemCategories[0].items[0];
  visibleItem.itemSizes = [
    {
      sizeId: 'size-first',
      isDefault: false,
      isHidden: false,
      prices: [{ organizationId, price: 410 }],
    },
    {
      sizeId: 'size-hidden-default',
      isDefault: true,
      isHidden: true,
      prices: [{ organizationId, price: 999 }],
    },
    {
      sizeId: 'size-visible-default',
      isDefault: true,
      isHidden: false,
      prices: [{ organizationId, price: 650 }],
    },
  ];
  payload.itemCategories[0].items.push({
    ...visibleItem,
    itemId: 'hidden-product',
    name: 'Скрытая позиция',
    isHidden: true,
  });
  payload.itemCategories.push({
    id: 'hidden-category',
    name: 'Скрытая категория',
    isHidden: true,
    items: [{ ...visibleItem, itemId: 'hidden-category-product' }],
  });

  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') return jsonResponse(payload);
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu());
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const menu = await service.getMenu({ strict: true, forceRefresh: true });
    assert.deepEqual(
      menu.groups.map((group) => group.id),
      ['external-group'],
    );
    assert.deepEqual(
      menu.products.map((product) => product.id),
      ['product-1'],
    );
    assert.equal(menu.products[0].sizePrices[0].sizeId, 'size-visible-default');
    assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 650);
  });
});

test('configured External Menu ID selects the requested menu', async () => {
  let selectedMenuId = null;
  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu());
    if (path === '/api/2/menu') {
      return jsonResponse({
        externalMenus: [
          { id: 'menu-first', name: 'Первое меню' },
          { id: 'menu-configured', name: 'Нужное меню' },
        ],
      });
    }
    if (path === '/api/2/menu/by_id') {
      selectedMenuId = JSON.parse(options.body).externalMenuId;
      return jsonResponse(externalItems(800));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService(
    {
      environment: { IIKO_EXTERNAL_MENU_ID: 'menu-configured' },
      fetchMock,
    },
    async (service) => {
      const menu = await service.getMenu({ strict: true, forceRefresh: true });
      assert.equal(selectedMenuId, 'menu-configured');
      assert.equal(menu.externalMenuId, 'menu-configured');
      assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 800);
    },
  );
});

test('a single iiko price category is selected automatically', async () => {
  let menuRequest = null;
  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({
        externalMenus: [{ id: 'menu-main', name: 'Основное меню' }],
        priceCategories: [{ id: 'price-main', name: 'Основной прайс' }],
      });
    }
    if (path === '/api/2/menu/by_id') {
      menuRequest = JSON.parse(options.body);
      return jsonResponse(externalItems(300));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const menu = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(menuRequest.priceCategoryId, 'price-main');
    assert.equal(menu.priceSource, 'price-category');
    assert.equal(menu.priceCategoryId, 'price-main');
    assert.equal(menu.priceCategoryName, 'Основной прайс');
    assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 300);
  });
});

test('configured iiko price category is selected when several are available', async () => {
  let menuRequest = null;
  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({
        externalMenus: [{ id: 'menu-main', name: 'Основное меню' }],
        priceCategories: [
          { id: 'price-astana', name: 'Астана' },
          { id: 'price-aktau', name: 'Актау' },
        ],
      });
    }
    if (path === '/api/2/menu/by_id') {
      menuRequest = JSON.parse(options.body);
      return jsonResponse(externalItems(310));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService(
    {
      environment: { IIKO_PRICE_CATEGORY_NAME: 'актау' },
      fetchMock,
    },
    async (service) => {
      const menu = await service.getMenu({ strict: true, forceRefresh: true });
      assert.equal(menuRequest.priceCategoryId, 'price-aktau');
      assert.equal(menu.priceCategoryId, 'price-aktau');
      assert.equal(menu.priceCategoryName, 'Актау');
    },
  );
});

test('configured missing iiko price category fails closed', async () => {
  let itemRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({
        externalMenus: [{ id: 'menu-main', name: 'Основное меню' }],
        priceCategories: [{ id: 'price-other', name: 'Другой прайс' }],
      });
    }
    if (path === '/api/2/menu/by_id') {
      itemRequests += 1;
      return jsonResponse(externalItems(999));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService(
    {
      environment: { IIKO_PRICE_CATEGORY_ID: 'price-required' },
      fetchMock,
    },
    async (service) => {
      await assert.rejects(
        service.getMenu({ strict: true, forceRefresh: true }),
        /Меню временно недоступно/,
      );
      assert.equal(itemRequests, 0);
      assert.equal(service.cachedMenu, null);
    },
  );
});

test('configured External Menu name is matched case-insensitively', async () => {
  let selectedMenuId = null;
  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu());
    if (path === '/api/2/menu') {
      return jsonResponse({
        externalMenus: [
          { id: 'menu-first', name: 'Первое меню' },
          { id: 'menu-configured', name: 'Актау Основное' },
        ],
      });
    }
    if (path === '/api/2/menu/by_id') {
      selectedMenuId = JSON.parse(options.body).externalMenuId;
      return jsonResponse(externalItems(900));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService(
    {
      environment: { IIKO_EXTERNAL_MENU_NAME: 'актау основное' },
      fetchMock,
    },
    async (service) => {
      const menu = await service.getMenu({ strict: true, forceRefresh: true });
      assert.equal(selectedMenuId, 'menu-configured');
      assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 900);
    },
  );
});

test('nomenclature is used only when an unconfigured account has no External Menu', async () => {
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu(175));
    if (path === '/api/2/menu') return jsonResponse({ externalMenus: [] });
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const menu = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(menu.menuSource, 'nomenclature-v1');
    assert.ok(Date.parse(menu.fetchedAt));
    assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 175);
  });
});

test('configured External Menu fails closed on a cold-start transport error', async () => {
  let nomenclatureRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') return jsonResponse('external menu unavailable', 503);
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse(v1Menu(175));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService(
    {
      environment: { IIKO_EXTERNAL_MENU_ID: 'menu-main' },
      fetchMock,
    },
    async (service) => {
      await assert.rejects(
        service.getMenu({ strict: true, forceRefresh: true }),
        /Меню временно недоступно/,
      );
      assert.equal(nomenclatureRequests, 0);
      assert.equal(service.cachedMenu, null);
    },
  );
});

test('an empty External Menu is authoritative and never exposes nomenclature products', async () => {
  let nomenclatureRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') {
      return jsonResponse({
        id: 17,
        name: 'Основное меню',
        formatVersion: 2,
        itemCategories: [],
      });
    }
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse(v1Menu(175));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const menu = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(menu.menuSource, 'external-v2');
    assert.deepEqual(menu.groups, []);
    assert.deepEqual(menu.products, []);
    assert.equal(nomenclatureRequests, 0);
    assert.equal(service.cachedExternalMenu.menuSource, 'external-v2');
  });
});

test('a transient External Menu failure keeps the last known external menu', async () => {
  let externalAvailable = true;
  let nomenclatureRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      if (!externalAvailable) return jsonResponse('external menu unavailable', 503);
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') return jsonResponse(externalItems(680));
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse(v1Menu(175));
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const fresh = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(fresh.products[0].sizePrices[0].price.currentPrice, 680);

    externalAvailable = false;
    const stale = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(stale.menuSource, 'external-v2');
    assert.equal(stale.isStale, true);
    assert.equal(stale.products[0].sizePrices[0].price.currentPrice, 680);
    assert.equal(nomenclatureRequests, 0);
  });
});

test('required External Menu refresh rejects stale cache without replacing it', async () => {
  let externalAvailable = true;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      if (!externalAvailable) return jsonResponse('external menu unavailable', 503);
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') return jsonResponse(externalItems(690));
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu(175));
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    await service.getMenu({ strict: true, forceRefresh: true });
    externalAvailable = false;

    await assert.rejects(
      service.getMenu({
        strict: true,
        forceRefresh: true,
        requireExternal: true,
      }),
      /Меню временно недоступно/,
    );
    assert.equal(service.cachedExternalMenu.products[0].sizePrices[0].price.currentPrice, 690);
    assert.equal(service.cachedExternalMenu.isStale, undefined);
  });
});

test('unsupported External Menu response shape fails closed', async () => {
  let nomenclatureRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') {
      return jsonResponse({ formatVersion: 3, itemGroups: [] });
    }
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse(v1Menu());
    }
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    await assert.rejects(
      service.getMenu({ strict: true, forceRefresh: true }),
      /Меню временно недоступно/,
    );
    assert.equal(nomenclatureRequests, 0);
  });
});

test('authoritative External Menu does not call a failing nomenclature v1 endpoint', async () => {
  let nomenclatureRequests = 0;
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/1/nomenclature') {
      nomenclatureRequests += 1;
      return jsonResponse('nomenclature unavailable', 503);
    }
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') return jsonResponse(externalItems(950));
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const menu = await service.getMenu({ strict: true, forceRefresh: true });
    assert.equal(menu.menuSource, 'external-v2');
    assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 950);
    assert.equal(nomenclatureRequests, 0);
  });
});

test('force refresh waits for an in-flight normal fetch and then performs a fresh request', async () => {
  let externalItemRequests = 0;
  let releaseFirstRequest;
  let markFirstRequestStarted;
  const firstRequestStarted = new Promise((resolve) => {
    markFirstRequestStarted = resolve;
  });
  const firstRequestGate = new Promise((resolve) => {
    releaseFirstRequest = resolve;
  });
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-main', name: 'Основное меню' }] });
    }
    if (path === '/api/2/menu/by_id') {
      externalItemRequests += 1;
      if (externalItemRequests === 1) {
        markFirstRequestStarted();
        await firstRequestGate;
        return jsonResponse(externalItems(610));
      }
      return jsonResponse(externalItems(710));
    }
    if (path === '/api/1/nomenclature') return jsonResponse(v1Menu());
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const normalFetch = service.getMenu({ strict: true });
    await firstRequestStarted;

    const forcedFetch = service.getMenu({
      strict: true,
      forceRefresh: true,
      requireExternal: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(externalItemRequests, 1);

    releaseFirstRequest();
    const [normalMenu, forcedMenu] = await Promise.all([normalFetch, forcedFetch]);
    assert.equal(normalMenu.products[0].sizePrices[0].price.currentPrice, 610);
    assert.equal(forcedMenu.products[0].sizePrices[0].price.currentPrice, 710);
    assert.equal(externalItemRequests, 2);
  });
});

test('secondary city profile namespaces public ids but keeps original iiko ids for checkout', async () => {
  const fetchMock = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/2/menu') {
      return jsonResponse({ externalMenus: [{ id: 'menu-astana', name: 'Астана' }] });
    }
    if (path === '/api/2/menu/by_id') return jsonResponse(externalItems(880, 'Астанинская'));
    throw new Error(`Unexpected iiko request: ${path}`);
  };

  await withIikoService({ fetchMock }, async (service) => {
    const astana = new service.IikoAPI({
      profileKey: 'astana',
      apiLogin: 'astana-api-login-12345678901',
      organizationId,
    });
    astana.getToken = async () => 'astana-token';

    const menu = await astana.getMenu({ strict: true, forceRefresh: true });
    assert.equal(menu.profileKey, 'astana');
    assert.equal(menu.products[0].id, 'astana:product-1');
    assert.equal(menu.products[0].iikoProductId, 'product-1');
    assert.equal(menu.products[0].parentGroup, 'astana:external-group');
    assert.equal(menu.groups[0].id, 'astana:external-group');
    assert.equal(menu.groups[0].iikoCategoryId, 'external-group');
    assert.equal(menu.products[0].sizePrices[0].price.currentPrice, 880);
  });
});
