const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const actualBusinessApi = require('../src/services/yandex-business-api');
const { decryptSecret } = require('../src/utils/secret-envelope.util');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

const makeOrder = (overrides = {}) => ({
  id: ORDER_ID,
  order_number: 100042,
  status: 'paid',
  fulfillment_status: 'ready',
  fulfillment_type: 'delivery',
  preorder_fulfillment_type: null,
  amount: 2590,
  phone: '+77009998877',
  additional_phone: null,
  cart_items: [{ id: 'cake-1', name: 'Торт Bulka', quantity: 1, price: 2590 }],
  comment: null,
  branch_id: 'branch-1',
  branch_name: 'ЖК Дукат',
  customer_id: 'customer-1',
  courier_id: null,
  delivery_status: 'unassigned',
  kitchen_status: 'preparing',
  courier_dispatch_status: 'awaiting_confirmation',
  courier_dispatch_provider: 'yandex',
  courier_dispatch_requested_at: '2026-08-13T08:00:00.000Z',
  delivery_address: {
    city: 'Актау',
    address: '17-й микрорайон, дом 34',
    entrance: '2',
    floor: '4',
    apartment: '18',
    comment: 'Позвонить заранее',
  },
  delivery_latitude: 43.6512,
  delivery_longitude: 51.1978,
  customers: { name: 'Аружан', phone: '+77009998877' },
  bulka_locations: {
    id: 'branch-1',
    name: 'ЖК Дукат',
    city: 'Актау',
    address: '17-й микрорайон, 1',
    latitude: 43.6499,
    longitude: 51.2011,
  },
  ...overrides,
});

const clone = (value) => (value == null ? value : structuredClone(value));

function makeFakeSupabase({ order = makeOrder(), jobs = [], beforeRun } = {}) {
  const state = {
    orders: [clone(order)],
    jobs: jobs.map((job) => ({
      reconciliation_attempts: 0,
      reconciliation_next_at: null,
      ...clone(job),
    })),
    operations: [],
  };

  const tableRows = (table) => {
    if (table === 'kaspi_orders') return state.orders;
    if (table === 'delivery_jobs') return state.jobs;
    throw new Error(`Unexpected Supabase table in Yandex Business test: ${table}`);
  };

  const supabase = {
    async rpc(name, parameters) {
      if (name !== 'project_yandex_delivery_status') {
        throw new Error(`Unexpected Supabase RPC in Yandex Business test: ${name}`);
      }
      const job = state.jobs.find((candidate) => candidate.id === parameters.p_job_id);
      if (!job || String(job.provider_status) !== String(parameters.p_expected_provider_status)) {
        return { data: [], error: null };
      }
      job.internal_status = parameters.p_internal_status;
      job.updated_at = new Date().toISOString();
      const orderRow = state.orders.find(
        (candidate) => String(candidate.id) === String(job.order_id) && !candidate.courier_id,
      );
      if (!orderRow) return { data: [], error: null };
      orderRow.delivery_status =
        parameters.p_internal_status === 'cancelled' ? 'unassigned' : parameters.p_internal_status;
      state.operations.push({
        table: 'delivery_jobs',
        action: 'rpc-project',
        payload: clone(parameters),
        matched: 1,
      });
      return { data: [clone(job)], error: null };
    },
    from(table) {
      let action = 'select';
      let payload = null;
      let maximumRows = null;
      let ordering = null;
      const filters = [];

      const matches = (row) =>
        filters.every((filter) => {
          if (filter.kind === 'eq') return String(row[filter.column]) === String(filter.value);
          if (filter.kind === 'is') return row[filter.column] === filter.value;
          if (filter.kind === 'in') {
            return filter.values.map(String).includes(String(row[filter.column]));
          }
          if (filter.kind === 'not-null') return row[filter.column] != null;
          if (filter.kind === 'lt') {
            return (
              row[filter.column] != null &&
              new Date(row[filter.column]).getTime() < new Date(filter.value).getTime()
            );
          }
          if (filter.kind === 'reconciliation-due') {
            return (
              row.reconciliation_next_at == null ||
              new Date(row.reconciliation_next_at).getTime() <= new Date(filter.value).getTime()
            );
          }
          if (filter.kind === 'not-in') {
            const blocked = String(filter.value)
              .replace(/^\(/, '')
              .replace(/\)$/, '')
              .split(',')
              .map((item) => item.trim());
            return !blocked.includes(String(row[filter.column]));
          }
          return true;
        });

      const run = async (single) => {
        const rows = tableRows(table);
        if (beforeRun) await beforeRun({ table, action, payload, state });
        let result;

        if (action === 'insert') {
          const inserted = (Array.isArray(payload) ? payload : [payload]).map((value, index) => ({
            id: value.id || (state.jobs.length + index === 0 ? JOB_ID : crypto.randomUUID()),
            created_at: value.created_at || '2026-08-13T08:01:00.000Z',
            updated_at: value.updated_at || '2026-08-13T08:01:00.000Z',
            currency: value.currency || 'KZT',
            auto_accept: value.auto_accept === true,
            external_claim_id: value.external_claim_id ?? null,
            reconciliation_attempts: value.reconciliation_attempts ?? 0,
            reconciliation_next_at: value.reconciliation_next_at ?? null,
            ...clone(value),
          }));
          rows.push(...inserted);
          result = inserted;
        } else {
          result = rows.filter(matches);
          if (action === 'update') {
            for (const row of result) {
              Object.assign(row, clone(payload), { updated_at: new Date().toISOString() });
            }
          }
        }

        if (ordering) {
          const direction = ordering.ascending === false ? -1 : 1;
          result = [...result].sort(
            (left, right) =>
              String(left[ordering.column] || '').localeCompare(
                String(right[ordering.column] || ''),
              ) * direction,
          );
        }
        if (maximumRows != null) result = result.slice(0, maximumRows);
        state.operations.push({ table, action, payload: clone(payload), matched: result.length });
        return { data: single ? clone(result[0] || null) : clone(result), error: null };
      };

      const builder = {
        select() {
          return builder;
        },
        insert(value) {
          action = 'insert';
          payload = value;
          return builder;
        },
        update(value) {
          action = 'update';
          payload = value;
          return builder;
        },
        eq(column, value) {
          filters.push({ kind: 'eq', column, value });
          return builder;
        },
        is(column, value) {
          filters.push({ kind: 'is', column, value });
          return builder;
        },
        in(column, values) {
          filters.push({ kind: 'in', column, values });
          return builder;
        },
        not(column, operator, value) {
          filters.push({
            kind: operator === 'is' && value === null ? 'not-null' : 'not-in',
            column,
            value,
          });
          return builder;
        },
        lt(column, value) {
          filters.push({ kind: 'lt', column, value });
          return builder;
        },
        or(expression) {
          const reconciliationDue = String(expression || '').match(
            /^reconciliation_next_at\.is\.null,reconciliation_next_at\.lte\.(.+)$/,
          );
          if (reconciliationDue) {
            filters.push({ kind: 'reconciliation-due', value: reconciliationDue[1] });
          }
          // The production query uses this only as an additional compare-and-set
          // guard. Every fixture starts in one of the explicitly allowed states.
          return builder;
        },
        order(column, options = {}) {
          ordering = { column, ...options };
          return builder;
        },
        limit(value) {
          maximumRows = Number(value);
          return builder;
        },
        maybeSingle() {
          return run(true);
        },
        single() {
          return run(true);
        },
        then(resolve, reject) {
          return run(false).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return { state, supabase };
}

function installModule(t, modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

function installEnvironment(t, overrides = {}) {
  const values = {
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_DELIVERY_AUTO_DISPATCH: 'false',
    YANDEX_DELIVERY_API_TOKEN: 'legacy-cargo-token',
    YANDEX_DELIVERY_BASE_URL: 'https://b2b.taxi.yandex.net',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_BUSINESS_API_TOKEN: 'business-secret-token',
    YANDEX_BUSINESS_BASE_URL: 'https://b2b-api.go.yandex.ru',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_TARIFF_CLASS: 'express',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
    YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS: '120',
    YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: '{"thermobag":true}',
    YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'true',
    YANDEX_BUSINESS_ALLOW_PAID_CANCEL: 'false',
    OPS_ALERT_WEBHOOK_URL: 'https://ops.example.test/bulka-alerts',
    OPS_ALERT_RECEIVER_REQUIRED: 'true',
    RUN_BACKGROUND_WORKERS: 'true',
    CUSTOMER_JWT_SECRET: 'yandex-business-integration-test-secret-material-123456789',
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function loadService(t, { client, order, jobs, environment, beforeRun, cargoFetchImpl } = {}) {
  installEnvironment(t, environment);
  const database = makeFakeSupabase({ order, jobs, beforeRun });
  const clientConfigurations = [];
  let cargoFetchCalls = 0;

  installModule(t, '../src/config/supabase', { supabase: database.supabase });
  installModule(t, '../src/services/realtime.service', { publish: () => undefined });
  installModule(t, 'node-fetch', async (...args) => {
    cargoFetchCalls += 1;
    if (cargoFetchImpl) return cargoFetchImpl(...args);
    throw new Error('Cargo API must not be called by a Business job');
  });
  installModule(t, '../src/services/yandex-business-api', {
    ...actualBusinessApi,
    createBusinessApiClient: (config) => {
      clientConfigurations.push(clone(config));
      return {
        ...client,
        ...(typeof client?.getOrderInfo === 'function' && {
          getOrderInfo: async (orderId) => {
            const result = await client.getOrderInfo(orderId);
            return {
              id: orderId,
              user_id: config.userId,
              ...result,
            };
          },
        }),
      };
    },
  });

  const servicePath = require.resolve('../src/services/yandex-delivery.service');
  const previousService = require.cache[servicePath];
  delete require.cache[servicePath];
  t.after(() => {
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  return {
    ...database,
    service: require(servicePath),
    clientConfigurations,
    getCargoFetchCalls: () => cargoFetchCalls,
  };
}

const expressZone = (requirements = [{ name: 'thermobag', type: 'boolean' }]) => ({
  currency_code: 'KZT',
  tariff_classes: [{ name: 'express', supported_requirements: requirements }],
});

const fixedRouteStats = (overrides = {}) => ({
  offer: 'offer-secret-1',
  service_levels: [
    {
      class: 'express',
      price: '1 250,00 ₸',
      is_fixed_price: true,
      estimated_waiting: { seconds: 300 },
      ...overrides,
    },
  ],
});

test('Business configuration status is explicit and never exposes its token', (t) => {
  const harness = loadService(t, { client: {} });
  const status = harness.service.getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_BUSINESS_API_TOKEN: 'never-return-this-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_TARIFF_CLASS: 'express',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
    YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: 'thermobag',
  });

  assert.equal(status.apiMode, 'business_v2');
  assert.equal(status.providerLabel, 'Яндекс Go для бизнеса');
  assert.equal(status.configured, true);
  assert.equal(status.dispatchReady, false);
  assert.equal(status.autoDispatch, false);
  assert.equal(status.taxiClass, 'express');
  assert.equal(status.maxPriceKzt, 5000);
  assert.equal(JSON.stringify(status).includes('never-return-this-token'), false);

  const ready = harness.service.getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_BUSINESS_API_TOKEN: 'never-return-this-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
    YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'true',
    OPS_ALERT_WEBHOOK_URL: 'https://ops.example.test/bulka-alerts',
    OPS_ALERT_RECEIVER_REQUIRED: 'true',
    RUN_BACKGROUND_WORKERS: 'true',
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.dispatchReady, true);
  assert.equal(ready.deliverySyncWorkerEnabled, true);

  const disabledSyncWorker = harness.service.getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_BUSINESS_API_TOKEN: 'never-return-this-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
    YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'true',
    OPS_ALERT_WEBHOOK_URL: 'https://ops.example.test/bulka-alerts',
    OPS_ALERT_RECEIVER_REQUIRED: 'true',
    RUN_BACKGROUND_WORKERS: 'true',
    RUN_YANDEX_DELIVERY_WORKER: 'false',
  });
  assert.equal(disabledSyncWorker.dispatchReady, false);
  assert.ok(disabledSyncWorker.dispatchMissing.includes('RUN_YANDEX_DELIVERY_WORKER'));

  const serverless = harness.service.getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_BUSINESS_API_TOKEN: 'never-return-this-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
    YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'true',
    OPS_ALERT_WEBHOOK_URL: 'https://ops.example.test/bulka-alerts',
    OPS_ALERT_RECEIVER_REQUIRED: 'true',
    RUN_BACKGROUND_WORKERS: 'true',
    RUN_YANDEX_DELIVERY_WORKER: 'true',
    VERCEL: '1',
  });
  assert.equal(serverless.dispatchReady, false);
  assert.ok(serverless.dispatchMissing.includes('VERCEL_UNSUPPORTED_BACKGROUND_WORKERS'));

  const noAlertReceiver = harness.service.getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_BUSINESS_API_TOKEN: 'never-return-this-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
    YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED: 'true',
  });
  assert.equal(noAlertReceiver.configured, true);
  assert.equal(noAlertReceiver.dispatchReady, false);
  assert.equal(noAlertReceiver.alertReceiverReady, false);
  assert.deepEqual(noAlertReceiver.dispatchMissing, [
    'OPS_ALERT_WEBHOOK_URL',
    'OPS_ALERT_RECEIVER_REQUIRED',
    'RUN_BACKGROUND_WORKERS',
  ]);

  const noSender = harness.service.getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_MODE: 'business_v2',
    YANDEX_BUSINESS_API_TOKEN: 'never-return-this-token',
    YANDEX_BUSINESS_CORP_CLIENT_ID: 'corp-client-1',
    YANDEX_BUSINESS_USER_ID: 'employee-1',
    YANDEX_BUSINESS_MAX_PRICE_KZT: '5000',
  });
  assert.equal(noSender.configured, false);
  assert.ok(noSender.missing.includes('YANDEX_DELIVERY_SENDER_PHONE'));
});

