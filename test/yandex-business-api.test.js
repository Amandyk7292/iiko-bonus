const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_BUSINESS_API_BASE_URL,
  assertBusinessConfigured,
  buildGeopoint,
  buildBusinessCreatePayload,
  buildBusinessQuotePayload,
  buildBusinessRoute,
  buildOrderCreatePayload,
  buildRouteStatsPayload,
  buildZoneCoordinates,
  createBusinessApiClient,
  filterSupportedRequirements,
  getBusinessApiConfigurationStatus,
  getBusinessConfig,
  isBusinessKnownStatus,
  isBusinessTerminalStatus,
  mapBusinessStatus,
  normalizeBusinessOrderInfo,
  normalizeBusinessOrderProgress,
  normalizeOAuthToken,
  parseLocalizedPrice,
  pickAvailableDeliveryClass,
  selectAvailableServiceLevel,
  selectBusinessQuote,
} = require('../src/services/yandex-business-api');

const origin = {
  longitude: 51.2011,
  latitude: 43.6499,
  fullname: 'Актау, 17-й микрорайон, 1',
};
const destination = {
  longitude: 51.1978,
  latitude: 43.6512,
  fullname: 'Актау, 17-й микрорайон, 34',
};

const zoneInfo = {
  currency_code: 'KZT',
  tariff_classes: [
    {
      name: 'courier',
      supported_requirements: [{ name: 'door_to_door', type: 'boolean' }],
    },
    {
      name: 'express',
      supported_requirements: [
        { name: 'thermobag', type: 'boolean' },
        {
          name: 'cargo_size',
          type: 'select',
          multiselect: false,
          select: {
            type: 'number',
            options: [
              { name: 'small', value: 1 },
              { name: 'large', value: 2 },
            ],
          },
        },
      ],
    },
  ],
};

const routeStats = {
  offer: 'offer-1',
  service_levels: [
    { class: 'courier', price: '1 090,00 ₸', is_fixed_price: false },
    { class: 'express', price: '1\u00a0250,50 ₸', is_fixed_price: true },
  ],
};

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (payload == null ? '' : JSON.stringify(payload)),
});

test('Business API builders preserve Yandex longitude-latitude coordinate order', () => {
  assert.equal(DEFAULT_BUSINESS_API_BASE_URL, 'https://b2b-api.go.yandex.ru/integration/2.0');
  assert.deepEqual(buildGeopoint(origin), [51.2011, 43.6499]);
  assert.deepEqual(buildZoneCoordinates(origin), { lat: 43.6499, lon: 51.2011 });

  const payload = buildRouteStatsPayload({
    origin,
    destination,
    userId: 'employee-1',
    requirements: { thermobag: true },
  });
  assert.deepEqual(payload, {
    route: [
      [51.2011, 43.6499],
      [51.1978, 43.6512],
    ],
    user_id: 'employee-1',
    requirements: { thermobag: true },
  });
});

test('order/create builder emits only the documented Business API fields', () => {
  const payload = buildOrderCreatePayload({
    route: [
      { ...origin, extra_data: { phone: 'must-not-pass' } },
      { ...destination, customerPhone: '+77001234567' },
    ],
    userId: 'employee-1',
    className: 'express',
    offer: 'offer-1',
    requirements: { thermobag: true },
    comment: 'Bulka, заказ №100042',
    costCenterValues: [{ id: 'purpose', title: 'Цель', value: 'Доставка' }],
  });

  assert.deepEqual(payload, {
    user_id: 'employee-1',
    route: [
      { geopoint: [51.2011, 43.6499], fullname: origin.fullname },
      { geopoint: [51.1978, 43.6512], fullname: destination.fullname },
    ],
    class: 'express',
    offer: 'offer-1',
    requirements: { thermobag: true },
    cost_center_values: [{ id: 'purpose', title: 'Цель', value: 'Доставка' }],
    comment: 'Bulka, заказ №100042',
  });
  assert.equal('extra_data' in payload.route[0], false);
  assert.equal('customerPhone' in payload.route[1], false);
});

