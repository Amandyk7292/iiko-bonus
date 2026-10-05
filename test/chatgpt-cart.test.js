const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const {
  chatgptCartPrepareSchema,
  chatgptCartResolveSchema,
} = require('../src/contracts/chatgpt-cart.contract');
const {
  createChatgptCartService,
  TOKEN_TTL_SECONDS,
} = require('../src/services/chatgpt-cart.service');
const {
  validateBuilder,
  validateModifierGroups,
} = require('../src/services/product-options.service');

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'cart-test-signing-secret-with-32-characters-2026';
const NOW = Date.parse('2026-10-05T06:00:00Z');
const defaultProduct = () => ({
  id: 'croissant',
  name: 'Круассан',
  price: 900,
  categoryId: 'bakery',
  imageUrl: 'https://bulka.com.kz/images/croissant.webp',
  description: 'Сливочный круассан',
  isAvailable: true,
  onlineOrderable: true,
  inStopList: false,
  availableQuantity: 10,
  quantityStep: 1,
  unit: 'шт.',
  preparationMinutes: 15,
  staffPhone: 'private',
  supplierCosts: 123,
  internalInstructions: 'not public',
});
const request = (overrides = {}) => ({
  branchId: BRANCH_ID,
  items: [{ id: 'croissant', quantity: 2 }],
  ...overrides,
});
const configuration = () => ({
  enabled: true,
  productKind: 'cake',
  minLeadHours: 24,
  maxAdvanceDays: 30,
  allowInscription: true,
  allowCandles: true,
  allowReferenceUpload: true,
  weightOptions: [{ code: 'one_kg', title: { ru: '1 кг', en: '1 kg' }, priceDelta: 500 }],
  fillingOptions: [{ code: 'vanilla', title: { ru: 'Ваниль' }, priceDelta: 200 }],
  designOptions: [],
});
const modifierGroup = () => ({
  id: 'packaging-id',
  code: 'packaging',
  title: { ru: 'Упаковка' },
  selectionType: 'single',
  required: true,
  minSelected: 1,
  maxSelected: 1,
  options: [
    { id: 'box-id', code: 'box', title: { ru: 'Коробка' }, priceDelta: 100, isDefault: true },
  ],
});

function fixture({
  product = defaultProduct(),
  options = { configuration: null, modifierGroups: [] },
  ordering = { disabled: false },
  env = {},
  loadDelay = false,
} = {}) {
  let timestamp = NOW;
  const state = {
    product,
    options,
    ordering,
    branch: {
      id: BRANCH_ID,
      name: '19-й микрорайон',
      city: 'Актау',
      address: '19 мкр, 33',
      active: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      preorderEnabled: true,
      password: 'private',
    },
    catalogReads: 0,
    optionReads: 0,
    capturedQuery: null,
  };
  const service = createChatgptCartService({
    loadCatalog: async (query) => {
      state.catalogReads++;
      state.capturedQuery = query;
      if (loadDelay) timestamp += TOKEN_TTL_SECONDS * 1000;
      return { branch: state.branch, products: [state.product] };
    },
    loadOptions: async (ids) => {
      state.optionReads++;
      return new Map(ids.map((id) => [id, state.options]));
    },
    loadOrderingConfig: async () => state.ordering,
    env: { CUSTOMER_JWT_SECRET: SECRET, PUBLIC_BASE_URL: 'https://bulka.com.kz', ...env },
    now: () => timestamp,
  });
  return {
    state,
    service,
    setNow: (value) => {
      timestamp = value;
    },
  };
}
const tokenFor = (draft) => new URL(draft.checkoutUrl).searchParams.get('chatgptCart');
const payloadOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const isError = (code, statusCode) => (error) =>
  error.code === code && error.statusCode === statusCode && error.expose === true;
function signForTest(payload, secret = SECRET) {
  const key = crypto.hkdfSync(
    'sha256',
    Buffer.from(secret),
    Buffer.from('bulka-cart-v1'),
    Buffer.from('bulka:chatgpt-cart:web:v1'),
    32,
  );
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(`bc1.${encoded}`).digest('base64url');
  return `bc1.${encoded}.${signature}`;
}