test('Business price can be quoted but paid create fails closed without the required alert receiver', async (t) => {
  let createCalls = 0;
  const harness = loadService(t, {
    environment: {
      OPS_ALERT_WEBHOOK_URL: '',
      OPS_ALERT_RECEIVER_REQUIRED: 'false',
    },
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        return { order_id: 'must-not-be-created', status: 'search' };
      },
    },
  });

  const quote = await harness.service.quoteOrder(ORDER_ID);
  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_ALERT_RECEIVER_REQUIRED',
  );
  assert.equal(createCalls, 0);
  assert.equal(harness.state.jobs[0].provider_status, 'quoted');
});

test('Business quote checks zone first, sends only exact supported requirements, and encrypts create data', async (t) => {
  const events = [];
  let routePayload;
  const client = {
    getZoneInfo: async (point) => {
      events.push('zoneinfo');
      assert.deepEqual(point.geopoint, [51.2011, 43.6499]);
      return expressZone([
        { name: 'thermobag', type: 'boolean' },
        {
          name: 'cargo_size',
          type: 'select',
          select: { type: 'number', options: [{ name: 'large', value: 2 }] },
        },
      ]);
    },
    getRouteStats: async (payload) => {
      events.push('routestats');
      routePayload = clone(payload);
      return fixedRouteStats();
    },
  };
  const harness = loadService(t, {
    client,
    environment: {
      YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: '{"thermobag":true,"cargo_size":"large"}',
    },
  });

  const quote = await harness.service.quoteOrder(ORDER_ID);
  assert.deepEqual(events, ['zoneinfo', 'routestats']);
  assert.deepEqual(routePayload.requirements, { thermobag: true, cargo_size: 2 });
  assert.equal(routePayload.user_id, 'employee-1');
  assert.deepEqual(routePayload.route, [
    [51.2011, 43.6499],
    [51.1978, 43.6512],
  ]);
  assert.equal(quote.apiFamily, 'business_v2');
  assert.equal(quote.quotedPrice, 1250);
  assert.equal(quote.fixedPrice, true);

  const [job] = harness.state.jobs;
  assert.equal(job.provider_status, 'quoted');
  assert.deepEqual(job.request_payload, {
    apiFamily: 'business_v2',
    className: 'express',
    fixedPrice: true,
    quoteFingerprint: job.quote_fingerprint,
  });
  assert.match(job.quote_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(job.request_payload_ciphertext, /^v1\./);

  const persistedText = JSON.stringify(job);
  for (const secretValue of [
    'business-secret-token',
    'offer-secret-1',
    '+77009998877',
    '17-й микрорайон, дом 34',
  ]) {
    assert.equal(persistedText.includes(secretValue), false, secretValue);
  }

  const decrypted = JSON.parse(
    decryptSecret(job.request_payload_ciphertext, {
      purpose: 'yandex-business-delivery-request',
      aad: `delivery-job:${job.id}:order:${job.order_id}`,
    }),
  );
  assert.equal(decrypted.offer, 'offer-secret-1');
  assert.equal(decrypted.user_id, 'employee-1');
  assert.deepEqual(decrypted.requirements, { thermobag: true, cargo_size: 2 });
  assert.equal(decrypted.route[1].extra_data.contact_phone, '+77009998877');
});

test('an unsupported required Business option blocks before routestats and before job creation', async (t) => {
  let routeStatsCalls = 0;
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone([{ name: 'door_to_door', type: 'boolean' }]),
      getRouteStats: async () => {
        routeStatsCalls += 1;
        return fixedRouteStats();
      },
    },
  });

  await assert.rejects(harness.service.quoteOrder(ORDER_ID), (error) => {
    assert.equal(error.code, 'YANDEX_BUSINESS_REQUIREMENTS_UNAVAILABLE');
    assert.deepEqual(error.details, { missingRequirements: ['thermobag'] });
    return true;
  });
  assert.equal(routeStatsCalls, 0);
  assert.equal(harness.state.jobs.length, 0);
});

test('Business quote accepts only KZT even when Yandex returns a fixed offer', async (t) => {
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => ({ ...expressZone(), currency_code: 'USD' }),
      getRouteStats: async () => fixedRouteStats({ price: '12.50 USD' }),
    },
  });

  await assert.rejects(harness.service.quoteOrder(ORDER_ID), (error) => {
    assert.equal(error.code, 'YANDEX_BUSINESS_CURRENCY_UNSUPPORTED');
    assert.deepEqual(error.details, { currency: 'USD' });
    return true;
  });
  assert.equal(harness.state.jobs.length, 0);
});

test('Business quote follows configured class priority, not zone ordering, and sends exact requirements', async (t) => {
  let routePayload;
  const harness = loadService(t, {
    environment: {
      YANDEX_BUSINESS_TARIFF_CLASS: 'express,courier',
      YANDEX_BUSINESS_REQUIRED_REQUIREMENTS: '{"thermobag":true}',
    },
    client: {
      getZoneInfo: async () => ({
        currency_code: 'KZT',
        tariff_classes: [
          {
            name: 'courier',
            supported_requirements: [{ name: 'door_to_door', type: 'boolean' }],
          },
          {
            name: 'express',
            supported_requirements: [{ name: 'thermobag', type: 'boolean' }],
          },
        ],
      }),
      getRouteStats: async (payload) => {
        routePayload = clone(payload);
        return {
          offer: 'offer-secret-1',
          service_levels: [
            {
              class: 'courier',
              price: '900,00 ₸',
              is_fixed_price: true,
            },
            {
              class: 'express',
              price: '1 250,00 ₸',
              is_fixed_price: true,
            },
          ],
        };
      },
    },
  });

  const quote = await harness.service.quoteOrder(ORDER_ID);
  assert.equal(quote.quotedPrice, 1250);
  assert.deepEqual(routePayload.requirements, { thermobag: true });
  assert.equal(Object.hasOwn(routePayload.requirements, 'door_to_door'), false);
  assert.equal(harness.state.jobs[0].raw_response.className, 'express');
});

test('Business create requires the quoted job, fresh fixed price and both price caps', async (t) => {
  let createCalls = 0;
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        return { order_id: 'business-order-1', status: 'search' };
      },
    },
  });

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, { maxPriceKzt: 1300 }),
    (error) => error.code === 'YANDEX_BUSINESS_QUOTE_REQUIRED',
  );
  const quote = await harness.service.quoteOrder(ORDER_ID);
  const job = harness.state.jobs[0];

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, { deliveryJobId: quote.id }),
    (error) => error.code === 'YANDEX_BUSINESS_MAX_PRICE_REQUIRED',
  );

  const validExpiry = job.quote_expires_at;
  job.quote_expires_at = '2020-01-01T00:00:00.000Z';
  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_QUOTE_EXPIRED',
  );
  job.quote_expires_at = validExpiry;

  job.raw_response.fixedPrice = false;
  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_QUOTE_EXPIRED',
  );
  job.raw_response.fixedPrice = true;

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1200,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_PRICE_LIMIT_EXCEEDED',
  );
  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 5001,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_PRICE_LIMIT_EXCEEDED',
  );
  assert.equal(createCalls, 0);
});