test('route point builder whitelists supported courier contact fields only', () => {
  const payload = buildOrderCreatePayload({
    route: [
      {
        ...origin,
        porchnumber: '2',
        premisenumber: '18',
        secret: 'must-not-pass',
        extra_data: {
          contact_phone: '8 (700) 123-45-67',
          floor: '4',
          apartment: '18',
          comment: 'Позвонить заранее',
          token: 'must-not-pass',
        },
      },
      destination,
    ],
    userId: 'employee-1',
    className: 'express',
  });

  assert.deepEqual(payload.route[0], {
    geopoint: [51.2011, 43.6499],
    fullname: origin.fullname,
    porchnumber: '2',
    premisenumber: '18',
    extra_data: {
      contact_phone: '+77001234567',
      floor: '4',
      apartment: '18',
      comment: 'Позвонить заранее',
    },
  });
  assert.equal('secret' in payload.route[0], false);
  assert.equal('token' in payload.route[0].extra_data, false);
});

test('integration helpers read Business configuration and build an order without Cargo fields', () => {
  const config = getBusinessConfig({
    YANDEX_BUSINESS_API_TOKEN: 'secret-business-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_TARIFF_CLASS: 'express',
    YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: 'thermobag',
    YANDEX_DELIVERY_SENDER_PHONE: '+7 700 111 22 33',
  });
  assert.deepEqual(assertBusinessConfigured(config), config);
  const order = {
    id: 'order-1',
    order_number: 100042,
    phone: '8 700 999 88 77',
    comment: 'Домофон не работает',
    delivery_address: {
      city: 'Актау',
      address: '17-й микрорайон, 34',
      entrance: '2',
      floor: '4',
      apartment: '18',
      comment: 'Позвонить заранее',
    },
    delivery_latitude: 43.6512,
    delivery_longitude: 51.1978,
    bulka_locations: {
      city: 'Актау',
      address: '17-й микрорайон, 1',
      latitude: 43.6499,
      longitude: 51.2011,
    },
  };

  assert.deepEqual(buildBusinessRoute(order, config), [
    {
      geopoint: [51.2011, 43.6499],
      fullname: 'Актау, 17-й микрорайон, 1',
      extra_data: { contact_phone: '+77001112233' },
    },
    {
      geopoint: [51.1978, 43.6512],
      fullname: 'Актау, 17-й микрорайон, 34',
      porchnumber: '2',
      extra_data: {
        contact_phone: '+77009998877',
        floor: '4',
        apartment: '18',
        comment: 'Позвонить заранее. Домофон не работает',
      },
    },
  ]);
  assert.deepEqual(buildBusinessQuotePayload(order, config), {
    route: [
      [51.2011, 43.6499],
      [51.1978, 43.6512],
    ],
    user_id: 'employee-1',
    requirements: { thermobag: true },
  });
  assert.deepEqual(buildBusinessCreatePayload(order, config, { offer: 'offer-1' }), {
    user_id: 'employee-1',
    route: buildBusinessRoute(order, config),
    class: 'express',
    offer: 'offer-1',
    requirements: { thermobag: true },
    comment: 'Bulka, заказ №100042. Позвонить заранее. Домофон не работает',
  });

  const selected = selectBusinessQuote(zoneInfo, routeStats, config);
  assert.equal(selected.className, 'express');
  assert.equal(selected.offer, 'offer-1');
  assert.deepEqual(selected.requirements, { thermobag: true });
});

test('Business route uses the same additional-phone priority as delivery validation', () => {
  const route = buildBusinessRoute(
    {
      additional_phone: '+77005554433',
      phone: '+77001112222',
      customers: { phone: '+77009998877' },
      delivery_address: { city: 'Актау', address: '17-й микрорайон, 34' },
      delivery_latitude: 43.6512,
      delivery_longitude: 51.1978,
      bulka_locations: {
        city: 'Актау',
        address: '17-й микрорайон, 1',
        latitude: 43.6499,
        longitude: 51.2011,
      },
    },
    { senderPhone: '+77001112233' },
  );
  assert.equal(route[1].extra_data.contact_phone, '+77005554433');
});

test('requirements are kept only when their exact names and types are supported', () => {
  assert.deepEqual(
    filterSupportedRequirements(
      {
        thermobag: true,
        Thermobag: true,
        door_to_door: true,
        cargo_size: 'large',
        unsupported: true,
      },
      zoneInfo,
      'express',
    ),
    { thermobag: true, cargo_size: 2 },
  );
  assert.deepEqual(
    filterSupportedRequirements({ thermobag: 'yes', cargo_size: {} }, zoneInfo, 'express'),
    {},
  );
});