test('cart resolves server menu prices into a whitelisted anonymous draft and trusted checkout URL', async () => {
  const { state, service } = fixture();
  const draft = await service.prepareCart(request({ language: 'en', orderType: 'pickup' }));
  assert.deepEqual(state.capturedQuery, {
    branchId: BRANCH_ID,
    orderType: 'pickup',
    language: 'en',
  });
  assert.equal(draft.itemSubtotal, 1800);
  assert.equal(draft.pricingScope, 'items_only');
  assert.equal(draft.currency, 'KZT');
  assert.equal(draft.items[0].price, 900);
  assert.equal(draft.items[0].lineTotal, 1800);
  assert.equal(draft.items[0].unit, 'шт.');
  assert.equal(draft.items[0].product.staffPhone, undefined);
  assert.equal(draft.items[0].product.supplierCosts, undefined);
  assert.equal(draft.items[0].product.internalInstructions, undefined);
  assert.equal(draft.branch.password, undefined);
  assert.equal(new URL(draft.checkoutUrl).origin, 'https://bulka.com.kz');
  assert.equal(new URL(draft.checkoutUrl).pathname, '/');
  assert.equal(Date.parse(draft.expiresAt), NOW + TOKEN_TTL_SECONDS * 1000);
  const token = tokenFor(draft);
  const payload = payloadOf(token);
  assert.deepEqual(payload.cart, request({ orderType: 'pickup', language: 'en' }));
  assert.equal(payload.purpose, 'cart-handoff');
  assert.equal(payload.aud, 'bulka:chatgpt-cart:web:v1');
  assert.equal(payload.cart.items[0].price, undefined);
  assert.equal(payload.customerId, undefined);
  assert.equal(chatgptCartResolveSchema.safeParse({ token }).success, true);
  const resolved = await service.resolveCart(token);
  assert.equal(resolved.itemSubtotal, 1800);
  assert.equal(state.catalogReads, 2);
  assert.equal(state.optionReads, 2);
});

test('strict input rejects PII, caller prices, checkout URLs, unbounded lines and invalid quantities', async () => {
  const { service, state } = fixture();
  const invalid = [
    request({ customerId: 'private-id' }),
    request({ checkoutUrl: 'https://evil.test' }),
    request({ items: [{ id: 'croissant', quantity: 1, price: 1 }] }),
    request({ items: [{ id: 'croissant', quantity: 1, name: 'Fake' }] }),
    request({
      items: [{ id: 'croissant', quantity: 1, configuration: { inscription: 'my name' } }],
    }),
    request({
      items: [
        { id: 'croissant', quantity: 1, configuration: { referenceUrl: 'https://evil.test' } },
      ],
    }),
    request({ items: [{ id: 'croissant', quantity: 0 }] }),
    request({ items: [{ id: 'croissant', quantity: 100 }] }),
    request({ items: [{ id: 'croissant', quantity: 1.0001 }] }),
    request({ items: [{ id: 'croissant', quantity: '1' }] }),
    request({ items: [] }),
    request({ items: Array.from({ length: 21 }, () => ({ id: 'croissant', quantity: 1 })) }),
    request({ branchId: 'not-a-branch' }),
    request({ orderType: 'anything' }),
  ];
  for (const input of invalid) {
    assert.equal(chatgptCartPrepareSchema.safeParse(input).success, false);
    await assert.rejects(service.prepareCart(input), isError('CHATGPT_CART_INVALID', 400));
  }
  assert.equal(state.catalogReads, 0);
  assert.equal(
    chatgptCartResolveSchema.safeParse({ token: 'anything', phone: 'private' }).success,
    false,
  );
});

test('unknown, stopped or nonorderable products cannot produce a checkout draft', async () => {
  for (const product of [
    { ...defaultProduct(), id: 'other' },
    { ...defaultProduct(), isAvailable: false },
    { ...defaultProduct(), onlineOrderable: false },
    { ...defaultProduct(), inStopList: true },
  ]) {
    await assert.rejects(
      fixture({ product }).service.prepareCart(request()),
      isError('CHATGPT_CART_UNAVAILABLE', 409),
    );
  }
});