test('closed or refunding orders cannot be quoted or dispatched', async (t) => {
  for (const order of [
    makeOrder({ fulfillment_status: 'cancelled' }),
    makeOrder({ refund_status: 'processing' }),
    makeOrder({ refund_status: 'unknown' }),
    makeOrder({ refund_status: 'succeeded' }),
  ]) {
    const harness = loadService(t, { order, client: {} });
    await assert.rejects(harness.service.quoteOrder(ORDER_ID), (error) => {
      assert.ok(['DELIVERY_ORDER_CLOSED', 'DELIVERY_ORDER_REFUND_ACTIVE'].includes(error.code));
      return true;
    });
    assert.equal(harness.state.jobs.length, 0);
  }

  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => assert.fail('provider create must not be called'),
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);
  harness.state.orders[0].refund_status = 'processing';
  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'DELIVERY_ORDER_REFUND_ACTIVE',
  );
  assert.equal(harness.state.jobs[0].provider_status, 'quoted');
});

test('ambiguous Business create persists creating_uncertain and retry reuses its UUID and encrypted payload', async (t) => {
  const createCalls = [];
  let attempt = 0;
  const client = {
    getZoneInfo: async () => expressZone(),
    getRouteStats: async () => fixedRouteStats(),
    createOrder: async (payload, options) => {
      createCalls.push({ payload: clone(payload), options: clone(options) });
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('Yandex create timed out'), {
          code: 'YANDEX_BUSINESS_TIMEOUT',
          uncertain: true,
        });
      }
      return { order_id: 'business-order-1', status: 'search' };
    },
    getOrderInfo: async () => ({ id: 'business-order-1', status: 'search' }),
    getOrderProgress: async () => ({ status: 'search', time_left_raw: 300 }),
  };
  const harness = loadService(t, { client });
  const quote = await harness.service.quoteOrder(ORDER_ID);
  const persistedJob = harness.state.jobs[0];
  const persistedUuid = persistedJob.client_request_id;
  const persistedCiphertext = persistedJob.request_payload_ciphertext;

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    /timed out/,
  );

  assert.equal(persistedJob.provider_status, 'creating_uncertain');
  assert.equal(persistedJob.reconciliation_attempts, 1);
  assert.ok(Date.parse(persistedJob.reconciliation_next_at));
  assert.equal(persistedJob.client_request_id, persistedUuid);
  assert.equal(persistedJob.request_payload_ciphertext, persistedCiphertext);
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'processing');
  assert.equal(harness.state.orders[0].courier_id, null);
  assert.equal(harness.state.jobs.length, 1);
  assert.equal(harness.getCargoFetchCalls(), 0);

  // Once create has an ambiguous outcome, recovery must replay the exact
  // encrypted request even if the local contact/address is edited meanwhile.
  // Rebuilding from mutable order data could create a second logical request
  // under the same idempotency UUID or make the accepted order unrecoverable.
  harness.state.orders[0].delivery_address.address = '15-й микрорайон, дом 20';
  harness.state.orders[0].customers.phone = '+77005554433';
  process.env.YANDEX_BUSINESS_MAX_PRICE_KZT = '1000';
  persistedJob.reconciliation_next_at = '2020-01-01T00:00:00.000Z';
  const result = await harness.service.dispatchOrder(ORDER_ID, {
    deliveryJobId: quote.id,
    // A later server-cap reduction must not prevent recovery of a request
    // that may already have been accepted under its persisted authorization.
    maxPriceKzt: 1,
  });
  assert.equal(result.claimId, 'business-order-1');
  assert.equal(createCalls.length, 2);
  assert.equal(persistedJob.reconciliation_attempts, 2);
  assert.equal(persistedJob.reconciliation_next_at, null);
  assert.equal(createCalls[0].options.idempotencyToken, persistedUuid);
  assert.equal(createCalls[1].options.idempotencyToken, persistedUuid);
  assert.deepEqual(createCalls[1].payload, createCalls[0].payload);
  assert.equal(createCalls[0].payload.offer, 'offer-secret-1');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
  assert.equal(harness.state.orders[0].courier_dispatch_provider, 'yandex');
  assert.equal(harness.getCargoFetchCalls(), 0);
});

for (const envelopeFailure of ['key mismatch', 'corrupt envelope']) {
  test(`an uncertain Business create with ${envelopeFailure} exhausts without another provider call`, async (t) => {
    let createCalls = 0;
    const uncertain = Object.assign(new Error('Ambiguous Business transport outcome'), {
      code: 'YANDEX_BUSINESS_TIMEOUT',
      uncertain: true,
    });
    const harness = loadService(t, {
      client: {
        getZoneInfo: async () => expressZone(),
        getRouteStats: async () => fixedRouteStats(),
        createOrder: async () => {
          createCalls += 1;
          throw uncertain;
        },
      },
    });
    const quote = await harness.service.quoteOrder(ORDER_ID);

    await assert.rejects(
      harness.service.dispatchOrder(ORDER_ID, {
        deliveryJobId: quote.id,
        maxPriceKzt: 1300,
        quoteFingerprint: quote.quoteFingerprint,
      }),
      (error) => error === uncertain,
    );
    const job = harness.state.jobs[0];
    job.reconciliation_next_at = '2020-01-01T00:00:00.000Z';
    if (envelopeFailure === 'key mismatch') {
      process.env.CUSTOMER_JWT_SECRET = 'r'.repeat(64);
    } else {
      job.request_payload_ciphertext = 'v1.corrupt-envelope';
    }

    await assert.rejects(
      harness.service.syncOrderDelivery(ORDER_ID),
      (error) => error.code === 'YANDEX_BUSINESS_RECONCILIATION_EXHAUSTED',
    );
    assert.equal(createCalls, 1);
    assert.equal(job.provider_status, 'creating_exhausted');
    assert.equal(job.request_payload_ciphertext, null);
    assert.equal(job.reconciliation_next_at, null);
    assert.equal(job.reconciliation_attempts, 1);
    assert.equal(harness.state.orders[0].courier_dispatch_status, 'processing');
    assert.match(job.last_error, /ручная проверка/);
    assert.doesNotMatch(job.last_error, /SECRET_ENVELOPE|decrypt|cipher/i);
  });
}

test('a crash-state Business create at the retry limit clears its encrypted payload', async (t) => {
  let createCalls = 0;
  const uncertain = Object.assign(new Error('Ambiguous Business transport outcome'), {
    code: 'YANDEX_BUSINESS_TIMEOUT',
    uncertain: true,
  });
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        throw uncertain;
      },
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);
  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error === uncertain,
  );
  const job = harness.state.jobs[0];
  job.reconciliation_attempts = 8;
  job.reconciliation_next_at = '2020-01-01T00:00:00.000Z';
  assert.ok(job.request_payload_ciphertext);

  await assert.rejects(
    harness.service.syncOrderDelivery(ORDER_ID),
    (error) => error.code === 'YANDEX_BUSINESS_RECONCILIATION_EXHAUSTED',
  );
  assert.equal(createCalls, 1);
  assert.equal(job.provider_status, 'creating_exhausted');
  assert.equal(job.request_payload_ciphertext, null);
  assert.equal(job.reconciliation_next_at, null);
});

test('Business create HTTP 410 remains uncertain and retries with the same UUID', async (t) => {
  const attempts = [];
  const resultUnknown = Object.assign(new Error('Create result is no longer available'), {
    code: 'ORDER_CREATE_RESULT_UNKNOWN',
    statusCode: 422,
    providerStatus: 410,
    uncertain: true,
  });
  const client = {
    getZoneInfo: async () => expressZone(),
    getRouteStats: async () => fixedRouteStats(),
    createOrder: async (payload, options) => {
      attempts.push({ payload: clone(payload), options: clone(options) });
      if (attempts.length === 1) throw resultUnknown;
      return { order_id: 'business-order-after-410', status: 'search' };
    },
    getOrderInfo: async () => ({ id: 'business-order-after-410', status: 'search' }),
    getOrderProgress: async () => ({ status: 'search' }),
  };
  const harness = loadService(t, { client });
  const quote = await harness.service.quoteOrder(ORDER_ID);
  const originalUuid = harness.state.jobs[0].client_request_id;

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error === resultUnknown,
  );
  assert.equal(harness.state.jobs[0].provider_status, 'creating_uncertain');
  assert.equal(harness.state.jobs[0].reconciliation_attempts, 1);
  assert.equal(harness.state.jobs[0].client_request_id, originalUuid);
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'processing');

  harness.state.jobs[0].reconciliation_next_at = '2020-01-01T00:00:00.000Z';
  const result = await harness.service.syncOrderDelivery(ORDER_ID);

  assert.equal(result.claimId, 'business-order-after-410');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].options.idempotencyToken, originalUuid);
  assert.equal(attempts[1].options.idempotencyToken, originalUuid);
  assert.deepEqual(attempts[1].payload, attempts[0].payload);
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
});

test('Business uncertain create uses durable backoff and exhausts without a ninth provider call', async (t) => {
  let createCalls = 0;
  const uncertain = Object.assign(new Error('Ambiguous Business transport outcome'), {
    code: 'YANDEX_BUSINESS_TIMEOUT',
    uncertain: true,
  });
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        throw uncertain;
      },
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error === uncertain,
  );
  const job = harness.state.jobs[0];
  assert.equal(job.reconciliation_attempts, 1);
  await assert.rejects(
    harness.service.syncOrderDelivery(ORDER_ID),
    (error) => error.code === 'YANDEX_BUSINESS_RECONCILIATION_BACKOFF',
  );
  assert.equal(createCalls, 1);

  for (let expectedAttempt = 2; expectedAttempt <= 8; expectedAttempt += 1) {
    job.reconciliation_next_at = '2020-01-01T00:00:00.000Z';
    await assert.rejects(
      harness.service.syncOrderDelivery(ORDER_ID),
      (error) => error === uncertain,
    );
    assert.equal(job.reconciliation_attempts, expectedAttempt);
  }
  assert.equal(createCalls, 8);
  assert.equal(job.provider_status, 'creating_exhausted');
  assert.equal(job.reconciliation_next_at, null);
  assert.equal(job.request_payload_ciphertext, null);
  const normalized = await harness.service.syncOrderDelivery(ORDER_ID);
  assert.equal(normalized.status, 'creating_exhausted');
  assert.equal(normalized.active, true);
  assert.equal(normalized.attentionRequired, true);
  assert.equal(normalized.createReconciliationExhausted, true);
  assert.equal(normalized.canCancel, false);
  assert.equal(createCalls, 8);
});