test('delivery class must exist both in zoneinfo and in routestats', () => {
  assert.equal(pickAvailableDeliveryClass(zoneInfo, routeStats, ['express', 'courier']), 'express');
  assert.equal(pickAvailableDeliveryClass(zoneInfo, routeStats, ['unknown']), null);
  assert.equal(
    pickAvailableDeliveryClass(
      zoneInfo,
      { service_levels: [{ class: 'courier' }] },
      'express,courier',
    ),
    'courier',
  );

  const selected = selectAvailableServiceLevel(zoneInfo, routeStats, 'express,courier');
  assert.equal(selected.className, 'express');
  assert.equal(selected.price, 1250.5);
  assert.equal(selected.isFixedPrice, true);
  assert.equal(selected.tariffClass.name, 'express');
});

test('localized price parser handles KZT formats and rejects unsafe ambiguity', () => {
  assert.equal(parseLocalizedPrice('1 250,50 ₸'), 1250.5);
  assert.equal(parseLocalizedPrice('1\u202f250.50 KZT'), 1250.5);
  assert.equal(parseLocalizedPrice('1.234,56 ₸'), 1234.56);
  assert.equal(parseLocalizedPrice('1,234.56 KZT'), 1234.56);
  assert.equal(parseLocalizedPrice('12,345 ₸'), 12345);
  assert.equal(parseLocalizedPrice(890), 890);
  assert.equal(parseLocalizedPrice('-1 ₸'), null);
  assert.equal(parseLocalizedPrice('от 900 до 1200 ₸'), null);
  assert.equal(parseLocalizedPrice('1,2,3 ₸'), null);
});

test('Business statuses and order info normalize into the Bulka lifecycle', () => {
  assert.equal(mapBusinessStatus('search'), 'unassigned');
  assert.equal(mapBusinessStatus('scheduling'), 'unassigned');
  assert.equal(mapBusinessStatus('scheduled'), 'assigned');
  assert.equal(mapBusinessStatus('driving'), 'assigned');
  assert.equal(mapBusinessStatus('waiting'), 'assigned');
  assert.equal(mapBusinessStatus('transporting'), 'en_route');
  assert.equal(mapBusinessStatus('complete'), 'delivered');
  assert.equal(mapBusinessStatus('finished'), 'delivered');
  assert.equal(mapBusinessStatus('failed'), 'cancelled');
  assert.equal(mapBusinessStatus('expired'), 'unassigned');
  assert.equal(isBusinessTerminalStatus('expired'), false);
  assert.equal(isBusinessKnownStatus('expired'), true);
  assert.equal(isBusinessKnownStatus('future_provider_state'), false);
  assert.equal(isBusinessTerminalStatus('waiting'), false);

  const expiredInfo = normalizeBusinessOrderInfo({
    id: 'business-order-expired',
    status: 'expired',
  });
  assert.equal(expiredInfo.internalStatus, 'unassigned');
  assert.equal(expiredInfo.terminal, false);

  const expiredProgress = normalizeBusinessOrderProgress({ status: 'expired' });
  assert.equal(expiredProgress.internalStatus, 'unassigned');
  assert.equal(expiredProgress.terminal, false);

  const normalized = normalizeBusinessOrderInfo({
    id: 'business-order-1',
    user_id: 'employee-1',
    status: 'driving',
    cost: '1 250,00 ₸',
    performer: {
      fullname: 'Ерлан',
      phone: '+77001234567',
      vehicle: { model: 'Toyota Camry', number: '123 ABC 12', color: 'Белый' },
    },
    cancel_rules: {
      can_cancel: true,
      state: 'paid',
      title: 'Платная отмена',
      message: 'Будет списана комиссия',
    },
  });
  assert.equal(normalized.externalOrderId, 'business-order-1');
  assert.equal(normalized.internalStatus, 'assigned');
  assert.equal(normalized.courier.name, 'Ерлан');
  assert.equal(normalized.courier.vehicle.number, '123 ABC 12');
  assert.equal(normalized.cancelRules.canCancel, true);
  assert.equal(normalized.cancelRules.requiresPaymentConfirmation, true);
  assert.equal(normalized.price, 1250);

  assert.deepEqual(
    normalizeBusinessOrderProgress({
      status: 'transporting',
      time_left_raw: 125,
      vehicle: { location: [51.2, 43.65] },
    }),
    {
      providerStatus: 'transporting',
      internalStatus: 'en_route',
      terminal: false,
      timeLeftSeconds: 125,
      vehicleLocation: [51.2, 43.65],
    },
  );
});