test('fractional quantity follows branch units and stock aggregates across variant lines', async () => {
  const { service } = fixture({
    product: {
      ...defaultProduct(),
      price: 2000,
      quantityStep: 0.001,
      unit: 'кг',
      availableQuantity: 2,
    },
  });
  const draft = await service.prepareCart(
    request({ items: [{ id: 'croissant', quantity: 0.75 }] }),
  );
  assert.equal(draft.itemSubtotal, 1500);
  assert.equal(draft.items[0].unit, 'кг');
  assert.equal(draft.items[0].quantityStep, 0.001);
  await assert.rejects(
    service.prepareCart(
      request({
        items: [
          { id: 'croissant', quantity: 1.5 },
          { id: 'croissant', quantity: 0.75 },
        ],
      }),
    ),
    isError('CHATGPT_CART_UNAVAILABLE', 409),
  );
  await assert.rejects(
    fixture().service.prepareCart(
      request({
        items: [
          { id: 'croissant', quantity: 0.5 },
          { id: 'croissant', quantity: 0.5 },
        ],
      }),
    ),
    isError('CHATGPT_CART_INVALID', 400),
  );
  await assert.rejects(
    fixture({ product: { ...defaultProduct(), availableQuantity: null } }).service.prepareCart(
      request({
        items: [
          { id: 'croissant', quantity: 50 },
          { id: 'croissant', quantity: 50 },
        ],
      }),
    ),
    isError('CHATGPT_CART_INVALID', 400),
  );
});

test('identical canonical variants merge into one cart line and round the same way as checkout', async () => {
  const fractional = fixture({
    product: { ...defaultProduct(), price: 1, quantityStep: 0.001, unit: 'кг' },
  });
  const draft = await fractional.service.prepareCart(
    request({
      items: [
        { id: 'croissant', quantity: 0.5 },
        { id: 'croissant', quantity: 0.5 },
      ],
    }),
  );
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].quantity, 1);
  assert.equal(draft.items[0].lineTotal, 1);
  assert.equal(draft.itemSubtotal, 1);
  assert.equal((await fractional.service.resolveCart(tokenFor(draft))).items.length, 1);
  const configured = fixture({
    options: { configuration: null, modifierGroups: [modifierGroup()] },
  });
  const combined = await configured.service.prepareCart(
    request({
      items: [
        { id: 'croissant', quantity: 1, modifiers: [{ groupId: 'packaging', optionIds: ['box'] }] },
        {
          id: 'croissant',
          quantity: 2,
          modifiers: [{ groupId: 'packaging-id', optionIds: ['box-id'] }],
        },
      ],
    }),
  );
  assert.equal(combined.items.length, 1);
  assert.equal(combined.items[0].quantity, 3);
  assert.equal(combined.itemSubtotal, 3000);
});

test('missing required options are explicit, full available choices remain visible and subtotal stays incomplete', async () => {
  const options = { configuration: configuration(), modifierGroups: [modifierGroup()] };
  const { service } = fixture({ options });
  const draft = await service.prepareCart(request());
  assert.equal(draft.requiresSelection, true);
  assert.equal(draft.itemSubtotal, null);
  assert.equal(draft.knownItemSubtotal, 1800);
  assert.equal(draft.items[0].product.hasConfigurableOptions, true);
  assert.equal(draft.items[0].options.configuration.enabled, true);
  assert.deepEqual(draft.items[0].options.configuration.weightOptions[0], {
    code: 'one_kg',
    title: { ru: '1 кг', kk: '1 кг', en: '1 kg' },
    priceDelta: 500,
  });
  assert.equal(draft.items[0].options.modifierGroups[0].options[0].isDefault, true);
  assert.deepEqual(draft.warnings.find((warning) => warning.code === 'OPTIONS_REQUIRED').fields, [
    'weight',
    'filling',
    'packaging-id',
  ]);
  assert.equal(draft.items[0].selectedOptions.configuration.readyAt, null);
  assert.equal(
    draft.warnings.some((warning) => warning.code === 'SCHEDULE_REQUIRED'),
    true,
  );
});