test('Cargo create timeout retries the same UUID and immutable payload through sync', async (t) => {
  const createCalls = [];
  let createAttempt = 0;
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  });
  const cargoFetchImpl = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/check-price')) {
      return response({ price: 950, currency_rules: { code: 'KZT' }, eta: 300 });
    }
    if (pathname.endsWith('/claims/create')) {
      createCalls.push({
        requestId: new URL(String(url)).searchParams.get('request_id'),
        payload: JSON.parse(options.body),
      });
      createAttempt += 1;
      if (createAttempt === 1) {
        throw Object.assign(new Error('Cargo create timed out'), { name: 'AbortError' });
      }
      return response({ id: 'cargo-claim-1', version: 1, status: 'accepted' });
    }
    if (pathname.endsWith('/claims/info')) {
      return response({ id: 'cargo-claim-1', version: 1, status: 'accepted' });
    }
    throw new Error(`Unexpected Cargo call: ${pathname}`);
  };
  const harness = loadService(t, {
    client: {},
    cargoFetchImpl,
    environment: { YANDEX_DELIVERY_API_MODE: 'cargo_v2' },
  });
  await harness.service.quoteOrder(ORDER_ID);
  const job = harness.state.jobs[0];
  const persistedUuid = job.client_request_id;

  await assert.rejects(harness.service.dispatchOrder(ORDER_ID), (error) => {
    assert.equal(error.code, 'YANDEX_DELIVERY_TIMEOUT');
    return true;
  });
  assert.equal(job.provider_status, 'creating_uncertain');
  const persistedPayload = clone(job.request_payload);

  harness.state.orders[0].delivery_address.address = '15-й микрорайон, дом 99';
  harness.state.orders[0].additional_phone = '+77005554433';
  const recovered = await harness.service.syncOrderDelivery(ORDER_ID);

  assert.equal(recovered.claimId, 'cargo-claim-1');
  assert.equal(createCalls.length, 2);
  assert.equal(createCalls[0].requestId, persistedUuid);
  assert.equal(createCalls[1].requestId, persistedUuid);
  assert.deepEqual(createCalls[1].payload, persistedPayload);
  assert.deepEqual(createCalls[1].payload, createCalls[0].payload);
  assert.equal(harness.state.jobs.length, 1);
});

test('route, address, and customer contact changes invalidate a Business quote fingerprint', async (t) => {
  let createCalls = 0;
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        return { order_id: 'must-not-be-created', status: 'search' };
      },
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);
  const originalOrder = clone(harness.state.orders[0]);
  const changes = [
    {
      label: 'route coordinates',
      apply(order) {
        order.delivery_latitude += 0.001;
      },
    },
    {
      label: 'address',
      apply(order) {
        order.delivery_address.address = '15-й микрорайон, дом 20';
      },
    },
    {
      label: 'customer contact',
      apply(order) {
        order.additional_phone = '+77005554433';
      },
    },
  ];

  for (const change of changes) {
    const changedOrder = clone(originalOrder);
    change.apply(changedOrder);
    harness.state.orders[0] = changedOrder;
    await assert.rejects(
      harness.service.dispatchOrder(ORDER_ID, {
        deliveryJobId: quote.id,
        maxPriceKzt: 1300,
        quoteFingerprint: quote.quoteFingerprint,
      }),
      (error) => {
        assert.equal(error.code, 'YANDEX_BUSINESS_QUOTE_CHANGED', change.label);
        return true;
      },
    );
  }

  assert.equal(createCalls, 0);
  assert.equal(harness.state.jobs[0].provider_status, 'quoted');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'awaiting_confirmation');
});

test('a stale operator confirmation cannot create a newer Business quote on the same job', async (t) => {
  let createCalls = 0;
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        return { order_id: 'business-order-current-quote', status: 'search' };
      },
      getOrderInfo: async () => ({ id: 'business-order-current-quote', status: 'search' }),
      getOrderProgress: async () => ({ status: 'search' }),
    },
  });

  const firstQuote = await harness.service.quoteOrder(ORDER_ID);
  harness.state.orders[0].delivery_address.address = '15-й микрорайон, дом 20';
  const currentQuote = await harness.service.quoteOrder(ORDER_ID);
  assert.equal(currentQuote.id, firstQuote.id);
  assert.notEqual(currentQuote.quoteFingerprint, firstQuote.quoteFingerprint);

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: firstQuote.id,
      maxPriceKzt: firstQuote.quotedPrice,
      quoteFingerprint: firstQuote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_QUOTE_VERSION_CHANGED',
  );
  assert.equal(createCalls, 0);
  assert.equal(harness.state.jobs[0].provider_status, 'quoted');

  const dispatched = await harness.service.dispatchOrder(ORDER_ID, {
    deliveryJobId: currentQuote.id,
    maxPriceKzt: currentQuote.quotedPrice,
    quoteFingerprint: currentQuote.quoteFingerprint,
  });
  assert.equal(dispatched.claimId, 'business-order-current-quote');
  assert.equal(createCalls, 1);
});

test('expired abandoned Business quotes release the order and erase retry PII', async (t) => {
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
    },
  });
  await harness.service.quoteOrder(ORDER_ID);
  const job = harness.state.jobs[0];
  job.quote_expires_at = '2020-01-01T00:00:00.000Z';
  assert.match(job.request_payload_ciphertext, /^v1\./);

  const result = await harness.service.syncActiveDeliveries({ limit: 5 });

  assert.deepEqual(result, { skipped: false, synced: 0, failed: 0 });
  assert.equal(job.provider_status, 'cancelled');
  assert.equal(job.request_payload_ciphertext, null);
  assert.equal(job.quote_fingerprint, null);
  assert.equal(job.quoted_price, null);
  assert.equal(job.authorized_max_price, null);
  assert.equal(job.raw_response.quoteExpired, true);
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'failed');
});

test('a definite Business create rejection clears the quote and returns the order to confirmation', async (t) => {
  const createError = Object.assign(new Error('Yandex rejected the request'), {
    statusCode: 422,
    code: 'YANDEX_BUSINESS_HTTP_ERROR',
  });
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        throw createError;
      },
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);
  const originalUuid = harness.state.jobs[0].client_request_id;

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error === createError,
  );

  const [job] = harness.state.jobs;
  assert.equal(job.client_request_id, originalUuid);
  assert.equal(job.provider_status, 'draft');
  assert.equal(job.authorized_max_price, null);
  assert.equal(job.quote_expires_at, null);
  assert.equal(job.request_payload_ciphertext, null);
  assert.match(job.last_error, /rejected/i);
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'awaiting_confirmation');
  assert.equal(harness.state.orders[0].courier_dispatch_provider, 'yandex');
  assert.match(harness.state.orders[0].courier_dispatch_error, /rejected/i);
});

test('a Business creating_uncertain job cannot be presented as free cancellation or cancelled locally', async (t) => {
  const uncertainJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    provider_status: 'creating_uncertain',
    internal_status: 'unassigned',
    authorized_max_price: 1300,
    currency: 'KZT',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    client: {},
    order: makeOrder({
      courier_dispatch_status: 'processing',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [uncertainJob],
  });

  for (const operation of [
    () => harness.service.getCancellationInfo(ORDER_ID),
    () => harness.service.cancelDelivery(ORDER_ID),
  ]) {
    await assert.rejects(operation(), (error) => {
      assert.equal(error.code, 'YANDEX_BUSINESS_CREATE_UNCERTAIN');
      assert.equal(error.details.deliveryJobId, JOB_ID);
      return true;
    });
  }

  assert.equal(harness.state.jobs[0].provider_status, 'creating_uncertain');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'processing');
});

test('quote and dispatch keep using a persisted Business family after current mode switches to Cargo', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    provider_status: 'quoted',
    internal_status: 'unassigned',
    quoted_price: 1250,
    currency: 'KZT',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const calls = [];
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone([{ name: 'thermobag', type: 'boolean' }]),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async (_payload, { idempotencyToken }) => {
        calls.push(`create:${idempotencyToken}`);
        return { order_id: 'business-order-after-switch', status: 'search' };
      },
      getOrderInfo: async () => ({
        id: 'business-order-after-switch',
        status: 'search',
        cancel_rules: { can_cancel: true, state: 'free' },
      }),
      getOrderProgress: async () => ({ status: 'search', time_left_raw: 300 }),
    },
    jobs: [businessJob],
    environment: { YANDEX_DELIVERY_API_MODE: 'cargo_v2' },
  });

  const quote = await harness.service.quoteOrder(ORDER_ID);
  const dispatched = await harness.service.dispatchOrder(ORDER_ID, {
    deliveryJobId: quote.id,
    maxPriceKzt: quote.quotedPrice,
    quoteFingerprint: quote.quoteFingerprint,
  });

  assert.equal(harness.getCargoFetchCalls(), 0);
  assert.equal(harness.state.jobs.length, 1);
  assert.equal(harness.state.jobs[0].api_family, 'business_v2');
  assert.equal(dispatched.apiFamily, 'business_v2');
  assert.equal(dispatched.status, 'search');
  assert.deepEqual(calls, [`create:${businessJob.client_request_id}`]);
  const beginIndex = harness.state.operations.findIndex(
    (operation) =>
      operation.table === 'delivery_jobs' && operation.payload?.provider_status === 'creating',
  );
  const reserveIndex = harness.state.operations.findIndex(
    (operation) =>
      operation.table === 'kaspi_orders' &&
      operation.payload?.courier_dispatch_status === 'processing',
  );
  assert.ok(beginIndex >= 0 && reserveIndex > beginIndex, 'job CAS must win before order reserve');
});

test('a concurrent cancel cannot revive a Business job after create begins', async (t) => {
  let injectCreate = true;
  const quotedJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    provider_status: 'quoted',
    internal_status: 'unassigned',
    currency: 'KZT',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    client: {},
    jobs: [quotedJob],
    beforeRun: ({ table, action, payload, state }) => {
      if (
        injectCreate &&
        table === 'delivery_jobs' &&
        action === 'update' &&
        payload?.provider_status === 'cancelled'
      ) {
        injectCreate = false;
        state.jobs[0].provider_status = 'creating';
        state.jobs[0].authorized_max_price = 1300;
      }
    },
  });

  await assert.rejects(harness.service.cancelDelivery(ORDER_ID), (error) => {
    assert.equal(error.code, 'YANDEX_BUSINESS_CANCEL_RACE_LOST');
    return true;
  });
  assert.equal(harness.state.jobs[0].provider_status, 'creating');
  assert.equal(harness.state.jobs[0].cancelled_at == null, true);
});

test('Business cancellation stays active when the provider does not confirm cancelled', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-cancel-pending',
    provider_status: 'waiting',
    internal_status: 'assigned',
    currency: 'KZT',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    client: {
      getOrderInfo: async () => ({
        id: businessJob.external_claim_id,
        status: 'waiting',
        cancel_rules: { can_cancel: true, state: 'free' },
      }),
      cancelOrder: async () => ({ status: 'processing' }),
    },
    jobs: [businessJob],
  });

  await assert.rejects(harness.service.cancelDelivery(ORDER_ID), (error) => {
    assert.equal(error.code, 'YANDEX_BUSINESS_CANCEL_UNCONFIRMED');
    return true;
  });
  assert.equal(harness.state.jobs[0].provider_status, 'waiting');
  assert.match(harness.state.jobs[0].last_error, /не подтвердил отмену/i);
  assert.notEqual(harness.state.orders[0].courier_dispatch_status, 'failed');
});