test('OAuth token normalization accepts a copied header value without weakening validation', () => {
  assert.equal(normalizeOAuthToken('  y0__token-value  '), 'y0__token-value');
  assert.equal(normalizeOAuthToken('Bearer y0__token-value'), 'y0__token-value');
  assert.equal(normalizeOAuthToken('OAuth y0__token-value'), 'y0__token-value');
  assert.equal(normalizeOAuthToken('"Bearer y0__token-value"'), 'y0__token-value');
  assert.equal(normalizeOAuthToken(''), '');
});

test('HTTP client uses Business auth, selected client and create idempotency headers', async () => {
  const calls = [];
  const client = createBusinessApiClient(
    {
      token: 'secret-business-token',
      clientId: 'corp-client-1',
      userId: 'employee-1',
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return response(200, { ok: true });
      },
    },
  );

  await client.listClients();
  await client.getZoneInfo(origin);
  await client.getRouteStats({ route: [[51.2, 43.6]], user_id: 'employee-1' });
  await client.createOrder(
    { user_id: 'employee-1', route: [], class: 'express' },
    { idempotencyToken: '2bff472e-c9d4-4b48-a715-b07c105a4022' },
  );
  await client.cancelOrder('business-order-1', 'free');

  assert.equal(calls[0].url, `${DEFAULT_BUSINESS_API_BASE_URL}/auth/list`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-business-token');
  assert.equal('X-YaTaxi-Selected-Corp-Client-Id' in calls[0].options.headers, false);
  assert.equal(calls[1].options.headers['X-YaTaxi-Selected-Corp-Client-Id'], 'corp-client-1');
  assert.match(calls[1].url, /zoneinfo\?lat=43\.6499&lon=51\.2011$/);
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(
    calls[3].options.headers['X-Idempotency-Token'],
    '2bff472e-c9d4-4b48-a715-b07c105a4022',
  );
  assert.equal(
    calls[4].url,
    `${DEFAULT_BUSINESS_API_BASE_URL}/orders/cancel?order_id=business-order-1`,
  );
  assert.deepEqual(JSON.parse(calls[4].options.body), { state: 'free' });
});