test('complete choices use real option prices and compact cart payload survives existing checkout validation', async () => {
  const options = { configuration: configuration(), modifierGroups: [modifierGroup()] };
  const { service } = fixture({ options });
  const draft = await service.prepareCart(
    request({
      items: [
        {
          id: 'croissant',
          quantity: 2,
          configuration: { weight: 'one_kg', filling: 'vanilla' },
          modifiers: [{ groupId: 'packaging', optionIds: ['box'] }],
        },
      ],
    }),
  );
  const line = draft.items[0];
  assert.equal(draft.requiresSelection, false);
  assert.equal(draft.itemSubtotal, 3400);
  assert.equal(line.price, 1700);
  assert.equal(line.basePrice, 900);
  assert.deepEqual(line.configuration, { weight: 'one_kg', filling: 'vanilla' });
  assert.deepEqual(line.modifiers, [{ groupId: 'packaging-id', optionIds: ['box-id'] }]);
  const selectedBuilder = validateBuilder(options.configuration, line.configuration, {
    now: NOW,
    scheduledAt: new Date(NOW + 25 * 3600000).toISOString(),
  });
  const selectedModifiers = validateModifierGroups(options.modifierGroups, line.modifiers);
  assert.equal(
    line.basePrice + selectedBuilder.priceDelta + selectedModifiers.priceDelta,
    line.price,
  );
  const payload = payloadOf(tokenFor(draft));
  assert.deepEqual(payload.cart.items[0].configuration, { weight: 'one_kg', filling: 'vanilla' });
  assert.equal(JSON.stringify(payload).includes('priceDelta'), false);
});

test('real Cyrillic option codes and labels remain selectable instead of being lost by the handoff', async () => {
  const options = { configuration: configuration(), modifierGroups: [modifierGroup()] };
  options.configuration.weightOptions[0].code = '1 кг';
  options.configuration.fillingOptions[0].code = 'ванильная';
  options.modifierGroups[0].code = 'упаковка';
  options.modifierGroups[0].options[0].code = 'коробка';
  const { service } = fixture({ options });
  const draft = await service.prepareCart(
    request({
      items: [
        {
          id: 'croissant',
          quantity: 1,
          configuration: { weight: '1 кг', filling: 'ванильная' },
          modifiers: [{ groupId: 'упаковка', optionIds: ['коробка'] }],
        },
      ],
    }),
  );
  assert.equal(draft.requiresSelection, false);
  assert.equal(draft.itemSubtotal, 1700);
  assert.deepEqual(draft.items[0].configuration, { weight: '1 кг', filling: 'ванильная' });
  assert.deepEqual(
    (await service.resolveCart(tokenFor(draft))).items[0].configuration,
    draft.items[0].configuration,
  );
});

test('invalid, deleted, duplicate alias or too many option choices never get silently discarded', async () => {
  const group = modifierGroup();
  group.selectionType = 'multiple';
  group.maxSelected = 2;
  const { service } = fixture({
    options: { configuration: configuration(), modifierGroups: [group] },
  });
  const common = {
    id: 'croissant',
    quantity: 1,
    configuration: { weight: 'one_kg', filling: 'vanilla' },
  };
  for (const [item, code] of [
    [{ ...common, configuration: { weight: 'deleted' } }, 'CHATGPT_CART_UNAVAILABLE'],
    [
      { ...common, modifiers: [{ groupId: 'deleted', optionIds: ['box-id'] }] },
      'CHATGPT_CART_UNAVAILABLE',
    ],
    [
      { ...common, modifiers: [{ groupId: 'packaging-id', optionIds: ['deleted'] }] },
      'CHATGPT_CART_UNAVAILABLE',
    ],
    [
      { ...common, modifiers: [{ groupId: 'packaging-id', optionIds: ['box-id', 'box'] }] },
      'CHATGPT_CART_INVALID',
    ],
    [
      { ...common, modifiers: [{ groupId: 'packaging-id', optionIds: ['a', 'b', 'c'] }] },
      'CHATGPT_CART_INVALID',
    ],
    [
      {
        ...common,
        modifiers: [
          { groupId: 'packaging-id', optionIds: ['box-id'] },
          { groupId: 'packaging-id', optionIds: ['box-id'] },
        ],
      },
      'CHATGPT_CART_INVALID',
    ],
  ])
    await assert.rejects(
      service.prepareCart(request({ items: [item] })),
      (error) => error.code === code,
    );
  await assert.rejects(
    fixture().service.prepareCart(request({ items: [common] })),
    isError('CHATGPT_CART_UNAVAILABLE', 409),
  );
});