test('stale dispatch recovery keeps a Business uncertain reservation and delegates same-job recovery', async (t) => {
  const uncertainJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    provider_status: 'creating_uncertain',
  };
  const orderUpdates = [];
  const syncCalls = [];
  const fakeSupabase = {
    async rpc(name, args) {
      assert.equal(name, 'project_yandex_delivery_status');
      assert.equal(args.p_job_id, state.job.id);
      assert.equal(args.p_expected_provider_status, state.job.provider_status);
      state.job.internal_status = args.p_internal_status;
      state.order.delivery_status =
        args.p_internal_status === 'cancelled' ? 'unassigned' : args.p_internal_status;
      return { data: { ...state.job }, error: null };
    },
    from(table) {
      let action = 'select';
      let payload = null;
      const filters = [];
      const run = async (single) => {
        if (action === 'update') {
          orderUpdates.push({ table, payload: clone(payload), filters: clone(filters) });
          return { data: single ? { id: ORDER_ID } : [{ id: ORDER_ID }], error: null };
        }
        if (table === 'delivery_jobs') {
          return { data: single ? clone(uncertainJob) : [clone(uncertainJob)], error: null };
        }
        const staleQuery = filters.some((filter) => filter.kind === 'lt');
        const rows = staleQuery ? [{ id: ORDER_ID }] : [];
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const builder = {
        select() {
          return builder;
        },
        update(value) {
          action = 'update';
          payload = value;
          return builder;
        },
        eq(column, value) {
          filters.push({ kind: 'eq', column, value });
          return builder;
        },
        in(column, values) {
          filters.push({ kind: 'in', column, values });
          return builder;
        },
        is(column, value) {
          filters.push({ kind: 'is', column, value });
          return builder;
        },
        lt(column, value) {
          filters.push({ kind: 'lt', column, value });
          return builder;
        },
        lte(column, value) {
          filters.push({ kind: 'lte', column, value });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          return run(true);
        },
        then(resolve, reject) {
          return run(false).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  installModule(t, '../src/config/supabase', { supabase: fakeSupabase });
  installModule(t, '../src/services/yandex-delivery.service', {
    syncOrderDelivery: async (orderId) => {
      syncCalls.push({ orderId, clientRequestId: uncertainJob.client_request_id });
      return { status: 'creating_uncertain' };
    },
  });
  const orchestrationPath = require.resolve('../src/services/delivery-orchestration.service');
  const previousOrchestration = require.cache[orchestrationPath];
  delete require.cache[orchestrationPath];
  t.after(() => {
    if (previousOrchestration) require.cache[orchestrationPath] = previousOrchestration;
    else delete require.cache[orchestrationPath];
  });
  const orchestration = require(orchestrationPath);

  const processed = await orchestration.processDeliveryDispatchQueue(20);

  assert.equal(processed, 0);
  assert.deepEqual(syncCalls, [
    {
      orderId: ORDER_ID,
      clientRequestId: '33333333-3333-4333-8333-333333333333',
    },
  ]);
  assert.deepEqual(orderUpdates, []);
  assert.equal(uncertainJob.provider_status, 'creating_uncertain');
});

test('syncing a fresh Business failure repairs the order dispatch state', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'driving',
    internal_status: 'assigned',
    currency: 'KZT',
    raw_response: {
      fixedPrice: true,
      className: 'express',
      createReconciliation: {
        status: 'attach',
        actor: 'owner-1',
        reason: 'ID проверен вручную',
        requestId: 'request-terminal-sync',
      },
    },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'assigned',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [businessJob],
    client: {
      getOrderInfo: async () => ({ id: 'business-order-1', status: 'failed' }),
      getOrderProgress: async () => ({ status: 'failed' }),
    },
  });

  const result = await harness.service.syncDeliveryJob(clone(businessJob));

  assert.equal(result.status, 'failed');
  assert.equal(result.terminal, true);
  assert.equal(harness.state.jobs[0].internal_status, 'cancelled');
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'failed');
  assert.equal(harness.state.orders[0].courier_dispatch_provider, 'yandex');
  assert.match(harness.state.orders[0].courier_dispatch_error, /failed/);
  assert.equal(harness.state.jobs[0].raw_response.createReconciliation.actor, 'owner-1');
});

test('syncing an already terminal Business cancellation still repairs the order dispatch state', async (t) => {
  const terminalJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'cancelled',
    internal_status: 'cancelled',
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'assigned',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [terminalJob],
    client: {},
  });

  const result = await harness.service.syncDeliveryJob(clone(terminalJob));

  assert.equal(result.status, 'cancelled');
  assert.equal(result.terminal, true);
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'failed');
  assert.match(harness.state.orders[0].courier_dispatch_error, /cancelled/);
});

test('Business sync persists the VAT-inclusive provider price', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'driving',
    internal_status: 'assigned',
    provider_price: 1250,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    jobs: [businessJob],
    client: {
      getOrderInfo: async () => ({
        id: 'business-order-1',
        status: 'driving',
        cost: '1 000,00 ₸',
        cost_with_vat: '1 120,00 ₸',
      }),
      getOrderProgress: async () => ({ status: 'driving', time_left_raw: 240 }),
    },
  });

  const result = await harness.service.syncDeliveryJob(clone(businessJob));

  assert.equal(result.price, 1120);
  assert.equal(harness.state.jobs[0].provider_price, 1120);
  assert.equal(harness.state.jobs[0].raw_response.billedPriceExVat, 1000);
  assert.equal(harness.state.jobs[0].raw_response.billedPriceWithVat, 1120);
});

test('an unknown Business status stays active and makes the sync worker fail closed', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'driving',
    internal_status: 'assigned',
    provider_price: 1250,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    last_error: null,
    last_synced_at: '2026-08-13T08:02:00.000Z',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'assigned',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [businessJob],
    client: {
      getOrderInfo: async () => ({
        id: 'business-order-1',
        status: 'provider_added_a_new_state',
      }),
      getOrderProgress: async () => ({ status: 'provider_added_a_new_state' }),
    },
  });
  const originalConsoleError = console.error;
  console.error = () => undefined;
  t.after(() => {
    console.error = originalConsoleError;
  });

  await assert.rejects(harness.service.syncActiveDeliveries(), (error) => {
    assert.equal(error.code, 'YANDEX_DELIVERY_SYNC_PARTIAL_FAILURE');
    assert.deepEqual(error.details, { synced: 0, failed: 1 });
    return true;
  });

  const [job] = harness.state.jobs;
  const normalized = harness.service.normalizeDeliveryJob(job);
  assert.equal(job.provider_status, 'provider_added_a_new_state');
  assert.equal(normalized.terminal, false);
  assert.equal(normalized.active, true);
  assert.match(normalized.lastError, /неизвестный статус provider_added_a_new_state/);
  assert.equal(harness.state.orders[0].courier_id, null);
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
  assert.equal(harness.state.orders[0].courier_dispatch_provider, 'yandex');
  assert.equal(harness.state.orders[0].courier_dispatch_completed_at == null, false);
  assert.equal(
    harness.state.operations.some(
      (operation) =>
        operation.table === 'kaspi_orders' &&
        ['retrying', 'awaiting_confirmation'].includes(
          String(operation.payload?.courier_dispatch_status),
        ),
    ),
    false,
  );
});

test('sync and cancel follow persisted api_family even when current mode is Cargo', async (t) => {
  const calls = [];
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    external_client_id: 'persisted-client',
    external_user_id: 'persisted-user',
    provider_status: 'driving',
    internal_status: 'assigned',
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const client = {
    getOrderInfo: async (orderId) => {
      calls.push(`business-info:${orderId}`);
      const cancelling = calls.includes(`business-cancel:${orderId}:free`);
      const initialSync = calls.filter((call) => call === `business-info:${orderId}`).length === 1;
      return {
        id: orderId,
        status: cancelling ? 'cancelled' : initialSync ? 'driving' : 'search',
        ...(initialSync && {
          performer: {
            fullname: 'Ерлан',
            phone: '+77001234567',
            vehicle: { model: 'Toyota Camry', number: '123 ABC 12', color: 'Белый' },
          },
        }),
        cancel_rules: { can_cancel: true, state: 'free', message: 'Бесплатно' },
      };
    },
    getOrderProgress: async (orderId) => {
      calls.push(`business-progress:${orderId}`);
      return { status: 'driving', time_left_raw: 240 };
    },
    cancelOrder: async (orderId, state) => {
      calls.push(`business-cancel:${orderId}:${state}`);
      return { status: 'cancelled' };
    },
  };
  const harness = loadService(t, {
    client,
    jobs: [businessJob],
    environment: { YANDEX_DELIVERY_API_MODE: 'cargo_v2' },
  });

  const synced = await harness.service.syncDeliveryJob(clone(businessJob));
  assert.equal(synced.apiFamily, 'business_v2');
  assert.equal(synced.status, 'driving');
  assert.equal(synced.deliveryStatus, 'assigned');
  assert.equal(synced.courier.name, 'Ерлан');
  assert.deepEqual(calls.slice(0, 2).sort(), [
    'business-info:business-order-1',
    'business-progress:business-order-1',
  ]);
  assert.equal(harness.clientConfigurations[0].clientId, 'persisted-client');
  assert.equal(harness.clientConfigurations[0].userId, 'persisted-user');

  const cancelled = await harness.service.cancelDelivery(ORDER_ID);
  assert.equal(cancelled.apiFamily, 'business_v2');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.terminal, true);
  assert.equal(calls.includes('business-cancel:business-order-1:free'), true);
  assert.equal(harness.clientConfigurations.at(-1).clientId, 'persisted-client');
  assert.equal(harness.clientConfigurations.at(-1).userId, 'persisted-user');
  assert.equal(harness.getCargoFetchCalls(), 0);
});