test('auth failures preserve only the provider request ID for support diagnostics', async () => {
  const secret = 'secret-business-token';
  const client = createBusinessApiClient(
    { token: `Bearer ${secret}`, clientId: 'corp-client-1', userId: 'employee-1' },
    {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        headers: { get: (name) => (name === 'x-ya-request-id' ? 'trace-401-1' : null) },
        text: async () => JSON.stringify({ code: 'unauthorized', message: 'not authorized' }),
      }),
    },
  );

  await assert.rejects(
    () => client.listClients(),
    (error) => {
      assert.equal(error.code, 'YANDEX_BUSINESS_HTTP_401');
      assert.equal(error.statusCode, 503);
      assert.equal(error.providerStatus, 401);
      assert.equal(error.providerRequestId, 'trace-401-1');
      assert.match(error.message, /Request ID trace-401-1/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test('configuration status and errors never return the Business API token', async () => {
  const secret = 'do-not-return-this-token';
  const privatePhone = '+77001234567';
  const status = getBusinessApiConfigurationStatus({
    token: secret,
    clientId: 'corp-client-1',
    userId: 'employee-1',
  });
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes(secret), false);

  const client = createBusinessApiClient(
    { token: secret, clientId: 'corp-client-1', userId: 'employee-1' },
    {
      fetchImpl: async () =>
        response(500, {
          code: 'INTERNAL ERROR!',
          message: `Bearer ${secret}; invalid contact_phone ${privatePhone}; Актау, дом 34`,
        }),
    },
  );
  await assert.rejects(
    () => client.createOrder({}, { idempotencyToken: '2bff472e-c9d4-4b48-a715-b07c105a4022' }),
    (error) => {
      assert.equal(error.code, 'YANDEX_BUSINESS_HTTP_500');
      assert.equal(error.providerStatus, 500);
      assert.equal(error.uncertain, true);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes(privatePhone), false);
      assert.equal(error.message.includes('дом 34'), false);
      assert.ok(error.message.length <= 700);
      return true;
    },
  );
});

test('create timeout is marked uncertain and requires reuse of the idempotency token', async () => {
  const client = createBusinessApiClient(
    { token: 'secret-business-token', clientId: 'corp-client-1', userId: 'employee-1' },
    {
      fetchImpl: async () => {
        const error = new Error('request aborted');
        error.name = 'AbortError';
        throw error;
      },
    },
  );
  await assert.rejects(
    () => client.createOrder({}, { idempotencyToken: '2bff472e-c9d4-4b48-a715-b07c105a4022' }),
    (error) => {
      assert.equal(error.code, 'YANDEX_BUSINESS_TIMEOUT');
      assert.equal(error.statusCode, 504);
      assert.equal(error.uncertain, true);
      assert.match(error.message, /тем же токеном идемпотентности/);
      return true;
    },
  );
});

test('orders/create HTTP 410 is uncertain and must retain its idempotency token', async () => {
  const client = createBusinessApiClient(
    { token: 'secret-business-token', clientId: 'corp-client-1', userId: 'employee-1' },
    {
      fetchImpl: async () =>
        response(410, {
          code: 'ORDER_CREATE_RESULT_UNKNOWN',
          message: 'Create result is no longer available',
        }),
    },
  );

  await assert.rejects(
    () => client.createOrder({}, { idempotencyToken: '2bff472e-c9d4-4b48-a715-b07c105a4022' }),
    (error) => {
      assert.equal(error.code, 'YANDEX_BUSINESS_HTTP_410');
      assert.equal(error.providerStatus, 410);
      assert.equal(error.statusCode, 422);
      assert.equal(error.uncertain, true);
      return true;
    },
  );
});

test('orders/create fails closed for undocumented or throttled HTTP outcomes', async () => {
  for (const status of [408, 409, 425, 429, 422]) {
    const client = createBusinessApiClient(
      { token: 'secret-business-token', clientId: 'corp-client-1', userId: 'employee-1' },
      { fetchImpl: async () => response(status, { code: 'UNEXPECTED', message: 'unknown' }) },
    );
    await assert.rejects(
      () => client.createOrder({}, { idempotencyToken: '2bff472e-c9d4-4b48-a715-b07c105a4022' }),
      (error) => {
        assert.equal(error.uncertain, true, `HTTP ${status}`);
        return true;
      },
    );
  }

  for (const status of [400, 403, 404, 406]) {
    const client = createBusinessApiClient(
      { token: 'secret-business-token', clientId: 'corp-client-1', userId: 'employee-1' },
      { fetchImpl: async () => response(status, { code: 'DOCUMENTED_REJECTION' }) },
    );
    await assert.rejects(
      () => client.createOrder({}, { idempotencyToken: '2bff472e-c9d4-4b48-a715-b07c105a4022' }),
      (error) => {
        assert.equal(error.uncertain, undefined, `HTTP ${status}`);
        return true;
      },
    );
  }
});

test('HTTP client rejects insecure configuration and invalid create tokens before a call', async () => {
  assert.throws(
    () =>
      createBusinessApiClient({
        token: 'secret-business-token',
        clientId: 'corp-client-1',
        baseUrl: 'http://b2b-api.go.yandex.ru/integration/2.0',
      }),
    (error) => error.code === 'YANDEX_BUSINESS_CONFIGURATION',
  );

  let called = false;
  const client = createBusinessApiClient(
    { token: 'secret-business-token', clientId: 'corp-client-1' },
    {
      fetchImpl: async () => {
        called = true;
        return response(200, {});
      },
    },
  );
  await assert.rejects(
    () => client.createOrder({}, { idempotencyToken: 'not-a-uuid' }),
    (error) => error.code === 'YANDEX_BUSINESS_IDEMPOTENCY_REQUIRED',
  );
  assert.equal(called, false);
});