test('resolve always checks current price, stock and option availability; no reservation or order is created', async () => {
  const { service, state } = fixture();
  const prepared = await service.prepareCart(request());
  const token = tokenFor(prepared);
  state.product.price = 1100;
  const fresh = await service.resolveCart(token);
  assert.equal(fresh.itemSubtotal, 2200);
  assert.equal(fresh.items[0].product.price, 1100);
  assert.equal(
    fresh.warnings.some((warning) => warning.code === 'PRICE_UPDATED'),
    true,
  );
  state.product.availableQuantity = 1;
  await assert.rejects(service.resolveCart(token), isError('CHATGPT_CART_UNAVAILABLE', 409));
  assert.equal(state.catalogReads, 3);
  const configured = fixture({
    options: { configuration: null, modifierGroups: [modifierGroup()] },
  });
  const configuredToken = tokenFor(
    await configured.service.prepareCart(
      request({
        items: [
          {
            id: 'croissant',
            quantity: 1,
            modifiers: [{ groupId: 'packaging-id', optionIds: ['box-id'] }],
          },
        ],
      }),
    ),
  );
  configured.state.options.modifierGroups[0].options = [];
  await assert.rejects(
    configured.service.resolveCart(configuredToken),
    isError('CHATGPT_CART_UNAVAILABLE', 409),
  );
});

test('expiry at exact deadline fails before reading live menu and expiry during reload also fails', async () => {
  const { service, state, setNow } = fixture();
  const prepared = await service.prepareCart(request());
  setNow(NOW + TOKEN_TTL_SECONDS * 1000);
  await assert.rejects(
    service.resolveCart(tokenFor(prepared)),
    isError('CHATGPT_CART_EXPIRED', 410),
  );
  assert.equal(state.catalogReads, 1);
  const delayed = fixture({ loadDelay: true });
  const second = await delayed.service.prepareCart(request());
  await assert.rejects(
    delayed.service.resolveCart(tokenFor(second)),
    isError('CHATGPT_CART_EXPIRED', 410),
  );
});