test('Business cancellation fails closed when pickup races between rules and cancel', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: 'business-order-race',
    external_client_id: 'corp-client-1',
    external_user_id: 'employee-1',
    provider_status: 'search',
    internal_status: 'unassigned',
    currency: 'KZT',
    raw_response: {
      fixedPrice: true,
      createReconciliation: {
        status: 'attach',
        actor: 'owner-1',
        reason: 'ID проверен в кабинете',
        requestId: 'request-attach',
      },
    },
  };
  let infoCalls = 0;
  const harness = loadService(t, {
    order: makeOrder({
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [businessJob],
    client: {
      getOrderInfo: async () => {
        infoCalls += 1;
        return infoCalls === 1
          ? {
              status: 'search',
              cancel_rules: { can_cancel: true, state: 'free' },
            }
          : {
              status: 'cancelled',
              performer: {
                fullname: 'Курьер получил заказ во время отмены',
                vehicle: { model: 'Toyota' },
              },
            };
      },
      cancelOrder: async () => ({ status: 'cancelled' }),
    },
  });

  const result = await harness.service.cancelDelivery(ORDER_ID);

  assert.equal(infoCalls, 2);
  assert.equal(result.status, 'cancelled_items_unresolved');
  assert.equal(result.active, true);
  assert.equal(result.itemsResolutionRequired, true);
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
  assert.equal(harness.state.jobs[0].raw_response.createReconciliation.actor, 'owner-1');
  assert.deepEqual(harness.state.jobs[0].raw_response.cancellationEvidence, {
    preStatus: 'search',
    postStatus: 'cancelled',
    postIdentityVerified: true,
    postHasPerformer: true,
    strictlyPrePickup: true,
  });
});

test('Business cancellation releases only after strict free pre-pickup and fresh cancelled proof', async (t) => {
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: 'business-order-safe-cancel',
    external_user_id: 'employee-1',
    provider_status: 'search',
    internal_status: 'unassigned',
    raw_response: { fixedPrice: true, provenance: { source: 'quoted' } },
  };
  let infoCalls = 0;
  const harness = loadService(t, {
    jobs: [businessJob],
    client: {
      getOrderInfo: async () => {
        infoCalls += 1;
        return infoCalls === 1
          ? { status: 'search', cancel_rules: { can_cancel: true, state: 'free' } }
          : { status: 'cancelled' };
      },
      cancelOrder: async () => ({ status: 'cancelled' }),
    },
  });

  const result = await harness.service.cancelDelivery(ORDER_ID);

  assert.equal(infoCalls, 2);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.terminal, true);
  assert.deepEqual(harness.state.jobs[0].raw_response.provenance, { source: 'quoted' });
  assert.deepEqual(harness.state.jobs[0].raw_response.cancellationEvidence, {
    preStatus: 'search',
    postStatus: 'cancelled',
    postIdentityVerified: true,
    postHasPerformer: false,
    strictlyPrePickup: true,
  });
});

test('Business cancellation never calls cancel for a mismatched order or employee', async (t) => {
  let cancelCalls = 0;
  const job = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: 'expected-order',
    external_user_id: 'employee-1',
    provider_status: 'search',
    internal_status: 'unassigned',
  };
  const harness = loadService(t, {
    jobs: [job],
    client: {
      getOrderInfo: async () => ({
        id: 'different-order',
        user_id: 'different-employee',
        status: 'search',
        cancel_rules: { can_cancel: true, state: 'free' },
      }),
      cancelOrder: async () => {
        cancelCalls += 1;
        return { status: 'cancelled' };
      },
    },
  });

  await assert.rejects(harness.service.cancelDelivery(ORDER_ID), (error) => {
    assert.equal(error.code, 'YANDEX_BUSINESS_ORDER_IDENTITY_MISMATCH');
    return true;
  });
  assert.equal(cancelCalls, 0);
  assert.equal(harness.state.jobs[0].provider_status, 'search');
});

test('Business status normalization and terminal checks stay isolated from Cargo status names', (t) => {
  const harness = loadService(t, { client: {} });
  assert.equal(harness.service.mapYandexStatus('transporting', 'business_v2'), 'en_route');
  assert.equal(harness.service.mapYandexStatus('complete', 'business_v2'), 'delivered');
  assert.equal(harness.service.isTerminalStatus('complete', 'business_v2'), true);
  assert.equal(harness.service.isTerminalStatus('driving', 'business_v2'), false);
  assert.equal(harness.service.isTerminalStatus('complete', 'cargo_v2'), false);

  const normalized = harness.service.normalizeDeliveryJob({
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: 'business-order-1',
    provider_status: 'complete',
    internal_status: 'delivered',
    provider_price: 1250,
    currency: 'KZT',
  });
  assert.equal(normalized.apiFamily, 'business_v2');
  assert.equal(normalized.deliveryStatus, 'delivered');
  assert.equal(normalized.terminal, true);
  assert.equal(normalized.active, false);

  const quoted = harness.service.normalizeDeliveryJob({
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: null,
    provider_status: 'quoted',
    internal_status: 'unassigned',
  });
  assert.equal(quoted.active, true);
  assert.equal(quoted.canCancel, true);

  const cargoDraft = harness.service.normalizeDeliveryJob({
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'cargo_v2',
    external_claim_id: null,
    provider_status: 'draft',
    internal_status: 'unassigned',
  });
  assert.equal(cargoDraft.active, true);
  assert.equal(cargoDraft.canCancel, true);
});

test('financial courier creation is statically owner/admin plus MFA-only and migration allows confirmation wait', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8',
  );
  assert.match(
    routeSource,
    /const hasYandexFinancialRole = \(req\) => \['admin', 'owner'\]\.includes\(req\.admin\.role\);/,
  );
  assert.match(routeSource, /hasYandexFinancialRole\(req\) && req\.admin\?\.mfa === true/);
  const requestRoute = routeSource.slice(
    routeSource.indexOf("'/admin/api/dispatch/:orderId/yandex/request'"),
    routeSource.indexOf("'/admin/api/dispatch/:orderId/yandex/sync'"),
  );
  assert.match(requestRoute, /assertYandexDispatchCreateAccess\(req\)/);
  assert.match(routeSource, /code: 'ADMIN_MFA_REQUIRED'/);
  assert.match(requestRoute, /yandexDelivery\.dispatchOrder/);
  assert.ok(
    requestRoute.indexOf('assertYandexDispatchCreateAccess(req)') <
      requestRoute.indexOf('yandexDelivery.dispatchOrder'),
  );

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260813100000_yandex_business_api.sql'),
    'utf8',
  );
  const dispatchConstraint = migration.match(
    /add constraint kaspi_orders_courier_dispatch_status_check[\s\S]*?\n\s*\);/i,
  )?.[0];
  assert.ok(dispatchConstraint, 'courier dispatch status constraint must be recreated');
  assert.match(dispatchConstraint, /'awaiting_confirmation'/);
});

test('a Business failure after pickup keeps the order reserved and alarms the sync worker', async (t) => {
  const postPickupJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'transporting',
    internal_status: 'en_route',
    picked_up_at: '2026-08-13T08:10:00.000Z',
    authorized_max_price: 1000,
    provider_price: 900,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    last_error: null,
    last_synced_at: '2026-08-13T08:11:00.000Z',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:11:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'en_route',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [postPickupJob],
    client: {
      getOrderInfo: async () => ({
        id: 'business-order-1',
        status: 'failed',
        cost_with_vat: '1 120,00 ₸',
      }),
      getOrderProgress: async () => ({ status: 'failed' }),
    },
  });

  const result = await harness.service.syncDeliveryJob(clone(postPickupJob));

  assert.equal(result.status, 'cancelled_items_unresolved');
  assert.equal(result.deliveryStatus, 'en_route');
  assert.equal(result.active, true);
  assert.equal(result.terminal, false);
  assert.equal(result.canCancel, false);
  assert.equal(result.priceOverrun, true);
  assert.match(result.lastError, /после получения заказа курьером/);
  assert.doesNotMatch(result.lastError, /превысила подтверждённый лимит/);
  assert.equal(harness.state.jobs[0].cancelled_at == null, true);
  assert.equal(harness.state.orders[0].delivery_status, 'en_route');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
  assert.equal(harness.state.orders[0].courier_dispatch_provider, 'yandex');

  const originalConsoleError = console.error;
  console.error = () => undefined;
  t.after(() => {
    console.error = originalConsoleError;
  });
  const attentionSync = await harness.service.syncActiveDeliveries({ limit: 5 });
  assert.deepEqual(attentionSync, { skipped: false, synced: 1, failed: 0 });
  assert.equal(harness.state.jobs[0].provider_status, 'cancelled_items_unresolved');
  assert.equal(harness.state.orders[0].delivery_status, 'en_route');

  const resolved = await harness.service.resolveBusinessDeliveryItems(ORDER_ID, {
    deliveryJobId: JOB_ID,
    resolution: 'returned',
    reason: 'Филиал подтвердил возврат заказа',
  });
  assert.equal(resolved.status, 'cancelled');
  assert.equal(resolved.priceOverrun, true);
  assert.match(resolved.lastError, /1120 ₸.*1000 ₸/);
});

test('Business failure keeps a conservative hold when polling missed the pickup transition', async (t) => {
  const scenarios = [
    {
      name: 'order handoff timestamp',
      previousProviderStatus: 'driving',
      handedToCourierAt: '2026-08-13T08:10:00.000Z',
    },
    {
      name: 'previous waiting provider status',
      previousProviderStatus: 'waiting',
      handedToCourierAt: null,
    },
    {
      name: 'previous transporting provider status',
      previousProviderStatus: 'transporting',
      handedToCourierAt: null,
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const job = {
        id: JOB_ID,
        order_id: ORDER_ID,
        provider: 'yandex',
        api_family: 'business_v2',
        client_request_id: '33333333-3333-4333-8333-333333333333',
        external_claim_id: 'business-order-1',
        provider_status: scenario.previousProviderStatus,
        internal_status:
          scenario.previousProviderStatus === 'transporting' ? 'en_route' : 'assigned',
        picked_up_at: null,
        currency: 'KZT',
        raw_response: { fixedPrice: true, className: 'express' },
        last_error: null,
        last_synced_at: '2026-08-13T08:11:00.000Z',
        created_at: '2026-08-13T08:01:00.000Z',
        updated_at: '2026-08-13T08:11:00.000Z',
      };
      const harness = loadService(subtest, {
        order: makeOrder({
          handed_to_courier_at: scenario.handedToCourierAt,
          delivery_status: scenario.previousProviderStatus === 'driving' ? 'assigned' : 'en_route',
          courier_dispatch_status: 'succeeded',
          courier_dispatch_provider: 'yandex',
        }),
        jobs: [job],
        client: {
          getOrderInfo: async () => ({ id: 'business-order-1', status: 'failed' }),
          getOrderProgress: async () => ({ status: 'failed' }),
        },
      });

      const result = await harness.service.syncDeliveryJob(clone(job));

      assert.equal(result.status, 'cancelled_items_unresolved');
      assert.equal(result.active, true);
      assert.equal(result.terminal, false);
      const expectedInternal =
        scenario.previousProviderStatus === 'transporting' ? 'en_route' : 'picked_up';
      assert.equal(result.deliveryStatus, expectedInternal);
      assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
      assert.equal(harness.state.orders[0].delivery_status, expectedInternal);
    });
  }
});

test('manual returned resolution uses a guarded transition and releases the reservation', async (t) => {
  const unresolvedJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'cancelled_items_unresolved',
    internal_status: 'en_route',
    picked_up_at: '2026-08-13T08:10:00.000Z',
    currency: 'KZT',
    raw_response: {
      fixedPrice: true,
      providerReportedStatus: 'failed',
      itemsResolution: { status: 'pending' },
    },
    last_error: 'Нужно уточнить, где заказ',
    last_synced_at: '2026-08-13T08:11:00.000Z',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:11:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'en_route',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [unresolvedJob],
    client: {},
  });

  const result = await harness.service.resolveBusinessDeliveryItems(ORDER_ID, {
    deliveryJobId: JOB_ID,
    resolution: 'returned',
    reason: 'Сотрудник принял возврат в филиале',
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.deliveryStatus, 'cancelled');
  assert.equal(result.terminal, true);
  assert.equal(result.active, false);
  assert.equal(harness.state.jobs[0].raw_response.itemsResolution.status, 'returned');
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'failed');
  assert.match(harness.state.orders[0].courier_dispatch_error, /cancelled/);
});

test('worker resumes a crashed manual resolution with its durable actor and reason', async (t) => {
  const resolvingJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: 'business-order-1',
    provider_status: 'items_resolution_returned',
    internal_status: 'en_route',
    picked_up_at: '2026-08-13T08:10:00.000Z',
    raw_response: {
      providerReportedStatus: 'failed',
      itemsResolution: {
        status: 'resolving',
        resolution: 'returned',
        reason: 'Филиал физически принял возврат',
        actor: 'owner@example.test',
        requestId: '44444444-4444-4444-8444-444444444444',
        requestedAt: '2026-08-13T08:12:00.000Z',
      },
    },
    last_error: 'Проекция не завершена',
    last_synced_at: '2026-08-13T08:12:00.000Z',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:12:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'en_route',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [resolvingJob],
    client: {},
  });

  const result = await harness.service.syncDeliveryJob(clone(resolvingJob));

  assert.equal(result.status, 'cancelled');
  assert.equal(result.terminal, true);
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
  assert.deepEqual(harness.state.jobs[0].raw_response.itemsResolution, {
    status: 'returned',
    resolution: 'returned',
    reason: 'Филиал физически принял возврат',
    actor: 'owner@example.test',
    requestId: '44444444-4444-4444-8444-444444444444',
    requestedAt: '2026-08-13T08:12:00.000Z',
    resolvedAt: harness.state.jobs[0].raw_response.itemsResolution.resolvedAt,
  });
  assert.ok(Date.parse(harness.state.jobs[0].raw_response.itemsResolution.resolvedAt));
});

test('manual delivered resolution completes the order only while the synthetic reservation is held', async (t) => {
  const unresolvedJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'cancelled_items_unresolved',
    internal_status: 'en_route',
    picked_up_at: '2026-08-13T08:10:00.000Z',
    currency: 'KZT',
    raw_response: {
      fixedPrice: true,
      providerReportedStatus: 'cancelled',
      itemsResolution: { status: 'pending' },
    },
    last_error: 'Нужно уточнить, где заказ',
    last_synced_at: '2026-08-13T08:11:00.000Z',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:11:00.000Z',
  };
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'en_route',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [unresolvedJob],
    client: {},
  });
  let completionCalls = 0;
  installModule(t, '../src/services/customer-order.service', {
    updateAdminOrderStatus: async (orderId, status) => {
      assert.equal(orderId, ORDER_ID);
      assert.equal(status, 'completed');
      completionCalls += 1;
      harness.state.orders[0].fulfillment_status = status;
    },
  });

  const result = await harness.service.resolveBusinessDeliveryItems(ORDER_ID, {
    deliveryJobId: JOB_ID,
    resolution: 'delivered',
    reason: 'Клиент подтвердил получение по телефону',
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.deliveryStatus, 'delivered');
  assert.equal(result.terminal, true);
  assert.equal(completionCalls, 1);
  assert.equal(harness.state.jobs[0].raw_response.itemsResolution.status, 'delivered');
  assert.equal(harness.state.orders[0].delivery_status, 'delivered');
  assert.equal(harness.state.orders[0].fulfillment_status, 'completed');
});

test('a competing manual items resolution loses safely without changing the order', async (t) => {
  const harness = loadService(t, {
    order: makeOrder({
      delivery_status: 'en_route',
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
    }),
    jobs: [
      {
        id: JOB_ID,
        order_id: ORDER_ID,
        provider: 'yandex',
        api_family: 'business_v2',
        external_claim_id: 'business-order-1',
        provider_status: 'items_resolution_delivered',
        internal_status: 'en_route',
        picked_up_at: '2026-08-13T08:10:00.000Z',
        raw_response: { itemsResolution: { status: 'resolving', resolution: 'delivered' } },
      },
    ],
    client: {},
  });

  await assert.rejects(
    harness.service.resolveBusinessDeliveryItems(ORDER_ID, {
      deliveryJobId: JOB_ID,
      resolution: 'returned',
      reason: 'Конкурирующее решение',
    }),
    (error) => error.code === 'YANDEX_BUSINESS_ITEMS_RESOLUTION_RACE_LOST',
  );
  assert.equal(harness.state.jobs[0].provider_status, 'items_resolution_delivered');
  assert.equal(harness.state.orders[0].delivery_status, 'en_route');
});

test('Business final price overrun is sticky, visible, and never changes the authorized maximum', async (t) => {
  const costs = ['1 120,00 ₸', '900,00 ₸'];
  const businessJob = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: 'business-order-1',
    provider_status: 'driving',
    internal_status: 'assigned',
    authorized_max_price: 1000,
    provider_price: 900,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    last_error: null,
    last_synced_at: '2026-08-13T08:02:00.000Z',
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    jobs: [businessJob],
    client: {
      getOrderInfo: async () => ({
        id: 'business-order-1',
        status: 'driving',
        cost_with_vat: costs.shift(),
      }),
      getOrderProgress: async () => ({ status: 'driving' }),
    },
  });

  const overrun = await harness.service.syncDeliveryJob(clone(businessJob));
  assert.equal(overrun.price, 1120);
  assert.equal(overrun.authorizedMaxPrice, 1000);
  assert.equal(overrun.priceOverrun, true);
  assert.match(overrun.lastError, /1120 ₸.*1000 ₸/);
  assert.equal(harness.state.jobs[0].authorized_max_price, 1000);
  assert.equal(harness.state.jobs[0].raw_response.priceOverrun, true);

  const correctedProviderPrice = await harness.service.syncDeliveryJob(
    clone(harness.state.jobs[0]),
  );
  assert.equal(correctedProviderPrice.price, 900);
  assert.equal(correctedProviderPrice.priceOverrun, true);
  assert.match(correctedProviderPrice.lastError, /1120 ₸.*1000 ₸/);
  assert.equal(harness.state.jobs[0].authorized_max_price, 1000);
});

test('manual items resolution contract and route are exact, owner/admin MFA-gated, and audited', () => {
  const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
  const valid = adminMutationSchemas.yandexItemsResolution.body.safeParse({
    deliveryJobId: JOB_ID,
    resolution: 'returned',
    reason: 'Заказ вернулся в филиал',
  });
  assert.equal(valid.success, true);
  assert.equal(
    adminMutationSchemas.yandexItemsResolution.body.safeParse({
      deliveryJobId: JOB_ID,
      resolution: 'lost',
      reason: 'Неизвестно',
    }).success,
    false,
  );
  assert.equal(
    adminMutationSchemas.yandexCreateReconciliation.body.safeParse({
      deliveryJobId: JOB_ID,
      resolution: 'attach',
      externalOrderId: 'business-order-verified',
      reason: 'ID проверен в кабинете Яндекса',
    }).success,
    true,
  );
  assert.equal(
    adminMutationSchemas.yandexCreateReconciliation.body.safeParse({
      deliveryJobId: JOB_ID,
      resolution: 'not_created',
      reason: 'Заказ отсутствует в кабинете',
    }).success,
    true,
  );
  for (const invalid of [
    {
      deliveryJobId: JOB_ID,
      resolution: 'attach',
      reason: 'Не указан внешний ID',
    },
    {
      deliveryJobId: JOB_ID,
      resolution: 'not_created',
      externalOrderId: 'forbidden-id',
      reason: 'Лишний внешний ID',
    },
    {
      deliveryJobId: JOB_ID,
      resolution: 'not_created',
      reason: '',
    },
    {
      deliveryJobId: JOB_ID,
      resolution: 'attach',
      externalOrderId: 'business-order-verified',
      reason: 'Проверено',
      extra: true,
    },
  ]) {
    assert.equal(
      adminMutationSchemas.yandexCreateReconciliation.body.safeParse(invalid).success,
      false,
    );
  }
  assert.equal(
    adminMutationSchemas.yandexItemsResolution.body.safeParse({
      deliveryJobId: JOB_ID,
      resolution: 'delivered',
      reason: '',
    }).success,
    false,
  );

  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8',
  );
  const resolutionRoute = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin', 'yandex-items-resolution.routes.js'),
    'utf8',
  );
  assert.match(resolutionRoute, /validateRequest\(adminMutationSchemas\.yandexItemsResolution\)/);
  assert.match(resolutionRoute, /assertAccess\(req\)/);
  assert.match(resolutionRoute, /yandexDelivery\.resolveBusinessDeliveryItems/);
  assert.match(resolutionRoute, /actionCode: 'YANDEX_DELIVERY_ITEMS_RESOLVED'/);
  assert.match(resolutionRoute, /reason: req\.body\.reason/);
  assert.match(resolutionRoute, /actor: req\.admin\?\.sub/);
  assert.match(resolutionRoute, /requestId: req\.id/);
  assert.ok(
    resolutionRoute.indexOf('assertAccess(req)') <
      resolutionRoute.indexOf('resolveBusinessDeliveryItems'),
  );
  assert.match(
    routeSource,
    /registerYandexItemsResolutionAdminRoute\(router,[\s\S]*?assertAccess: assertYandexDispatchCreateAccess/,
  );
  assert.match(
    routeSource,
    /const hasYandexFinancialRole = \(req\) => \['admin', 'owner'\]\.includes\(req\.admin\.role\);/,
  );
  assert.match(routeSource, /hasYandexFinancialRole\(req\) && req\.admin\?\.mfa === true/);
  assert.match(
    resolutionRoute,
    /resolve-create'[\s\S]*?validateRequest\(adminMutationSchemas\.yandexCreateReconciliation\)/,
  );
  assert.match(resolutionRoute, /yandexDelivery\.resolveBusinessCreateReconciliation/);
  assert.match(resolutionRoute, /actionCode: 'YANDEX_DELIVERY_CREATE_RECONCILED'/);
  assert.match(resolutionRoute, /actor: req\.admin\?\.sub/);
  assert.match(resolutionRoute, /requestId: req\.id/);
  const createRouteIndex = resolutionRoute.indexOf(
    "'/admin/api/dispatch/:orderId/yandex/resolve-create'",
  );
  assert.ok(createRouteIndex >= 0);
  const createRoute = resolutionRoute.slice(createRouteIndex);
  assert.ok(
    createRoute.indexOf('assertAccess(req)') <
      createRoute.indexOf('resolveBusinessCreateReconciliation'),
  );
});