test('tampered tokens, wrong purpose/audience, auth JWTs and future issue times cannot act as cart links', async () => {
  const { service, state } = fixture();
  const token = tokenFor(await service.prepareCart(request()));
  const payload = payloadOf(token);
  const changed = {
    ...payload,
    cart: { ...payload.cart, items: [{ id: 'croissant', quantity: 9 }] },
  };
  const [, , signature] = token.split('.');
  const invalid = [
    `bc1.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`,
    signForTest({ ...payload, aud: 'customer-auth' }),
    signForTest({ ...payload, purpose: 'password-reset' }),
    signForTest({ ...payload, iat: payload.iat + 31, exp: payload.exp + 31 }),
    signForTest({ ...payload, exp: payload.exp + 1 }),
    signForTest({ ...payload, customerId: 'someone' }),
    signForTest(payload, `${SECRET}different`),
    jwt.sign({ sub: 'customer', ...payload }, SECRET),
    'bc1.invalid.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ];
  for (const candidate of invalid)
    await assert.rejects(service.resolveCart(candidate), isError('CHATGPT_CART_INVALID', 400));
  assert.equal(state.catalogReads, 1);
});

test('handoff blocks unavailable branch, disabled fulfillment and global ordering pause', async () => {
  const { service, state } = fixture();
  state.branch.deliveryEnabled = false;
  await assert.rejects(
    service.prepareCart(request({ orderType: 'delivery' })),
    isError('CHATGPT_CART_UNAVAILABLE', 409),
  );
  state.branch.preorderEnabled = false;
  await assert.rejects(
    service.prepareCart(request({ orderType: 'preorder' })),
    isError('CHATGPT_CART_UNAVAILABLE', 409),
  );
  state.branch.pickupEnabled = false;
  await assert.rejects(service.prepareCart(request()), isError('CHATGPT_CART_UNAVAILABLE', 409));
  state.branch.pickupEnabled = true;
  state.branch.active = false;
  await assert.rejects(service.prepareCart(request()), isError('CHATGPT_CART_UNAVAILABLE', 409));
  const paused = fixture({ ordering: { disabled: true } });
  await assert.rejects(
    paused.service.prepareCart(request()),
    isError('ONLINE_ORDERING_DISABLED', 503),
  );
  assert.equal(paused.state.catalogReads, 0);
  const active = fixture();
  const token = tokenFor(await active.service.prepareCart(request()));
  active.state.ordering.disabled = true;
  await assert.rejects(active.service.resolveCart(token), isError('ONLINE_ORDERING_DISABLED', 503));
});

test('strong purpose-derived secret is required and checkout destination never accepts an unsafe origin', async () => {
  for (const secret of ['', 'short']) {
    await assert.rejects(
      fixture({ env: { CUSTOMER_JWT_SECRET: secret } }).service.prepareCart(request()),
      (error) => error.code === 'CHATGPT_CART_CONFIGURATION' && error.expose === false,
    );
  }
  for (const publicBase of [
    'http://bulka.com.kz',
    'https://user:pass@bulka.com.kz',
    'https://bulka.com.kz/?next=evil',
    'https://bulka.com.kz/path',
  ]) {
    await assert.rejects(
      fixture({ env: { PUBLIC_BASE_URL: publicBase } }).service.prepareCart(request()),
      (error) => error.code === 'CHATGPT_CART_CONFIGURATION',
    );
  }
  const dedicated = fixture({ env: { CUSTOMER_JWT_SECRET: 'short', CHATGPT_CART_SECRET: SECRET } });
  assert.equal((await dedicated.service.prepareCart(request())).itemSubtotal, 1800);
});

test('invalid prices, bad stock and unsafe image URLs fail closed or remain out of public product output', async () => {
  for (const patch of [
    { price: -1 },
    { price: 900.5 },
    { price: Number.NaN },
    { availableQuantity: Number.NaN },
  ]) {
    await assert.rejects(
      fixture({ product: { ...defaultProduct(), ...patch } }).service.prepareCart(request()),
      isError('CHATGPT_CART_UNAVAILABLE', 409),
    );
  }
  const unsafe = fixture({ product: { ...defaultProduct(), imageUrl: 'javascript:alert(1)' } });
  assert.equal((await unsafe.service.prepareCart(request())).items[0].product.imageUrl, null);
});

test('fractional unit price is rejected consistently with the ordinary checkout quote, without rounding', async () => {
  const configPath = require.resolve('../src/config/supabase');
  const optionsPath = require.resolve('../src/services/product-options.service');
  const previousConfig = require.cache[configPath];
  const previousOptions = require.cache[optionsPath];
  const emptyQuery = {
    select() {
      return this;
    },
    in() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(resolve) {
      resolve({ data: [], error: null });
    },
  };
  let quoteOptions;
  try {
    require.cache[configPath] = {
      id: configPath,
      filename: configPath,
      loaded: true,
      exports: { supabase: { from: () => emptyQuery } },
    };
    delete require.cache[optionsPath];
    quoteOptions = require('../src/services/product-options.service');
  } finally {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousOptions) require.cache[optionsPath] = previousOptions;
    else delete require.cache[optionsPath];
  }
  await assert.rejects(
    quoteOptions.validateCartOptions([{ id: 'croissant', price: 500.5, quantity: 1 }]),
    /Некорректная цена опций/,
  );
  const { service } = fixture({ product: { ...defaultProduct(), price: 500.5 } });
  await assert.rejects(service.prepareCart(request()), isError('CHATGPT_CART_UNAVAILABLE', 409));
  const regular = await quoteOptions.validateCartOptions([
    { id: 'croissant', price: 500, quantity: 1 },
  ]);
  assert.equal(
    regular.subtotal,
    (
      await fixture({ product: { ...defaultProduct(), price: 500 } }).service.prepareCart(
        request({ items: [{ id: 'croissant', quantity: 1 }] }),
      )
    ).itemSubtotal,
  );
});