test('exhausted create remediation verifies the exact Business order and employee before binding', async (t) => {
  const exhausted = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    external_client_id: 'corp-client-1',
    external_user_id: 'employee-1',
    provider_status: 'creating_exhausted',
    internal_status: 'unassigned',
    reconciliation_attempts: 8,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    jobs: [exhausted],
    client: {
      getOrderInfo: async () => ({
        id: 'another-company-order',
        user_id: 'another-employee',
        status: 'search',
      }),
    },
  });

  await assert.rejects(
    () =>
      harness.service.resolveBusinessCreateReconciliation(ORDER_ID, {
        deliveryJobId: JOB_ID,
        resolution: 'attach',
        externalOrderId: 'business-order-verified',
        reason: 'Проверено владельцем в корпоративном кабинете',
        actor: 'owner-1',
        requestId: 'request-1',
      }),
    (error) => error.code === 'YANDEX_BUSINESS_RECONCILIATION_ORDER_MISMATCH',
  );
  assert.equal(harness.state.jobs[0].provider_status, 'creating_exhausted');
  assert.equal(harness.state.jobs[0].external_claim_id, null);
});

test('verified exhausted create binding survives a crash and worker completes the same job', async (t) => {
  let failReservationOnce = true;
  const exhausted = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    external_client_id: 'corp-client-1',
    external_user_id: 'employee-1',
    provider_status: 'creating_exhausted',
    internal_status: 'unassigned',
    reconciliation_attempts: 8,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    jobs: [exhausted],
    client: {
      getOrderInfo: async () => ({ status: 'search' }),
      getOrderProgress: async () => ({ status: 'search' }),
    },
    beforeRun: async ({ table, action, payload }) => {
      if (
        failReservationOnce &&
        table === 'kaspi_orders' &&
        action === 'update' &&
        payload?.courier_dispatch_status === 'succeeded'
      ) {
        failReservationOnce = false;
        throw new Error('simulated crash after durable attach CAS');
      }
    },
  });

  await assert.rejects(() =>
    harness.service.resolveBusinessCreateReconciliation(ORDER_ID, {
      deliveryJobId: JOB_ID,
      resolution: 'attach',
      externalOrderId: 'business-order-verified',
      reason: 'ID сверён в кабинете владельцем',
      actor: 'owner-1',
      requestId: 'request-2',
    }),
  );
  assert.equal(harness.state.jobs[0].provider_status, 'create_resolution_attaching');
  assert.equal(harness.state.jobs[0].external_claim_id, 'business-order-verified');

  const recovered = await harness.service.syncOrderDelivery(ORDER_ID);
  assert.equal(recovered.claimId, 'business-order-verified');
  assert.equal(recovered.status, 'search');
  assert.equal(harness.state.orders[0].courier_dispatch_status, 'succeeded');
  assert.deepEqual(harness.state.jobs[0].raw_response.createReconciliation, {
    status: 'attach',
    actor: 'owner-1',
    reason: 'ID сверён в кабинете владельцем',
    requestId: 'request-2',
    confirmedAt: harness.state.jobs[0].raw_response.createReconciliation.confirmedAt,
  });
});

test('confirmed absent exhausted create remains reserved until crash-safe order projection completes', async (t) => {
  let failProjectionOnce = true;
  const exhausted = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    client_request_id: '33333333-3333-4333-8333-333333333333',
    external_claim_id: null,
    external_client_id: 'corp-client-1',
    external_user_id: 'employee-1',
    provider_status: 'creating_exhausted',
    internal_status: 'unassigned',
    reconciliation_attempts: 8,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
    created_at: '2026-08-13T08:01:00.000Z',
    updated_at: '2026-08-13T08:02:00.000Z',
  };
  const harness = loadService(t, {
    jobs: [exhausted],
    client: {},
    beforeRun: async ({ table, action }) => {
      if (failProjectionOnce && table === 'kaspi_orders' && action === 'update') {
        failProjectionOnce = false;
        throw new Error('simulated crash during absent-order projection');
      }
    },
  });

  await assert.rejects(() =>
    harness.service.resolveBusinessCreateReconciliation(ORDER_ID, {
      deliveryJobId: JOB_ID,
      resolution: 'not_created',
      reason: 'В кабинете и списке активных заказов заявки нет',
      actor: 'owner-1',
      requestId: 'request-3',
    }),
  );
  assert.equal(harness.state.jobs[0].provider_status, 'create_resolution_not_created');
  assert.equal(harness.state.jobs[0].internal_status, 'unassigned');

  const recovered = await harness.service.syncOrderDelivery(ORDER_ID);
  assert.equal(recovered.status, 'cancelled');
  assert.equal(recovered.terminal, true);
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
  assert.equal(
    harness.state.jobs[0].raw_response.createReconciliation.reason,
    'В кабинете и списке активных заказов заявки нет',
  );
});

test('confirmed absent exhausted create works after Business credentials are revoked', async (t) => {
  const exhausted = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: null,
    external_client_id: 'corp-client-1',
    external_user_id: 'employee-1',
    provider_status: 'creating_exhausted',
    internal_status: 'unassigned',
    reconciliation_attempts: 8,
    currency: 'KZT',
    raw_response: { fixedPrice: true, className: 'express' },
  };
  const harness = loadService(t, {
    jobs: [exhausted],
    client: {},
    environment: {
      YANDEX_DELIVERY_ENABLED: 'false',
      YANDEX_BUSINESS_API_TOKEN: '',
    },
  });

  const resolved = await harness.service.resolveBusinessCreateReconciliation(ORDER_ID, {
    deliveryJobId: JOB_ID,
    resolution: 'not_created',
    reason: 'Кабинет проверен владельцем, заявка отсутствует',
    actor: 'owner-1',
    requestId: 'request-revoked-token',
  });

  assert.equal(resolved.status, 'cancelled');
  assert.equal(harness.clientConfigurations.length, 0);
  assert.equal(harness.state.orders[0].delivery_status, 'unassigned');
});

test('a provider-created Business order with an invalid ID exhausts safely and is never recreated', async (t) => {
  let createCalls = 0;
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        return { order_id: 'x'.repeat(161), status: 'search' };
      },
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_ORDER_ID_INVALID',
  );
  assert.equal(createCalls, 1);
  assert.equal(harness.state.jobs[0].provider_status, 'creating_exhausted');
  assert.equal(harness.state.jobs[0].external_claim_id, null);
  assert.equal(harness.state.jobs[0].request_payload_ciphertext, null);
  const unresolved = await harness.service.syncOrderDelivery(ORDER_ID);
  assert.equal(unresolved.status, 'creating_exhausted');
  assert.equal(createCalls, 1);
});

test('manual attach maps an already-bound provider ID to a typed conflict without changing the job', async (t) => {
  const exhausted = {
    id: JOB_ID,
    order_id: ORDER_ID,
    provider: 'yandex',
    api_family: 'business_v2',
    external_claim_id: null,
    external_client_id: 'corp-client-1',
    external_user_id: 'employee-1',
    provider_status: 'creating_exhausted',
    internal_status: 'unassigned',
    raw_response: { fixedPrice: true, className: 'express' },
  };
  const harness = loadService(t, {
    jobs: [exhausted],
    client: { getOrderInfo: async () => ({ status: 'search' }) },
    beforeRun: ({ table, action, payload }) => {
      if (
        table === 'delivery_jobs' &&
        action === 'update' &&
        payload?.external_claim_id === 'already-bound-order'
      ) {
        throw Object.assign(new Error('duplicate key value'), { code: '23505' });
      }
    },
  });

  await assert.rejects(
    harness.service.resolveBusinessCreateReconciliation(ORDER_ID, {
      deliveryJobId: JOB_ID,
      resolution: 'attach',
      externalOrderId: 'already-bound-order',
      reason: 'ID проверен владельцем в кабинете',
      actor: 'owner-1',
      requestId: 'request-collision',
    }),
    (error) => error.code === 'YANDEX_BUSINESS_EXTERNAL_ORDER_ALREADY_BOUND',
  );
  assert.equal(harness.state.jobs[0].provider_status, 'creating_exhausted');
  assert.equal(harness.state.jobs[0].external_claim_id, null);
  assert.equal(harness.state.jobs[0].raw_response.createReconciliation, undefined);
});

test('provider create ID collision becomes manual attention and never issues a second create', async (t) => {
  let createCalls = 0;
  let injectCollision = true;
  const harness = loadService(t, {
    client: {
      getZoneInfo: async () => expressZone(),
      getRouteStats: async () => fixedRouteStats(),
      createOrder: async () => {
        createCalls += 1;
        return { order_id: 'already-bound-order', status: 'search' };
      },
    },
    beforeRun: ({ table, action, payload }) => {
      if (
        injectCollision &&
        table === 'delivery_jobs' &&
        action === 'update' &&
        payload?.external_claim_id === 'already-bound-order'
      ) {
        injectCollision = false;
        throw Object.assign(new Error('duplicate key value'), { code: '23505' });
      }
    },
  });
  const quote = await harness.service.quoteOrder(ORDER_ID);

  await assert.rejects(
    harness.service.dispatchOrder(ORDER_ID, {
      deliveryJobId: quote.id,
      maxPriceKzt: 1300,
      quoteFingerprint: quote.quoteFingerprint,
    }),
    (error) => error.code === 'YANDEX_BUSINESS_EXTERNAL_ORDER_ALREADY_BOUND',
  );
  assert.equal(createCalls, 1);
  assert.equal(harness.state.jobs[0].provider_status, 'creating_exhausted');
  assert.equal(harness.state.jobs[0].external_claim_id, null);
  assert.equal(harness.state.jobs[0].request_payload_ciphertext, null);
  const unresolved = await harness.service.syncOrderDelivery(ORDER_ID);
  assert.equal(unresolved.status, 'creating_exhausted');
  assert.equal(createCalls, 1);
});
