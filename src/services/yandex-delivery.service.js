const crypto = require('crypto');
const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');
const { isDeliveryFulfillment } = require('../utils/fulfillment.util');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { credentialHash, decryptSecret, encryptSecret } = require('../utils/secret-envelope.util');
const realtime = require('./realtime.service');
const businessApi = require('./yandex-business-api');

const API_PREFIX = '/b2b/cargo/integration/v2';
const API_FAMILIES = Object.freeze({ CARGO: 'cargo_v2', BUSINESS: 'business_v2' });
const BUSINESS_ITEMS_UNRESOLVED_STATUS = 'cancelled_items_unresolved';
const BUSINESS_ITEMS_RESOLUTION_STATUSES = Object.freeze({
  returned: 'items_resolution_returned',
  delivered: 'items_resolution_delivered',
});
const BUSINESS_CREATE_RESOLUTION_STATUSES = Object.freeze({
  attach: 'create_resolution_attaching',
  notCreated: 'create_resolution_not_created',
});
const BUSINESS_POST_PICKUP_FAILURES = new Set(['cancelled', 'failed']);
const BUSINESS_RECONCILIATION_MAX_ATTEMPTS = 8;
const NON_RETRYABLE_DELIVERY_CODES = new Set([
  'BRANCH_COORDINATES_REQUIRED',
  'BRANCH_CITY_REQUIRED',
  'DELIVERY_COORDINATES_REQUIRED',
  'DELIVERY_CITY_REQUIRED',
  'DELIVERY_CITY_MISMATCH',
  'DELIVERY_ADDRESS_REQUIRED',
  'CUSTOMER_PHONE_REQUIRED',
]);
const TERMINAL_STATUSES = new Set([
  'estimating_failed',
  'performer_not_found',
  'delivered',
  'delivered_finish',
  'returned',
  'returned_finish',
  'failed',
  'cancelled',
  'cancelled_with_payment',
  'cancelled_by_taxi',
  'cancelled_with_items_on_hands',
]);
const COURIER_VISIBLE_STATUSES = new Set([
  'performer_found',
  'pickup_arrived',
  'ready_for_pickup_confirmation',
  'pickuped',
  'delivery_arrived',
  'ready_for_delivery_confirmation',
]);
const STATUS_LABELS = {
  draft: 'Не отправлено',
  quoted: 'Стоимость рассчитана',
  creating: 'Создаём заявку',
  creating_uncertain: 'Уточняем результат создания',
  new: 'Расчёт заказа',
  estimating: 'Расчёт заказа',
  estimating_failed: 'Не удалось рассчитать',
  ready_for_approval: 'Ожидает подтверждения',
  accepted: 'Заказ принят Яндексом',
  performer_lookup: 'Ищем курьера',
  performer_draft: 'Ищем курьера',
  performer_found: 'Курьер назначен',
  performer_not_found: 'Курьер не найден',
  pickup_arrived: 'Курьер приехал в пекарню',
  ready_for_pickup_confirmation: 'Курьер ожидает заказ',
  pickuped: 'Курьер забрал заказ',
  delivery_arrived: 'Курьер прибыл к клиенту',
  ready_for_delivery_confirmation: 'Ожидается вручение',
  delivered: 'Заказ доставлен',
  delivered_finish: 'Заказ доставлен',
  returning: 'Заказ возвращается',
  return_arrived: 'Курьер вернулся в пекарню',
  ready_for_return_confirmation: 'Ожидается возврат',
  returned: 'Заказ возвращён',
  returned_finish: 'Заказ возвращён',
  failed: 'Ошибка доставки',
  cancelled: 'Доставка отменена',
  cancelled_with_payment: 'Доставка отменена платно',
  cancelled_by_taxi: 'Отменено Яндексом',
  cancelled_with_items_on_hands: 'Отменено после получения заказа',
};

const deliveryError = (message, statusCode = 400, code, details) =>
  Object.assign(new Error(message), {
    statusCode,
    ...(code && { code }),
    ...(code && { retryable: !NON_RETRYABLE_DELIVERY_CODES.has(code) }),
    ...(details && { details }),
  });

const numberFromEnv = (name, fallback, min, max) => {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

function getConfig(env = process.env) {
  const taxiClass = ['courier', 'express'].includes(String(env.YANDEX_DELIVERY_TAXI_CLASS))
    ? String(env.YANDEX_DELIVERY_TAXI_CLASS)
    : 'courier';
  const configuredCargoOptions = String(env.YANDEX_DELIVERY_CARGO_OPTIONS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const cargoOptions = [...new Set([...configuredCargoOptions, 'auto_courier', 'thermobag'])];
  const apiMode =
    String(env.YANDEX_DELIVERY_API_MODE || API_FAMILIES.CARGO) === API_FAMILIES.BUSINESS
      ? API_FAMILIES.BUSINESS
      : API_FAMILIES.CARGO;
  const business = businessApi.getBusinessConfig(env);
  const maximumBusinessPrice = Number(env.YANDEX_BUSINESS_MAX_PRICE_KZT);
  const quoteMaximumAgeSeconds = Number(env.YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS || 120);
  return {
    apiMode,
    enabled: env.YANDEX_DELIVERY_ENABLED === 'true',
    // Business orders always require a fresh fixed quote and explicit price
    // confirmation. Automatic kitchen dispatch remains Cargo-only.
    autoDispatch: apiMode === API_FAMILIES.CARGO && env.YANDEX_DELIVERY_AUTO_DISPATCH === 'true',
    token: String(env.YANDEX_DELIVERY_API_TOKEN || '').trim(),
    baseUrl: String(env.YANDEX_DELIVERY_BASE_URL || 'https://b2b.taxi.yandex.net').replace(
      /\/+$/,
      '',
    ),
    senderName: String(env.YANDEX_DELIVERY_SENDER_NAME || 'Bulka')
      .trim()
      .slice(0, 160),
    senderPhone: normalizeKazakhstanPhone(env.YANDEX_DELIVERY_SENDER_PHONE),
    country: String(env.YANDEX_DELIVERY_COUNTRY || 'Казахстан')
      .trim()
      .slice(0, 100),
    taxiClass,
    cargoOptions,
    business: {
      ...business,
      senderPhone: normalizeKazakhstanPhone(env.YANDEX_DELIVERY_SENDER_PHONE),
      maxPriceKzt:
        Number.isFinite(maximumBusinessPrice) && maximumBusinessPrice > 0
          ? Math.min(100_000, maximumBusinessPrice)
          : null,
      quoteMaxAgeSeconds: Number.isFinite(quoteMaximumAgeSeconds)
        ? Math.min(300, Math.max(30, Math.round(quoteMaximumAgeSeconds)))
        : 120,
      allowPaidCancel: env.YANDEX_BUSINESS_ALLOW_PAID_CANCEL === 'true',
      restaurantDeliveryConfirmed: env.YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED === 'true',
    },
    opsAlertReceiver: {
      configured: (() => {
        try {
          const endpoint = new URL(String(env.OPS_ALERT_WEBHOOK_URL || ''));
          return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password;
        } catch {
          return false;
        }
      })(),
      required: env.OPS_ALERT_RECEIVER_REQUIRED === 'true',
      workersEnabled: env.RUN_BACKGROUND_WORKERS === 'true' && !env.VERCEL,
      deliverySyncEnabled: env.RUN_YANDEX_DELIVERY_WORKER !== 'false' && !env.VERCEL,
    },
    skipConfirmation: env.YANDEX_DELIVERY_SKIP_CONFIRMATION !== 'false',
    timeoutMs: numberFromEnv('YANDEX_DELIVERY_TIMEOUT_MS', 15000, 3000, 30000),
    defaultItem: {
      length: numberFromEnv('YANDEX_DELIVERY_ITEM_LENGTH_M', 0.3, 0.01, 2),
      width: numberFromEnv('YANDEX_DELIVERY_ITEM_WIDTH_M', 0.25, 0.01, 2),
      height: numberFromEnv('YANDEX_DELIVERY_ITEM_HEIGHT_M', 0.15, 0.01, 2),
      weight: numberFromEnv('YANDEX_DELIVERY_ITEM_WEIGHT_KG', 0.5, 0.01, 20),
    },
  };
}

function getConfigurationStatus(env = process.env) {
  const config = getConfig(env);
  const cargoMissing = [];
  if (!config.token) cargoMissing.push('YANDEX_DELIVERY_API_TOKEN');
  if (!config.senderPhone) cargoMissing.push('YANDEX_DELIVERY_SENDER_PHONE');
  const businessStatus = businessApi.getBusinessApiConfigurationStatus(config.business);
  const businessMissing = [...businessStatus.missing];
  if (!config.business.senderPhone) businessMissing.push('YANDEX_DELIVERY_SENDER_PHONE');
  if (!config.business.maxPriceKzt) businessMissing.push('YANDEX_BUSINESS_MAX_PRICE_KZT');
  const missing = [];
  if (!config.enabled) missing.push('YANDEX_DELIVERY_ENABLED');
  if (config.apiMode === API_FAMILIES.BUSINESS) {
    missing.push(...businessMissing);
  } else {
    missing.push(...cargoMissing);
  }
  const configured = missing.length === 0;
  const alertReceiverReady =
    config.opsAlertReceiver.configured === true &&
    config.opsAlertReceiver.required === true &&
    config.opsAlertReceiver.workersEnabled === true &&
    config.opsAlertReceiver.deliverySyncEnabled === true;
  const businessDispatchMissing = [];
  if (config.business.restaurantDeliveryConfirmed !== true) {
    businessDispatchMissing.push('YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED');
  }
  if (config.opsAlertReceiver.configured !== true) {
    businessDispatchMissing.push('OPS_ALERT_WEBHOOK_URL');
  }
  if (config.opsAlertReceiver.required !== true) {
    businessDispatchMissing.push('OPS_ALERT_RECEIVER_REQUIRED');
  }
  if (config.opsAlertReceiver.workersEnabled !== true) {
    businessDispatchMissing.push('RUN_BACKGROUND_WORKERS');
  }
  if (config.opsAlertReceiver.deliverySyncEnabled !== true) {
    businessDispatchMissing.push('RUN_YANDEX_DELIVERY_WORKER');
  }
  if (env.VERCEL) businessDispatchMissing.push('VERCEL_UNSUPPORTED_BACKGROUND_WORKERS');
  const dispatchReady =
    configured &&
    (config.apiMode !== API_FAMILIES.BUSINESS || businessDispatchMissing.length === 0);
  return {
    apiMode: config.apiMode,
    providerLabel:
      config.apiMode === API_FAMILIES.BUSINESS ? 'Яндекс Go для бизнеса' : 'Яндекс.Доставка',
    enabled: config.enabled,
    configured,
    dispatchReady,
    missing,
    autoDispatch: config.autoDispatch,
    taxiClass:
      config.apiMode === API_FAMILIES.BUSINESS
        ? config.business.preferredClasses[0]
        : config.taxiClass,
    cargoOptions: config.apiMode === API_FAMILIES.CARGO ? config.cargoOptions : [],
    automobileOnly: config.apiMode === API_FAMILIES.CARGO,
    thermobagRequired:
      config.apiMode === API_FAMILIES.CARGO
        ? config.cargoOptions.includes('thermobag')
        : config.business.requirements.thermobag === true,
    maxPriceKzt: config.business.maxPriceKzt,
    quoteMaxAgeSeconds: config.business.quoteMaxAgeSeconds,
    restaurantDeliveryConfirmed: config.business.restaurantDeliveryConfirmed,
    alertReceiverConfigured: config.opsAlertReceiver.configured,
    alertReceiverRequired: config.opsAlertReceiver.required,
    alertReceiverReady,
    alertWorkersEnabled: config.opsAlertReceiver.workersEnabled,
    deliverySyncWorkerEnabled: config.opsAlertReceiver.deliverySyncEnabled,
    dispatchMissing: config.apiMode === API_FAMILIES.BUSINESS ? businessDispatchMissing : [],
    familyReadiness: {
      cargo_v2: { configured: cargoMissing.length === 0, missing: cargoMissing },
      business_v2: {
        configured: businessMissing.length === 0,
        dispatchReady: businessMissing.length === 0 && businessDispatchMissing.length === 0,
        missing: businessMissing,
        dispatchMissing: businessDispatchMissing,
      },
    },
  };
}

function assertConfigured(config = getConfig(), apiFamily = config.apiMode) {
  if (!config.enabled) {
    throw deliveryError(
      'Яндекс.Доставка выключена в настройках сервера',
      503,
      'YANDEX_DELIVERY_DISABLED',
    );
  }
  if (apiFamily === API_FAMILIES.BUSINESS) {
    businessApi.assertBusinessConfigured(config.business);
    if (!config.business.maxPriceKzt) {
      throw deliveryError(
        'Установите максимальную стоимость заказа Яндекс Go для бизнеса',
        503,
        'YANDEX_BUSINESS_MAX_PRICE_REQUIRED',
      );
    }
    return;
  }
  if (!config.token || !config.senderPhone) {
    throw deliveryError(
      'Заполните токен Яндекс.Доставки и телефон отправителя в настройках сервера',
      503,
      'YANDEX_DELIVERY_NOT_CONFIGURED',
    );
  }
}

const finiteCoordinate = (value, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

const boundedString = (value, maxLength = 300) =>
  String(value == null ? '' : value)
    .trim()
    .slice(0, maxLength);

const isPlainRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeRawResponse = (value) => (isPlainRecord(value) ? value : {});

const isUniqueViolation = (error) => String(error?.code || '') === '23505';

const businessExternalOrderAlreadyBoundError = (deliveryJobId) =>
  deliveryError(
    'Этот ID заказа Яндекса уже привязан к другой заявке. Требуется ручная проверка.',
    409,
    'YANDEX_BUSINESS_EXTERNAL_ORDER_ALREADY_BOUND',
    { deliveryJobId },
  );

const normalizeBusinessProviderStatus = (value, fallback = 'unknown') => {
  const candidate = boundedString(value, 80).toLowerCase();
  return /^[a-z0-9_]{1,80}$/.test(candidate) ? candidate : fallback;
};

const requiredCargoOptions = (config) => [
  ...new Set([
    ...(Array.isArray(config?.cargoOptions) ? config.cargoOptions : []),
    'auto_courier',
    'thermobag',
  ]),
];

const orderItemsSummary = (order, maximum = 350) => {
  const items = Array.isArray(order?.cart_items) ? order.cart_items : [];
  const shown = items
    .slice(0, 12)
    .map(
      (item) =>
        `${boundedString(item.name || item.title || 'Товар', 80)} × ${Math.max(
          1,
          Math.round(Number(item.quantity) || 1),
        )}`,
    );
  if (items.length > shown.length) shown.push(`ещё ${items.length - shown.length} поз.`);
  return boundedString(shown.join(', '), maximum);
};

const money = (value) => Math.max(0, Number(value) || 0).toFixed(2);

const normalizeCity = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/^(?:город|г)\.?\s*/u, '')
    .replace(/[«»"']/gu, '')
    .replace(/[^a-zа-яё0-9]+/giu, '');

function destinationAddress(order) {
  const raw =
    order.delivery_address && typeof order.delivery_address === 'object'
      ? order.delivery_address
      : {};
  const address = boundedString(raw.address || raw.fullname || raw.fullAddress || raw.label, 300);
  const city = boundedString(raw.city || raw.town || raw.locality || order.delivery_city, 100);
  return {
    ...raw,
    city,
    fullname:
      address && address.toLocaleLowerCase('ru-RU').includes(city.toLocaleLowerCase('ru-RU'))
        ? address
        : [city, address].filter(Boolean).join(', '),
  };
}

function cargoItems(order, config, { quote = false } = {}) {
  const sourceItems =
    Array.isArray(order.cart_items) && order.cart_items.length
      ? order.cart_items
      : [
          {
            id: `order-${order.order_number}`,
            name: `Заказ Bulka №${order.order_number}`,
            quantity: 1,
            price: order.amount,
          },
        ];
  return sourceItems.slice(0, 50).map((item, index) => {
    const quantity = Math.min(99, Math.max(1, Math.round(Number(item.quantity) || 1)));
    const size = {
      length: Number(item.deliveryLengthM || item.lengthM) || config.defaultItem.length,
      width: Number(item.deliveryWidthM || item.widthM) || config.defaultItem.width,
      height: Number(item.deliveryHeightM || item.heightM) || config.defaultItem.height,
    };
    const base = {
      size,
      weight: Number(item.deliveryWeightKg || item.weightKg) || config.defaultItem.weight,
      quantity,
      pickup_point: 1,
      ...(quote ? { dropoff_point: 2 } : { droppof_point: 2 }),
    };
    if (quote) return base;
    return {
      extra_id: boundedString(
        item.id || item.productId || item.lineKey || `item-${index + 1}`,
        128,
      ),
      ...base,
      title: boundedString(item.name || item.title || `Позиция ${index + 1}`, 200),
      cost_value: money(item.price),
      cost_currency: 'KZT',
      age_restricted: false,
    };
  });
}

function validateDeliveryOrder(order, config = getConfig()) {
  if (!order) throw deliveryError('Заказ не найден', 404, 'ORDER_NOT_FOUND');
  if (order.status !== 'paid')
    throw deliveryError('Вызвать курьера можно только для оплаченного заказа', 409);
  if (['completed', 'cancelled'].includes(String(order.fulfillment_status || ''))) {
    throw deliveryError(
      'Нельзя вызвать курьера для закрытого или отменённого заказа',
      409,
      'DELIVERY_ORDER_CLOSED',
    );
  }
  if (['processing', 'unknown', 'succeeded'].includes(String(order.refund_status || ''))) {
    throw deliveryError(
      'Нельзя вызвать курьера во время или после возврата оплаты',
      409,
      'DELIVERY_ORDER_REFUND_ACTIVE',
    );
  }
  if (!isDeliveryFulfillment(order)) throw deliveryError('Заказ не относится к доставке', 409);
  if (order.courier_id) throw deliveryError('На заказ уже назначен курьер Bulka', 409);
  const branch = order.bulka_locations || {};
  const branchCity = boundedString(branch.city, 100);
  if (!branchCity || !normalizeCity(branchCity)) {
    throw deliveryError(
      'У филиала не указан город. Курьер не вызван; укажите город точки.',
      422,
      'BRANCH_CITY_REQUIRED',
    );
  }
  if (
    finiteCoordinate(branch.latitude, -90, 90) == null ||
    finiteCoordinate(branch.longitude, -180, 180) == null
  ) {
    throw deliveryError('У филиала не заполнены координаты', 422, 'BRANCH_COORDINATES_REQUIRED');
  }
  if (
    finiteCoordinate(order.delivery_latitude, -90, 90) == null ||
    finiteCoordinate(order.delivery_longitude, -180, 180) == null
  ) {
    throw deliveryError(
      'У заказа не заполнены координаты доставки',
      422,
      'DELIVERY_COORDINATES_REQUIRED',
    );
  }
  const customerPhone = normalizeKazakhstanPhone(
    order.customers?.phone || order.phone || order.additional_phone,
  );
  if (!customerPhone)
    throw deliveryError(
      'У клиента не найден зарегистрированный телефон приложения. Курьер не вызван.',
      422,
      'CUSTOMER_PHONE_REQUIRED',
    );
  const destination = destinationAddress(order);
  if (!destination.city || !normalizeCity(destination.city)) {
    throw deliveryError(
      'В сохранённом адресе клиента не указан город. Курьер не вызван; выберите адрес с городом.',
      422,
      'DELIVERY_CITY_REQUIRED',
    );
  }
  if (normalizeCity(branchCity) !== normalizeCity(destination.city)) {
    throw deliveryError(
      `Курьер не вызван: филиал «${branchCity}», а адрес клиента указан в городе «${destination.city}». Выберите адрес в городе филиала.`,
      422,
      'DELIVERY_CITY_MISMATCH',
      { branchCity, destinationCity: destination.city },
    );
  }
  if (!destination.address || !destination.fullname)
    throw deliveryError(
      'В сохранённом адресе клиента не указан полный адрес. Курьер не вызван.',
      422,
      'DELIVERY_ADDRESS_REQUIRED',
    );
  if (!config.senderPhone) throw deliveryError('Не заполнен телефон пекарни для курьера', 503);
  return { branch, branchCity, customerPhone, destination };
}

function buildQuotePayload(order, config = getConfig()) {
  const { branch, destination } = validateDeliveryOrder(order, config);
  return {
    items: cargoItems(order, config, { quote: true }),
    route_points: [
      {
        id: 1,
        coordinates: [Number(branch.longitude), Number(branch.latitude)],
        fullname: [branch.city, branch.address].filter(Boolean).join(', '),
      },
      {
        id: 2,
        coordinates: [Number(order.delivery_longitude), Number(order.delivery_latitude)],
        fullname: destination.fullname,
      },
    ],
    requirements: {
      taxi_class: config.taxiClass,
      pro_courier: false,
      assign_robot: false,
      cargo_options: requiredCargoOptions(config),
    },
    skip_door_to_door: false,
  };
}

function buildClaimPayload(order, config = getConfig()) {
  const { branch, customerPhone, destination } = validateDeliveryOrder(order, config);
  const sourceName = boundedString(
    `${config.senderName}${branch.name ? ` · ${branch.name}` : ''}`,
    160,
  );
  const customerName = boundedString(
    order.customers?.name || `Клиент заказа №${order.order_number}`,
    160,
  );
  const comment = boundedString(
    [destination.comment, order.comment].filter(Boolean).join('. '),
    500,
  );
  const itemSummary = orderItemsSummary(order);
  const pickupComment = boundedString(
    [
      `Забрать в Bulka «${branch.name || order.branch_name || 'точка выдачи'}»`,
      `заказ №${order.order_number}`,
      itemSummary ? `состав: ${itemSummary}` : '',
      'Только автокурьер. Термосумка обязательна.',
    ]
      .filter(Boolean)
      .join('. '),
    500,
  );
  return {
    items: cargoItems(order, config),
    route_points: [
      {
        point_id: 1,
        visit_order: 1,
        contact: { name: sourceName, phone: config.senderPhone },
        address: {
          fullname: [branch.city, branch.address].filter(Boolean).join(', '),
          coordinates: [Number(branch.longitude), Number(branch.latitude)],
          country: config.country,
          city: boundedString(branch.city, 100),
          comment: pickupComment,
        },
        skip_confirmation: config.skipConfirmation,
        type: 'source',
        external_order_id: String(order.order_number),
      },
      {
        point_id: 2,
        visit_order: 2,
        contact: { name: customerName, phone: customerPhone },
        address: {
          fullname: destination.fullname,
          coordinates: [Number(order.delivery_longitude), Number(order.delivery_latitude)],
          country: config.country,
          city: destination.city,
          ...(destination.entrance && { porch: boundedString(destination.entrance, 30) }),
          ...(destination.floor && { sfloor: boundedString(destination.floor, 20) }),
          ...(destination.apartment && { sflat: boundedString(destination.apartment, 30) }),
          ...(comment && { comment }),
        },
        skip_confirmation: config.skipConfirmation,
        type: 'destination',
        external_order_id: String(order.order_number),
        external_order_cost: {
          value: money(order.amount),
          currency: 'KZT',
          currency_sign: '₸',
        },
      },
    ],
    client_requirements: {
      taxi_class: config.taxiClass,
      pro_courier: false,
      assign_robot: false,
      cargo_options: requiredCargoOptions(config),
    },
    skip_client_notify: false,
    skip_emergency_notify: false,
    skip_door_to_door: false,
    optional_return: false,
    comment: boundedString(
      `Bulka, заказ №${order.order_number}. Забрать: ${itemSummary}. Только автомобиль, термосумка обязательна.`,
      7000,
    ),
    referral_source: 'bulka',
  };
}

async function apiRequest(path, { method = 'POST', body, query = {}, config = getConfig() } = {}) {
  assertConfigured(config, API_FAMILIES.CARGO);
  const url = new URL(`${config.baseUrl}${API_PREFIX}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Accept-Language': 'ru',
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      const message = boundedString(
        payload.message || payload.error || `HTTP ${response.status}`,
        500,
      );
      const statusCode = response.status === 429 ? 503 : response.status >= 500 ? 502 : 422;
      throw deliveryError(
        `Яндекс.Доставка: ${message}`,
        statusCode,
        boundedString(payload.code || 'YANDEX_DELIVERY_ERROR', 100),
        { providerStatus: response.status },
      );
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw deliveryError(
        'Яндекс.Доставка не ответила вовремя. Повторный запрос не создаст второго курьера.',
        504,
        'YANDEX_DELIVERY_TIMEOUT',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapYandexStatus(status, apiFamily = API_FAMILIES.CARGO) {
  if (apiFamily === API_FAMILIES.BUSINESS) return businessApi.mapBusinessStatus(status);
  if (['performer_found', 'pickup_arrived', 'ready_for_pickup_confirmation'].includes(status))
    return 'assigned';
  if (status === 'pickuped') return 'picked_up';
  if (['delivery_arrived', 'ready_for_delivery_confirmation'].includes(status)) return 'en_route';
  if (['delivered', 'delivered_finish'].includes(status)) return 'delivered';
  if (TERMINAL_STATUSES.has(status)) return 'cancelled';
  return 'unassigned';
}

function isTerminalStatus(status, apiFamily = API_FAMILIES.CARGO) {
  if (apiFamily === API_FAMILIES.BUSINESS) return businessApi.isBusinessTerminalStatus(status);
  return TERMINAL_STATUSES.has(String(status || ''));
}

function normalizeDeliveryJob(job) {
  if (!job) return null;
  const apiFamily = job.api_family || API_FAMILIES.CARGO;
  const isBusiness = apiFamily === API_FAMILIES.BUSINESS;
  const status = job.provider_status || 'draft';
  const authorizedMaximum = Number(job.authorized_max_price);
  const itemsResolutionRequired =
    status === BUSINESS_ITEMS_UNRESOLVED_STATUS ||
    Object.values(BUSINESS_ITEMS_RESOLUTION_STATUSES).includes(status);
  const createReconciliationExhausted =
    isBusiness && status === 'creating_exhausted' && !job.external_claim_id;
  const createReconciliationInProgress = Object.values(
    BUSINESS_CREATE_RESOLUTION_STATUSES,
  ).includes(status);
  const priceOverrun = job.raw_response?.priceOverrun === true;
  const car = [job.courier_car_color, job.courier_car_model, job.courier_car_number]
    .filter(Boolean)
    .join(' · ');
  const transportType = String(job.courier_transport_type || '').trim() || null;
  const hasCourierPoint = job.courier_latitude != null && job.courier_longitude != null;
  const isAutomobile =
    car ||
    ['car', 'auto', 'automobile', 'van', 'truck'].includes(
      String(transportType || '').toLowerCase(),
    )
      ? true
      : transportType
        ? false
        : null;
  return {
    id: String(job.id),
    provider: job.provider || 'yandex',
    apiFamily,
    claimId: job.external_claim_id || null,
    status,
    statusLabel:
      (isBusiness ? businessApi.BUSINESS_STATUS_LABELS[status] : STATUS_LABELS[status]) ||
      'Статус обновляется',
    deliveryStatus: job.internal_status || mapYandexStatus(status, apiFamily),
    autoAccept: job.auto_accept === true,
    // DB uniqueness and reservation guards treat every non-terminal job,
    // including draft/quoted, as active. The API must expose the same truth so
    // the UI cannot offer a conflicting internal courier assignment.
    active: !isTerminalStatus(status, apiFamily),
    quotedPrice: job.quoted_price == null ? null : Number(job.quoted_price),
    price: job.provider_price == null ? null : Number(job.provider_price),
    authorizedMaxPrice:
      Number.isFinite(authorizedMaximum) && authorizedMaximum > 0 ? authorizedMaximum : null,
    priceOverrun,
    itemsResolutionRequired,
    attentionRequired:
      itemsResolutionRequired ||
      priceOverrun ||
      createReconciliationExhausted ||
      createReconciliationInProgress,
    createReconciliationExhausted,
    createReconciliationInProgress,
    reconciliationAttempts: Number(job.reconciliation_attempts || 0),
    reconciliationRetryAt: job.reconciliation_next_at || null,
    fixedPrice:
      typeof job.raw_response?.fixedPrice === 'boolean' ? job.raw_response.fixedPrice : null,
    currency: job.currency || 'KZT',
    etaMinutes: job.eta_minutes == null ? null : Number(job.eta_minutes),
    distanceMeters: job.distance_meters == null ? null : Number(job.distance_meters),
    trackingUrl: job.tracking_url || null,
    courier:
      job.courier_name || car || transportType || hasCourierPoint
        ? {
            name: job.courier_name || 'Курьер Яндекс.Доставки',
            phone: job.courier_phone || '',
            vehicle: car || transportType || null,
            transportType,
            isAutomobile,
            latitude: job.courier_latitude == null ? null : Number(job.courier_latitude),
            longitude: job.courier_longitude == null ? null : Number(job.courier_longitude),
            locationUpdatedAt: job.courier_location_updated_at || null,
            locationAccuracy:
              job.courier_location_accuracy == null ? null : Number(job.courier_location_accuracy),
            speed: job.courier_speed == null ? null : Number(job.courier_speed),
            direction: job.courier_direction == null ? null : Number(job.courier_direction),
          }
        : null,
    automobileRequired: true,
    transportWarning:
      isAutomobile === false
        ? 'Назначен не автомобильный курьер. Передавать продукты запрещено.'
        : null,
    quoteExpiresAt: job.quote_expires_at || null,
    quoteFingerprint: job.quote_fingerprint || null,
    canCancel:
      !isTerminalStatus(status, apiFamily) &&
      status !== BUSINESS_ITEMS_UNRESOLVED_STATUS &&
      status !== 'creating_exhausted' &&
      !createReconciliationInProgress &&
      !Object.values(BUSINESS_ITEMS_RESOLUTION_STATUSES).includes(status) &&
      ((!job.external_claim_id && ['draft', 'quoted'].includes(status)) ||
        (Boolean(job.external_claim_id) &&
          (isBusiness ||
            !['pickuped', 'delivery_arrived', 'ready_for_delivery_confirmation'].includes(
              status,
            )))),
    terminal: isTerminalStatus(status, apiFamily),
    lastError: job.last_error || null,
    lastSyncedAt: job.last_synced_at || null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

async function readOrder(orderId) {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select(
      'id,order_number,status,refund_status,fulfillment_status,fulfillment_type,preorder_fulfillment_type,amount,phone,additional_phone,cart_items,comment,branch_id,branch_name,courier_id,delivery_status,delivery_address,delivery_latitude,delivery_longitude,customer_id,kitchen_status,courier_dispatch_status,courier_dispatch_provider,courier_dispatch_requested_at,customers(name,phone),bulka_locations(id,name,city,address,latitude,longitude)',
    )
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw deliveryError('Заказ не найден', 404, 'ORDER_NOT_FOUND');
  return data;
}

async function readJob(jobId) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw deliveryError('Заявка доставки не найдена', 404, 'DELIVERY_JOB_NOT_FOUND');
  return data;
}

async function listOrderJobs(orderId) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('order_id', orderId)
    .eq('provider', 'yandex')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

async function findActiveJob(orderId) {
  const jobs = await listOrderJobs(orderId);
  return (
    jobs.find(
      (job) => !isTerminalStatus(job.provider_status, job.api_family || API_FAMILIES.CARGO),
    ) || null
  );
}

async function getOrCreateJob(order, requestPayload = {}, { apiFamily = API_FAMILIES.CARGO } = {}) {
  const active = await findActiveJob(order.id);
  if (active) return active;
  const { data, error } = await supabase
    .from('delivery_jobs')
    .insert({
      order_id: order.id,
      provider: 'yandex',
      api_family: apiFamily,
      client_request_id: crypto.randomUUID(),
      provider_status: 'draft',
      internal_status: 'unassigned',
      projection_guarded: true,
      request_payload: requestPayload,
    })
    .select('*')
    .single();
  if (!error) return data;
  if (error.code === '23505') {
    const raced = await findActiveJob(order.id);
    if (raced) return raced;
  }
  if (error.code === 'P0001' || error.message?.includes('DELIVERY_PROVIDER_RESERVATION_CONFLICT')) {
    throw deliveryError(
      'Заказ уже зарезервирован внутренним курьером. Обновите список.',
      409,
      'DELIVERY_PROVIDER_CONFLICT',
    );
  }
  throw error;
}

async function updateJob(jobId, updates) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update(updates)
    .eq('id', jobId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function persistOrderProjectionIntent(job, internalStatus) {
  const projectedStatus = String(internalStatus || '');
  if (
    !['unassigned', 'assigned', 'picked_up', 'en_route', 'delivered', 'cancelled'].includes(
      projectedStatus,
    )
  ) {
    throw deliveryError(
      'Статус проекции доставки не поддерживается',
      409,
      'YANDEX_DELIVERY_PROJECTION_STATUS_INVALID',
      { deliveryJobId: job?.id },
    );
  }
  const { data, error } = await supabase.rpc('project_yandex_delivery_status', {
    p_job_id: job.id,
    p_expected_provider_status: job.provider_status,
    p_internal_status: projectedStatus,
  });
  if (error) throw error;
  const projected = Array.isArray(data) ? data[0] : data;
  if (projected?.id) return projected;
  throw deliveryError(
    'Проекция доставки не была сохранена',
    503,
    'YANDEX_DELIVERY_PROJECTION_FAILED',
    {
      deliveryJobId: job.id,
    },
  );
}

async function updateQuotedBusinessJob(jobId, updates) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update(updates)
    .eq('id', jobId)
    .eq('api_family', API_FAMILIES.BUSINESS)
    .in('provider_status', ['draft', 'quoted'])
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw deliveryError(
      'Состояние заявки изменилось во время расчёта. Обновите заказ.',
      409,
      'YANDEX_BUSINESS_QUOTE_RACE_LOST',
    );
  }
  return data;
}

async function beginBusinessCreate(jobId, authorizedMaximum, quoteFingerprint) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update({
      authorized_max_price: authorizedMaximum,
      provider_status: 'creating',
      last_error: null,
    })
    .eq('id', jobId)
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', 'quoted')
    .eq('quote_fingerprint', quoteFingerprint)
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw deliveryError(
      'Состояние заявки изменилось до вызова курьера. Обновите заказ.',
      409,
      'YANDEX_BUSINESS_CREATE_RACE_LOST',
    );
  }
  return data;
}

async function resetBusinessCreateToQuoted(jobId) {
  const { error } = await supabase
    .from('delivery_jobs')
    .update({
      authorized_max_price: null,
      provider_status: 'quoted',
      last_error: null,
      reconciliation_attempts: 0,
      reconciliation_next_at: null,
    })
    .eq('id', jobId)
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', 'creating')
    .is('external_claim_id', null);
  if (error) throw error;
}

const businessReconciliationDelaySeconds = (attempt) =>
  Math.min(30 * 2 ** Math.max(0, Math.min(Number(attempt || 1), 7) - 1), 1800);

const businessReconciliationRetryAt = (attempt, now = Date.now()) =>
  new Date(now + businessReconciliationDelaySeconds(attempt) * 1000).toISOString();

async function claimBusinessReconciliationAttempt(job) {
  const currentAttempts = Number(job.reconciliation_attempts || 0);
  if (!Number.isSafeInteger(currentAttempts) || currentAttempts < 0) {
    throw deliveryError(
      'Счётчик восстановления заявки повреждён. Автоматический повтор заблокирован.',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_STATE_INVALID',
    );
  }
  if (
    job.provider_status === 'creating_exhausted' ||
    currentAttempts >= BUSINESS_RECONCILIATION_MAX_ATTEMPTS
  ) {
    if (job.provider_status !== 'creating_exhausted') {
      await updateJob(job.id, {
        provider_status: 'creating_exhausted',
        request_payload_ciphertext: null,
        reconciliation_next_at: null,
        last_error:
          'Автоматическое восстановление исчерпано; требуется ручная проверка кабинета Яндекса',
        last_synced_at: new Date().toISOString(),
      });
    }
    throw deliveryError(
      'Автоматические попытки восстановления исчерпаны. Проверьте заказ в кабинете Яндекса вручную.',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_EXHAUSTED',
      { deliveryJobId: job.id, attemptCount: currentAttempts },
    );
  }
  const retryAt = job.reconciliation_next_at ? Date.parse(job.reconciliation_next_at) : null;
  if (Number.isFinite(retryAt) && retryAt > Date.now()) {
    throw deliveryError(
      'Повтор восстановления ещё не наступил.',
      429,
      'YANDEX_BUSINESS_RECONCILIATION_BACKOFF',
      { deliveryJobId: job.id, retryAt: job.reconciliation_next_at },
    );
  }
  const nextAttempt = currentAttempts + 1;
  const nextRetryAt = businessReconciliationRetryAt(nextAttempt);
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update({
      reconciliation_attempts: nextAttempt,
      reconciliation_next_at: nextRetryAt,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('provider', 'yandex')
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', job.provider_status)
    .eq('reconciliation_attempts', currentAttempts)
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const current = await readJob(job.id);
  if (current.provider_status === 'creating_exhausted') {
    throw deliveryError(
      'Автоматические попытки восстановления исчерпаны. Проверьте заказ в кабинете Яндекса вручную.',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_EXHAUSTED',
      { deliveryJobId: job.id, attemptCount: Number(current.reconciliation_attempts || 0) },
    );
  }
  throw deliveryError(
    'Другой процесс уже восстанавливает эту заявку.',
    409,
    'YANDEX_BUSINESS_RECONCILIATION_RACE_LOST',
    { deliveryJobId: job.id },
  );
}

async function cancelUncreatedBusinessJob(jobId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update({
      provider_status: 'cancelled',
      internal_status: 'cancelled',
      cancelled_at: now,
      request_payload_ciphertext: null,
      request_payload: {
        apiFamily: API_FAMILIES.BUSINESS,
        cancelledBeforeCreate: true,
      },
      raw_response: { cancelledBeforeCreate: true },
      authorized_max_price: null,
      quoted_price: null,
      quoted_at: null,
      quote_fingerprint: null,
      quote_expires_at: null,
      last_error: null,
    })
    .eq('id', jobId)
    .eq('api_family', API_FAMILIES.BUSINESS)
    .in('provider_status', ['draft', 'quoted'])
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw deliveryError(
      'Заявка уже начала создаваться. Обновите статус перед отменой.',
      409,
      'YANDEX_BUSINESS_CANCEL_RACE_LOST',
    );
  }
  return data;
}

async function beginCargoCreate(jobId) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update({ provider_status: 'creating', last_error: null })
    .eq('id', jobId)
    .eq('api_family', API_FAMILIES.CARGO)
    .in('provider_status', ['draft', 'quoted'])
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw deliveryError(
      'Состояние заявки изменилось до вызова курьера. Обновите заказ.',
      409,
      'YANDEX_DELIVERY_CREATE_RACE_LOST',
    );
  }
  return data;
}

async function cancelUncreatedCargoJob(jobId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update({
      provider_status: 'cancelled',
      internal_status: 'cancelled',
      cancelled_at: now,
      quoted_price: null,
      quote_expires_at: null,
      request_payload: { cancelledBeforeCreate: true },
      raw_response: { cancelledBeforeCreate: true },
      last_error: null,
      last_synced_at: now,
    })
    .eq('id', jobId)
    .eq('api_family', API_FAMILIES.CARGO)
    .in('provider_status', ['draft', 'quoted'])
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw deliveryError(
      'Заявка уже начала создаваться. Обновите статус перед отменой.',
      409,
      'YANDEX_DELIVERY_CANCEL_RACE_LOST',
    );
  }
  return data;
}

async function expireStaleBusinessQuotes({ limit = 25 } = {}) {
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('provider', 'yandex')
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', 'quoted')
    .is('external_claim_id', null)
    .lt('quote_expires_at', now)
    .order('quote_expires_at', { ascending: true })
    .limit(normalizedLimit);
  if (error) throw error;

  let expired = 0;
  let failed = 0;
  for (const candidate of data || []) {
    const expiryMessage = 'Срок расчёта Яндекс Go истёк; сохранённые данные заявки удалены';
    const { data: closed, error: closeError } = await supabase
      .from('delivery_jobs')
      .update({
        provider_status: 'cancelled',
        internal_status: 'cancelled',
        cancelled_at: now,
        request_payload_ciphertext: null,
        request_payload: {
          apiFamily: API_FAMILIES.BUSINESS,
          quoteExpired: true,
        },
        raw_response: { quoteExpired: true },
        authorized_max_price: null,
        quoted_price: null,
        quoted_at: null,
        quote_fingerprint: null,
        quote_expires_at: null,
        last_error: expiryMessage,
        last_synced_at: now,
      })
      .eq('id', candidate.id)
      .eq('api_family', API_FAMILIES.BUSINESS)
      .eq('provider_status', 'quoted')
      .eq('quote_expires_at', candidate.quote_expires_at)
      .is('external_claim_id', null)
      .select('*')
      .maybeSingle();
    if (closeError) throw closeError;
    if (!closed) continue;

    try {
      await updateOrderFromJob(closed, {});
      await updateJob(closed.id, { last_error: null, last_synced_at: now });
      expired += 1;
    } catch (projectionError) {
      await saveJobError(closed, projectionError);
      failed += 1;
    }
  }
  return { expired, failed };
}

async function expireStaleCargoQuotes({ limit = 25 } = {}) {
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('provider', 'yandex')
    .eq('api_family', API_FAMILIES.CARGO)
    .in('provider_status', ['draft', 'quoted'])
    .is('external_claim_id', null)
    .lt('quote_expires_at', now)
    .order('quote_expires_at', { ascending: true })
    .limit(normalizedLimit);
  if (error) throw error;

  let expired = 0;
  let failed = 0;
  for (const candidate of data || []) {
    try {
      const closed = await cancelUncreatedCargoJob(candidate.id);
      await updateOrderFromJob(closed, {});
      expired += 1;
    } catch (expiryError) {
      // A concurrent create/cancel owns the job now. CAS losses are expected;
      // persistence failures remain visible to the critical worker.
      if (expiryError?.code === 'YANDEX_DELIVERY_CANCEL_RACE_LOST') continue;
      await saveJobError(candidate, expiryError);
      failed += 1;
    }
  }
  return { expired, failed };
}

async function saveJobError(job, error) {
  const message = boundedString(error?.message || 'Неизвестная ошибка Яндекс.Доставки', 2000);
  return updateJob(job.id, { last_error: message, last_synced_at: new Date().toISOString() }).catch(
    () => job,
  );
}

const businessEnvelopeAad = (job) => `delivery-job:${String(job.id)}:order:${String(job.order_id)}`;

const encryptBusinessRequest = (job, payload) =>
  encryptSecret(JSON.stringify(payload), {
    purpose: 'yandex-business-delivery-request',
    aad: businessEnvelopeAad(job),
  });

const decryptBusinessRequest = (job) => {
  const raw = decryptSecret(job.request_payload_ciphertext, {
    purpose: 'yandex-business-delivery-request',
    aad: businessEnvelopeAad(job),
  });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw deliveryError(
      'Сохранённый запрос Яндекс Go повреждён. Курьер не вызван.',
      409,
      'YANDEX_BUSINESS_REQUEST_INVALID',
    );
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw deliveryError(
      'Сохранённый запрос Яндекс Go повреждён. Курьер не вызван.',
      409,
      'YANDEX_BUSINESS_REQUEST_INVALID',
    );
  }
  return payload;
};

const isUnreadableBusinessRequestError = (error) =>
  String(error?.code || '').startsWith('SECRET_ENVELOPE_') ||
  error?.code === 'YANDEX_BUSINESS_REQUEST_INVALID';

const BUSINESS_REQUEST_UNREADABLE_LAST_ERROR =
  'Защищённый запрос недоступен; автоматический повтор заблокирован, требуется ручная проверка кабинета Яндекса';

async function exhaustUnreadableBusinessCreate(job) {
  const attempts = Number(job.reconciliation_attempts || 0);
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update({
      provider_status: 'creating_exhausted',
      request_payload_ciphertext: null,
      reconciliation_next_at: null,
      last_error: BUSINESS_REQUEST_UNREADABLE_LAST_ERROR,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('provider', 'yandex')
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', job.provider_status)
    .eq('reconciliation_attempts', attempts)
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const current = await readJob(job.id);
  if (current.provider_status === 'creating_exhausted' && !current.external_claim_id) {
    return current;
  }
  throw deliveryError(
    'Состояние заявки изменилось во время блокировки автоматического повтора.',
    409,
    'YANDEX_BUSINESS_RECONCILIATION_RACE_LOST',
    { deliveryJobId: job.id },
  );
}

const businessQuoteFingerprint = (order, selected, businessConfig, createPayload) =>
  credentialHash(
    JSON.stringify({
      orderId: String(order.id),
      branchId: String(order.branch_id || ''),
      clientId: businessConfig.clientId,
      userId: businessConfig.userId,
      className: selected.className,
      price: selected.price,
      currency: selected.currency,
      createPayload,
    }),
    'yandex-business-quote',
  );

async function quoteBusinessOrder(order, config) {
  assertConfigured(config, API_FAMILIES.BUSINESS);
  validateDeliveryOrder(order, config);
  const existing = await findActiveJob(order.id);
  if (existing) {
    if ((existing.api_family || API_FAMILIES.CARGO) !== API_FAMILIES.BUSINESS) {
      throw deliveryError(
        'У заказа уже есть активная заявка другого типа',
        409,
        'YANDEX_DELIVERY_ALREADY_ACTIVE',
      );
    }
    if (existing.external_claim_id || !['draft', 'quoted'].includes(existing.provider_status)) {
      throw deliveryError(
        ['creating', 'creating_uncertain'].includes(existing.provider_status)
          ? 'Предыдущий вызов мог создать курьера. Повторите синхронизацию с тем же UUID.'
          : 'Курьер уже вызван. Обновите статус существующей заявки.',
        409,
        'YANDEX_BUSINESS_ALREADY_DISPATCHED',
      );
    }
  }
  const client = businessApi.createBusinessApiClient(config.business);
  const origin = businessApi.buildBusinessRoute(order, config.business)[0];
  const zone = await client.getZoneInfo(origin);
  const zoneTariffs = Array.isArray(zone?.tariff_classes) ? zone.tariff_classes : [];
  const zoneTariff = config.business.preferredClasses
    .map((className) => zoneTariffs.find((candidate) => candidate?.name === className))
    .find(Boolean);
  if (!zoneTariff) {
    throw deliveryError(
      'В этой зоне Яндекс Go не разрешил тариф express/courier для вашего кабинета',
      409,
      'YANDEX_BUSINESS_TARIFF_UNAVAILABLE',
    );
  }
  const supportedRequirements = businessApi.filterSupportedRequirements(
    config.business.requirements,
    zoneTariff,
    zoneTariff.name,
  );
  const missingRequired = Object.keys(config.business.requirements).filter(
    (requirement) => !Object.hasOwn(supportedRequirements, requirement),
  );
  if (missingRequired.length) {
    throw deliveryError(
      `Тариф не поддерживает обязательные опции: ${missingRequired.join(', ')}`,
      409,
      'YANDEX_BUSINESS_REQUIREMENTS_UNAVAILABLE',
      { missingRequirements: missingRequired },
    );
  }
  const routePayload = businessApi.buildBusinessQuotePayload(
    order,
    config.business,
    supportedRequirements,
  );
  const routeStats = await client.getRouteStats(routePayload);
  const selected = businessApi.selectBusinessQuote(zone, routeStats, {
    ...config.business,
    preferredClasses: [zoneTariff.name],
  });
  if (!selected) {
    throw deliveryError(
      'Для этой точки и маршрута Яндекс Go не вернул тариф express/courier',
      409,
      'YANDEX_BUSINESS_TARIFF_UNAVAILABLE',
    );
  }
  if (!selected.offer || selected.isFixedPrice !== true || selected.price == null) {
    throw deliveryError(
      'Яндекс Go не вернул фиксированную цену. Курьер не будет вызван.',
      409,
      'YANDEX_BUSINESS_FIXED_PRICE_REQUIRED',
    );
  }
  if (String(selected.currency || '').toUpperCase() !== 'KZT') {
    throw deliveryError(
      'Яндекс Go вернул цену не в тенге. Курьер не будет вызван.',
      409,
      'YANDEX_BUSINESS_CURRENCY_UNSUPPORTED',
      { currency: selected.currency || null },
    );
  }
  if (selected.price > config.business.maxPriceKzt) {
    throw deliveryError(
      `Стоимость ${selected.price} ₸ превышает серверный лимит ${config.business.maxPriceKzt} ₸`,
      409,
      'YANDEX_BUSINESS_PRICE_LIMIT_EXCEEDED',
      { quotedPrice: selected.price, maximumPrice: config.business.maxPriceKzt },
    );
  }
  let job = await getOrCreateJob(
    order,
    { apiFamily: API_FAMILIES.BUSINESS },
    { apiFamily: API_FAMILIES.BUSINESS },
  );
  if ((job.api_family || API_FAMILIES.CARGO) !== API_FAMILIES.BUSINESS) {
    throw deliveryError(
      'У заказа уже есть активная заявка другого типа',
      409,
      'YANDEX_DELIVERY_ALREADY_ACTIVE',
    );
  }
  const createPayload = businessApi.buildBusinessCreatePayload(order, config.business, {
    offer: selected.offer,
    requirements: selected.requirements,
    className: selected.className,
  });
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.business.quoteMaxAgeSeconds * 1000,
  ).toISOString();
  const fingerprint = businessQuoteFingerprint(order, selected, config.business, createPayload);
  job = await updateQuotedBusinessJob(job.id, {
    api_family: API_FAMILIES.BUSINESS,
    provider_status: 'quoted',
    internal_status: 'unassigned',
    quoted_price: selected.price,
    currency: selected.currency || 'KZT',
    quote_expires_at: expiresAt,
    quoted_at: now.toISOString(),
    quote_fingerprint: fingerprint,
    external_client_id: config.business.clientId,
    external_user_id: config.business.userId,
    request_payload: {
      apiFamily: API_FAMILIES.BUSINESS,
      className: selected.className,
      fixedPrice: true,
      quoteFingerprint: fingerprint,
    },
    request_payload_ciphertext: encryptBusinessRequest(job, createPayload),
    raw_response: {
      fixedPrice: true,
      className: selected.className,
      currency: selected.currency || 'KZT',
      estimatedWaitingSeconds:
        selected.serviceLevel?.estimated_waiting?.seconds == null
          ? null
          : Number(selected.serviceLevel.estimated_waiting.seconds),
    },
    reconciliation_attempts: 0,
    reconciliation_next_at: null,
    last_error: null,
    last_synced_at: now.toISOString(),
  });
  return normalizeDeliveryJob(job);
}

async function quoteOrder(orderId) {
  const config = getConfig();
  const order = await readOrder(orderId);
  const existing = await findActiveJob(order.id);
  const apiFamily = existing?.api_family || config.apiMode;
  assertConfigured(config, apiFamily);
  if (apiFamily === API_FAMILIES.BUSINESS) return quoteBusinessOrder(order, config);
  const payload = buildQuotePayload(order, config);
  let job = await getOrCreateJob(order, payload);
  if (job.external_claim_id) return normalizeDeliveryJob(job);
  if (
    job.provider_status === 'quoted' &&
    job.quote_expires_at &&
    new Date(job.quote_expires_at).getTime() > Date.now() + 30000
  )
    return normalizeDeliveryJob(job);
  try {
    const result = await apiRequest('/check-price', { body: payload, config });
    job = await updateJob(job.id, {
      provider_status: 'quoted',
      quoted_price: Number(result.price || 0),
      currency: result.currency_rules?.code || 'KZT',
      eta_minutes: result.eta == null ? null : Math.max(0, Math.round(Number(result.eta))),
      distance_meters:
        result.distance_meters == null
          ? null
          : Math.max(0, Math.round(Number(result.distance_meters))),
      quote_expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      request_payload: payload,
      raw_response: result,
      last_error: null,
      last_synced_at: new Date().toISOString(),
    });
    return normalizeDeliveryJob(job);
  } catch (error) {
    await saveJobError(job, error);
    throw error;
  }
}

const expectedDestinationAt = (info) => {
  const point = Array.isArray(info?.route_points)
    ? info.route_points.find((candidate) => candidate.type === 'destination')
    : null;
  return point?.visited_at?.expected || point?.expected_visit_interval?.to || null;
};

async function updateOrderFromJob(job, info) {
  const { data: current, error: readError } = await supabase
    .from('kaspi_orders')
    .select(
      'id,order_number,customer_id,branch_id,fulfillment_status,delivery_status,courier_id,courier_assigned_at,handed_to_courier_at,out_for_delivery_at,delivered_at',
    )
    .eq('id', job.order_id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return;
  const now = new Date().toISOString();
  const internal = job.internal_status || mapYandexStatus(job.provider_status);
  if (current.courier_id) {
    if (internal === 'cancelled') return;
    throw deliveryError(
      'На заказ одновременно назначен курьер Bulka и активна заявка Яндекса. Автоматическое обновление остановлено.',
      409,
      'DELIVERY_PROVIDER_CONFLICT',
    );
  }
  const orderStatus = internal === 'cancelled' ? 'unassigned' : internal;
  const updates = { delivery_status: orderStatus };
  const expectedAt = expectedDestinationAt(info);
  if (expectedAt) updates.estimated_delivery_at = expectedAt;
  else if (job.eta_minutes && !current.delivered_at) {
    updates.estimated_delivery_at = new Date(
      Date.now() + Number(job.eta_minutes) * 60000,
    ).toISOString();
  }
  if (
    ['assigned', 'picked_up', 'en_route', 'delivered'].includes(internal) &&
    !current.courier_assigned_at
  ) {
    updates.courier_assigned_at = now;
  }
  if (['picked_up', 'en_route', 'delivered'].includes(internal) && !current.handed_to_courier_at) {
    updates.handed_to_courier_at = now;
  }
  if (['en_route', 'delivered'].includes(internal) && !current.out_for_delivery_at)
    updates.out_for_delivery_at = now;
  if (internal === 'delivered' && !current.delivered_at) updates.delivered_at = now;
  if (internal === 'cancelled') {
    updates.courier_dispatch_status = 'failed';
    updates.courier_dispatch_provider = 'yandex';
    updates.courier_dispatch_completed_at = null;
    updates.courier_dispatch_next_attempt_at = null;
    updates.courier_dispatch_error = boundedString(
      `Яндекс завершил заявку со статусом ${job.provider_status || 'cancelled'}`,
      500,
    );
  }
  const { data: updatedOrder, error } = await supabase
    .from('kaspi_orders')
    .update(updates)
    .eq('id', job.order_id)
    .is('courier_id', null)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!updatedOrder) {
    if (internal === 'cancelled') return;
    throw deliveryError(
      'Назначение курьера изменилось во время синхронизации. Автоматическое обновление остановлено.',
      409,
      'DELIVERY_PROVIDER_CONFLICT',
    );
  }

  if (
    internal === 'delivered' &&
    !['completed', 'cancelled'].includes(current.fulfillment_status)
  ) {
    const { updateAdminOrderStatus } = require('./customer-order.service');
    await updateAdminOrderStatus(job.order_id, 'completed');
  }
  const event = {
    orderId: job.order_id,
    orderNumber: current.order_number,
    deliveryStatus: orderStatus,
    provider: 'yandex',
    providerStatus: job.provider_status,
  };
  realtime.publish('delivery.updated', event, {
    customerId: current.customer_id,
    includeAdmins: true,
    branchId: current.branch_id,
  });
  realtime.publish('order.updated', event, {
    adminOnly: true,
    branchId: current.branch_id,
  });
}

async function markOrderExternalDispatchActive(orderId) {
  const { error } = await supabase
    .from('kaspi_orders')
    .update({
      courier_dispatch_status: 'succeeded',
      courier_dispatch_provider: 'yandex',
      courier_dispatch_completed_at: new Date().toISOString(),
      courier_dispatch_next_attempt_at: null,
      courier_dispatch_error: null,
    })
    .eq('id', orderId)
    .is('courier_id', null)
    .or(
      'courier_dispatch_status.is.null,courier_dispatch_status.in.(pending,processing,retrying,awaiting_confirmation,succeeded,failed)',
    );
  if (error) throw error;
}

async function supplementaryCourierData(info, job, config) {
  if (!COURIER_VISIBLE_STATUSES.has(info.status)) return {};
  const updates = {};
  try {
    const position = await apiRequest('/claims/performer-position', {
      method: 'GET',
      query: { claim_id: job.external_claim_id },
      config,
    });
    const point = position?.position;
    const latitude = Number(point?.lat);
    const longitude = Number(point?.lon);
    if (
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      const timestamp = Number(point?.timestamp);
      const locationUpdatedAt =
        Number.isFinite(timestamp) && timestamp > 0
          ? new Date(timestamp * 1000).toISOString()
          : new Date().toISOString();
      const currentLocationTime = Date.parse(job.courier_location_updated_at || '');
      const nextLocationTime = Date.parse(locationUpdatedAt);
      if (
        !Number.isFinite(currentLocationTime) ||
        !Number.isFinite(nextLocationTime) ||
        nextLocationTime >= currentLocationTime
      ) {
        updates.courier_latitude = latitude;
        updates.courier_longitude = longitude;
        updates.courier_location_updated_at = locationUpdatedAt;
        if (Number.isFinite(Number(point?.accuracy)) && Number(point.accuracy) >= 0) {
          updates.courier_location_accuracy = Number(point.accuracy);
        }
        if (Number.isFinite(Number(point?.speed)) && Number(point.speed) >= 0) {
          updates.courier_speed = Number(point.speed);
        }
        if (Number.isFinite(Number(point?.direction)) && Number(point.direction) >= 0) {
          updates.courier_direction = Math.min(360, Number(point.direction));
        }
      }
    }
  } catch (error) {
    // A position is an enhancement, not a reason to lose the authoritative
    // claim status. Yandex returns 404/409 until a performer is assigned and
    // may throttle this optional endpoint; keep the last known point then.
    if (![404, 409, 422, 429].includes(error.statusCode)) throw error;
  }
  if (!job.tracking_url) {
    try {
      const links = await apiRequest('/claims/tracking-links', {
        method: 'GET',
        query: { claim_id: job.external_claim_id },
        config,
      });
      updates.tracking_url =
        links.route_points?.find((point) => point.type === 'destination')?.sharing_link || null;
    } catch (error) {
      if (![404, 409, 422].includes(error.statusCode)) throw error;
    }
  }
  if (!job.courier_phone) {
    const sourcePoint = info.route_points?.find((point) => point.type === 'source');
    if (sourcePoint?.id != null) {
      try {
        const phone = await apiRequest('/driver-voiceforwarding', {
          body: { claim_id: job.external_claim_id, point_id: sourcePoint.id },
          config,
        });
        const courierPhone = boundedString(phone.phone, 20);
        const phoneExtension = boundedString(phone.ext, 12).replace(/[^0-9#*]/g, '');
        updates.courier_phone = courierPhone
          ? boundedString(`${courierPhone}${phoneExtension ? `,${phoneExtension}` : ''}`, 32)
          : null;
      } catch (error) {
        if (![404, 409, 422].includes(error.statusCode)) throw error;
      }
    }
  }
  return updates;
}

const businessItemsInternalStatus = (job) =>
  ['picked_up', 'en_route'].includes(String(job?.internal_status))
    ? String(job.internal_status)
    : 'picked_up';

const businessItemsUnresolvedError = (reportedStatus) =>
  `Яндекс сообщил статус ${boundedString(
    reportedStatus,
    80,
  )} после получения заказа курьером либо при невозможности надёжно исключить передачу. Укажите вручную: заказ возвращён или доставлен`;

const businessPriceOverrunError = (actual, authorized) =>
  `Фактическая стоимость ${actual} ₸ превысила подтверждённый лимит ${authorized} ₸; требуется проверка`;

const retainedBusinessPriceOverrunError = (job) => {
  if (job?.raw_response?.priceOverrun !== true) return null;
  const actual = Number(job.raw_response?.priceOverrunAmount ?? job.provider_price);
  const authorized = Number(job.authorized_max_price);
  return Number.isFinite(actual) && Number.isFinite(authorized)
    ? businessPriceOverrunError(actual, authorized)
    : 'Зафиксировано превышение подтверждённого лимита стоимости; требуется проверка';
};

async function hasBusinessItemsHandoffEvidence(job, reportedStatus) {
  if (job?.provider_status === BUSINESS_ITEMS_UNRESOLVED_STATUS) return true;
  if (Object.values(BUSINESS_ITEMS_RESOLUTION_STATUSES).includes(job?.provider_status)) return true;
  if (job?.picked_up_at) return true;
  if (['picked_up', 'en_route'].includes(String(job?.internal_status))) return true;
  if (['waiting', 'transporting'].includes(String(job?.provider_status))) return true;
  if (!BUSINESS_POST_PICKUP_FAILURES.has(String(reportedStatus))) return false;
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id,handed_to_courier_at,delivery_status')
    .eq('id', job.order_id)
    .maybeSingle();
  if (error) throw error;
  return (
    Boolean(data?.handed_to_courier_at) ||
    ['picked_up', 'en_route'].includes(String(data?.delivery_status))
  );
}

async function preservePostPickupBusinessItems(job, reportedStatus) {
  const now = new Date().toISOString();
  const updates = {
    provider_status: BUSINESS_ITEMS_UNRESOLVED_STATUS,
    internal_status: businessItemsInternalStatus(job),
    cancelled_at: job.cancelled_at || null,
    raw_response: {
      ...safeRawResponse(job.raw_response),
      providerReportedStatus: boundedString(reportedStatus, 80),
      itemsResolution: { status: 'pending' },
    },
    last_error: businessItemsUnresolvedError(reportedStatus),
    last_synced_at: now,
  };
  const updated = await updateJob(job.id, updates);
  await markOrderExternalDispatchActive(updated.order_id);
  await updateOrderFromJob(updated, {});
  return updated;
}

async function syncBusinessDeliveryJob(job, config) {
  assertConfigured(config, API_FAMILIES.BUSINESS);
  if (!job?.external_claim_id) return normalizeDeliveryJob(job);
  if (Object.values(BUSINESS_ITEMS_RESOLUTION_STATUSES).includes(job.provider_status)) {
    const resolutionIntent = job.raw_response?.itemsResolution || {};
    const pendingResolution = resolutionIntent.resolution;
    if (!['returned', 'delivered'].includes(pendingResolution)) {
      throw deliveryError(
        'Незавершённое ручное решение не содержит результата. Требуется проверка владельца.',
        409,
        'YANDEX_BUSINESS_ITEMS_RESOLUTION_CORRUPT',
        { deliveryJobId: job.id },
      );
    }
    return resolveBusinessDeliveryItems(job.order_id, {
      deliveryJobId: job.id,
      resolution: pendingResolution,
      reason:
        resolutionIntent.reason ||
        'Автоматическое продолжение ранее подтверждённого ручного решения',
      actor: resolutionIntent.actor || 'system-recovery',
      requestId: resolutionIntent.requestId || null,
    });
  }
  if (isTerminalStatus(job.provider_status, API_FAMILIES.BUSINESS)) {
    if (
      BUSINESS_POST_PICKUP_FAILURES.has(job.provider_status) &&
      (await hasBusinessItemsHandoffEvidence(job, job.provider_status))
    ) {
      job = await preservePostPickupBusinessItems(job, job.provider_status);
      return normalizeDeliveryJob(job);
    }
    await updateOrderFromJob(job, {});
    if (job.last_error && job.raw_response?.priceOverrun !== true) {
      job = await updateJob(job.id, {
        last_error: null,
        last_synced_at: new Date().toISOString(),
      });
    }
    return normalizeDeliveryJob(job);
  }
  const client = businessApi.createBusinessApiClient({
    ...config.business,
    clientId: job.external_client_id || config.business.clientId,
    userId: job.external_user_id || config.business.userId,
  });
  try {
    const [infoResult, progressResult] = await Promise.allSettled([
      client.getOrderInfo(job.external_claim_id),
      client.getOrderProgress(job.external_claim_id),
    ]);
    if (infoResult.status === 'rejected') throw infoResult.reason;
    const normalized = businessApi.normalizeBusinessInfo(infoResult.value);
    if (
      !normalized ||
      normalized.externalOrderId !== String(job.external_claim_id) ||
      normalized.userId !== String(job.external_user_id || config.business.userId)
    ) {
      throw deliveryError(
        'Ответ Яндекса не соответствует сохранённому заказу или сотруднику. Автоматическое обновление остановлено.',
        409,
        'YANDEX_BUSINESS_ORDER_IDENTITY_MISMATCH',
        { deliveryJobId: job.id },
      );
    }
    const progress =
      progressResult.status === 'fulfilled'
        ? businessApi.normalizeBusinessOrderProgress(progressResult.value)
        : null;
    const providerStatus = normalized?.providerStatus || progress?.providerStatus;
    if (!providerStatus) {
      throw deliveryError(
        'Яндекс Go вернул ответ без статуса заказа',
        502,
        'YANDEX_BUSINESS_STATUS_MISSING',
      );
    }
    const vehicle = normalized?.courier?.vehicle || {};
    const vehicleText = [vehicle.color, vehicle.model, vehicle.number].filter(Boolean).join(' · ');
    const hasVehicle = Boolean(vehicleText);
    const mappedInternalStatus =
      providerStatus === 'scheduled' && !hasVehicle
        ? 'unassigned'
        : businessApi.mapBusinessStatus(providerStatus);
    const now = new Date().toISOString();
    const alreadyUnresolved = job.provider_status === BUSINESS_ITEMS_UNRESOLVED_STATUS;
    const postPickupUnresolved =
      alreadyUnresolved ||
      (BUSINESS_POST_PICKUP_FAILURES.has(providerStatus) &&
        (await hasBusinessItemsHandoffEvidence(job, providerStatus)));
    const effectiveProviderStatus = postPickupUnresolved
      ? BUSINESS_ITEMS_UNRESOLVED_STATUS
      : providerStatus;
    const internalStatus = postPickupUnresolved
      ? businessItemsInternalStatus(job)
      : mappedInternalStatus;
    const billedPrice = normalized?.priceWithVat ?? normalized?.price;
    const providerPrice = billedPrice == null ? job.provider_price : Number(billedPrice);
    const authorizedMaximum = Number(job.authorized_max_price);
    const currentPriceOverrun =
      Number.isFinite(Number(providerPrice)) &&
      Number.isFinite(authorizedMaximum) &&
      authorizedMaximum > 0 &&
      Number(providerPrice) > authorizedMaximum;
    const priceOverrun = job.raw_response?.priceOverrun === true || currentPriceOverrun;
    const priorOverrunAmount = Number(job.raw_response?.priceOverrunAmount ?? job.provider_price);
    const priceOverrunAmount = currentPriceOverrun
      ? Number(providerPrice)
      : Number.isFinite(priorOverrunAmount)
        ? priorOverrunAmount
        : Number(providerPrice);
    const syncError = postPickupUnresolved
      ? businessItemsUnresolvedError(providerStatus)
      : !businessApi.isBusinessKnownStatus(providerStatus)
        ? `Яндекс вернул неизвестный статус ${boundedString(providerStatus, 80)}; автоматическое освобождение заказа запрещено`
        : providerStatus === 'expired'
          ? 'Яндекс вернул неопределённый статус expired; автоматическое освобождение заказа запрещено'
          : priceOverrun
            ? businessPriceOverrunError(priceOverrunAmount, authorizedMaximum)
            : null;
    const updates = {
      provider_status: effectiveProviderStatus,
      internal_status: internalStatus,
      provider_price: providerPrice,
      eta_minutes:
        progress?.timeLeftSeconds == null
          ? job.eta_minutes
          : Math.max(0, Math.ceil(progress.timeLeftSeconds / 60)),
      courier_name: normalized?.courier?.name || null,
      courier_phone: normalized?.courier?.phone || null,
      courier_transport_type: hasVehicle ? 'car' : null,
      courier_car_model: vehicle.model || null,
      courier_car_number: vehicle.number || null,
      courier_car_color: vehicle.color || null,
      accepted_at: ['driving', 'waiting', 'transporting', 'complete', 'finished'].includes(
        providerStatus,
      )
        ? job.accepted_at || now
        : job.accepted_at,
      picked_up_at: ['transporting', 'complete', 'finished'].includes(providerStatus)
        ? job.picked_up_at || now
        : job.picked_up_at,
      delivered_at:
        !postPickupUnresolved && ['complete', 'finished'].includes(providerStatus)
          ? job.delivered_at || now
          : job.delivered_at,
      cancelled_at:
        !postPickupUnresolved && ['cancelled', 'failed'].includes(providerStatus)
          ? job.cancelled_at || now
          : job.cancelled_at,
      raw_response: {
        ...safeRawResponse(job.raw_response),
        fixedPrice: job.raw_response?.fixedPrice === true,
        className: job.raw_response?.className || null,
        ...(postPickupUnresolved && {
          providerReportedStatus: providerStatus,
          itemsResolution: { status: 'pending' },
        }),
        priceOverrun,
        ...(priceOverrun && { priceOverrunAmount }),
        cancelRules: normalized?.cancelRules
          ? {
              canCancel: normalized.cancelRules.canCancel === true,
              state: normalized.cancelRules.state || null,
              requiresPaymentConfirmation:
                normalized.cancelRules.requiresPaymentConfirmation === true,
            }
          : null,
        billedPriceExVat: normalized?.price ?? null,
        billedPriceWithVat: normalized?.priceWithVat ?? null,
        progress: progress
          ? {
              status: progress.providerStatus,
              timeLeftSeconds: progress.timeLeftSeconds,
            }
          : null,
      },
      last_error: syncError,
      last_synced_at: now,
    };
    if (businessApi.isBusinessTerminalStatus(effectiveProviderStatus)) {
      // Publish the exact order projection while the job still owns the active
      // reservation. The DB order guard rejects every incompatible manual
      // delivery_status mutation and a crash remains retryable.
      const projectionJob = await persistOrderProjectionIntent(job, internalStatus);
      await updateOrderFromJob({ ...projectionJob, ...updates }, infoResult.value);
      job = await updateJob(job.id, updates);
    } else {
      const projectionJob = await persistOrderProjectionIntent(job, internalStatus);
      job = await updateJob(job.id, { ...updates, internal_status: projectionJob.internal_status });
      await markOrderExternalDispatchActive(job.order_id);
      await updateOrderFromJob(job, infoResult.value);
    }
    return normalizeDeliveryJob(job);
  } catch (error) {
    await saveJobError(job, error);
    throw error;
  }
}

async function compareAndSetBusinessItemsStatus(jobId, expectedStatus, updates) {
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update(updates)
    .eq('id', jobId)
    .eq('provider', 'yandex')
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', expectedStatus)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

const hasExactBusinessItemsResolution = (job, resolution) =>
  job?.raw_response?.itemsResolution?.status === resolution &&
  ((resolution === 'returned' && job.provider_status === 'cancelled') ||
    (resolution === 'delivered' && job.provider_status === 'complete'));

async function resolveBusinessDeliveryItems(
  orderId,
  { deliveryJobId, resolution, reason, actor, requestId } = {},
) {
  if (!['returned', 'delivered'].includes(String(resolution))) {
    throw deliveryError(
      'Укажите точный результат: заказ возвращён или доставлен',
      422,
      'YANDEX_BUSINESS_ITEMS_RESOLUTION_INVALID',
    );
  }
  const requestedReason = boundedString(reason, 240);
  if (!requestedReason) {
    throw deliveryError(
      'Укажите причину ручного решения',
      422,
      'YANDEX_BUSINESS_ITEMS_RESOLUTION_REASON_REQUIRED',
    );
  }
  let job = await readJob(deliveryJobId);
  if (
    String(job.order_id) !== String(orderId) ||
    job.provider !== 'yandex' ||
    (job.api_family || API_FAMILIES.CARGO) !== API_FAMILIES.BUSINESS
  ) {
    throw deliveryError('Заявка доставки не найдена', 404, 'DELIVERY_JOB_NOT_FOUND');
  }
  if (hasExactBusinessItemsResolution(job, resolution)) return normalizeDeliveryJob(job);
  const resolvingStatus = BUSINESS_ITEMS_RESOLUTION_STATUSES[resolution];
  if (
    !job.external_claim_id ||
    ![
      BUSINESS_ITEMS_UNRESOLVED_STATUS,
      ...Object.values(BUSINESS_ITEMS_RESOLUTION_STATUSES),
    ].includes(job.provider_status)
  ) {
    throw deliveryError(
      'Ручное решение доступно только после передачи заказа курьеру',
      409,
      'YANDEX_BUSINESS_ITEMS_RESOLUTION_UNAVAILABLE',
    );
  }

  if (job.provider_status === BUSINESS_ITEMS_UNRESOLVED_STATUS) {
    const claimedAt = new Date().toISOString();
    const resolutionIntent = {
      status: 'resolving',
      resolution,
      reason: requestedReason,
      actor: boundedString(actor, 160) || 'unknown-admin',
      requestId: boundedString(requestId, 128) || null,
      requestedAt: claimedAt,
    };
    const claimed = await compareAndSetBusinessItemsStatus(
      job.id,
      BUSINESS_ITEMS_UNRESOLVED_STATUS,
      {
        provider_status: resolvingStatus,
        raw_response: {
          ...safeRawResponse(job.raw_response),
          itemsResolution: resolutionIntent,
        },
        last_error: `Ручное решение «${resolution}» ожидает завершения проекции заказа`,
        last_synced_at: claimedAt,
      },
    );
    if (claimed) job = claimed;
    else job = await readJob(job.id);
  }
  if (job.provider_status !== resolvingStatus) {
    if (hasExactBusinessItemsResolution(job, resolution)) return normalizeDeliveryJob(job);
    throw deliveryError(
      'Состояние заявки изменилось. Обновите заказ перед ручным решением.',
      409,
      'YANDEX_BUSINESS_ITEMS_RESOLUTION_RACE_LOST',
      { deliveryJobId: job.id },
    );
  }

  const now = new Date().toISOString();
  const isDelivered = resolution === 'delivered';
  const finalProviderStatus = isDelivered ? 'complete' : 'cancelled';
  const finalInternalStatus = isDelivered ? 'delivered' : 'cancelled';
  const overrunError = retainedBusinessPriceOverrunError(job);
  const persistedResolutionIntent = job.raw_response?.itemsResolution || {};
  const finalUpdates = {
    provider_status: finalProviderStatus,
    internal_status: finalInternalStatus,
    delivered_at: isDelivered ? job.delivered_at || now : job.delivered_at,
    cancelled_at: isDelivered ? job.cancelled_at : job.cancelled_at || now,
    raw_response: {
      ...safeRawResponse(job.raw_response),
      itemsResolution: {
        ...persistedResolutionIntent,
        status: resolution,
        resolution,
        reason: boundedString(persistedResolutionIntent.reason || requestedReason, 240),
        actor: boundedString(persistedResolutionIntent.actor || actor, 160) || 'unknown-admin',
        requestId: boundedString(persistedResolutionIntent.requestId || requestId, 128) || null,
        resolvedAt: now,
      },
    },
    last_error: overrunError,
    last_synced_at: now,
  };

  // Project the customer order while the synthetic status still reserves it.
  // A crash or projection failure therefore remains visible and retryable.
  job = await persistOrderProjectionIntent(job, finalInternalStatus);
  await updateOrderFromJob({ ...job, ...finalUpdates }, {});
  const finalized = await compareAndSetBusinessItemsStatus(job.id, resolvingStatus, finalUpdates);
  if (finalized) return normalizeDeliveryJob(finalized);
  job = await readJob(job.id);
  if (hasExactBusinessItemsResolution(job, resolution)) return normalizeDeliveryJob(job);
  throw deliveryError(
    'Состояние заявки изменилось во время ручного решения. Проверьте заказ.',
    409,
    'YANDEX_BUSINESS_ITEMS_RESOLUTION_RACE_LOST',
    { deliveryJobId: job.id },
  );
}

const hasExactBusinessCreateResolution = (job, resolution) =>
  job?.raw_response?.createReconciliation?.status === resolution;

async function finalizeBusinessCreateNotCreated(job) {
  if (job.provider_status !== BUSINESS_CREATE_RESOLUTION_STATUSES.notCreated) {
    if (
      job.provider_status === 'cancelled' &&
      hasExactBusinessCreateResolution(job, 'not_created')
    ) {
      return normalizeDeliveryJob(job);
    }
    throw deliveryError(
      'Состояние ручной проверки изменилось. Обновите заказ.',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_RESOLUTION_RACE_LOST',
    );
  }

  const now = new Date().toISOString();
  const finalUpdates = {
    provider_status: 'cancelled',
    internal_status: 'cancelled',
    cancelled_at: job.cancelled_at || now,
    raw_response: {
      ...safeRawResponse(job.raw_response),
      createReconciliation: {
        ...(job.raw_response?.createReconciliation || {}),
        status: 'not_created',
        projectionCompletedAt: now,
      },
    },
    last_error: null,
    last_synced_at: now,
  };

  // Keep the job active until the customer-order projection is durable. If the
  // process stops here, the worker sees the resolving state and repeats this
  // idempotent projection without ever releasing a second courier early.
  await updateOrderFromJob({ ...job, ...finalUpdates }, {});
  const { data, error } = await supabase
    .from('delivery_jobs')
    .update(finalUpdates)
    .eq('id', job.id)
    .eq('provider', 'yandex')
    .eq('api_family', API_FAMILIES.BUSINESS)
    .eq('provider_status', BUSINESS_CREATE_RESOLUTION_STATUSES.notCreated)
    .is('external_claim_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) return normalizeDeliveryJob(data);
  const current = await readJob(job.id);
  if (
    current.provider_status === 'cancelled' &&
    hasExactBusinessCreateResolution(current, 'not_created')
  ) {
    return normalizeDeliveryJob(current);
  }
  throw deliveryError(
    'Состояние ручной проверки изменилось во время завершения. Обновите заказ.',
    409,
    'YANDEX_BUSINESS_RECONCILIATION_RESOLUTION_RACE_LOST',
  );
}

async function resolveBusinessCreateReconciliation(
  orderId,
  { deliveryJobId, resolution, externalOrderId, reason, actor, requestId } = {},
) {
  if (!['attach', 'not_created'].includes(String(resolution))) {
    throw deliveryError(
      'Укажите результат проверки кабинета Яндекса',
      422,
      'YANDEX_BUSINESS_RECONCILIATION_RESOLUTION_INVALID',
    );
  }
  const safeReason = boundedString(reason, 240);
  if (!safeReason) {
    throw deliveryError(
      'Укажите причину и источник проверки кабинета Яндекса',
      422,
      'YANDEX_BUSINESS_RECONCILIATION_REASON_REQUIRED',
    );
  }
  const safeExternalOrderId = String(externalOrderId || '').trim();
  if (resolution === 'attach' && !/^[0-9A-Za-z._:-]{1,160}$/.test(safeExternalOrderId)) {
    throw deliveryError(
      'Укажите корректный ID заказа из кабинета Яндекса',
      422,
      'YANDEX_BUSINESS_EXTERNAL_ORDER_ID_REQUIRED',
    );
  }
  if (resolution === 'not_created' && safeExternalOrderId) {
    throw deliveryError(
      'Для отсутствующей заявки внешний ID не указывается',
      422,
      'YANDEX_BUSINESS_EXTERNAL_ORDER_ID_FORBIDDEN',
    );
  }
  const job = await readJob(deliveryJobId);
  if (
    String(job.order_id) !== String(orderId) ||
    job.provider !== 'yandex' ||
    (job.api_family || API_FAMILIES.CARGO) !== API_FAMILIES.BUSINESS ||
    job.provider_status !== 'creating_exhausted' ||
    job.external_claim_id
  ) {
    throw deliveryError(
      'Исчерпанная заявка восстановления не найдена',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_RESOLUTION_UNAVAILABLE',
    );
  }
  const now = new Date().toISOString();
  const resolutionAudit = {
    status: resolution,
    actor: boundedString(actor, 160) || 'unknown-admin',
    reason: safeReason,
    requestId: boundedString(requestId, 128) || null,
    confirmedAt: now,
  };
  let config;
  if (resolution === 'attach') {
    config = getConfig();
    assertConfigured(config, API_FAMILIES.BUSINESS);
    const persistedClientId = boundedString(job.external_client_id, 128);
    const persistedUserId = boundedString(job.external_user_id, 128);
    if (!persistedClientId || !persistedUserId) {
      throw deliveryError(
        'В заявке отсутствуют сохранённые данные кабинета Яндекса. Привязка заблокирована.',
        409,
        'YANDEX_BUSINESS_RECONCILIATION_ACCOUNT_MISSING',
      );
    }
    const client = businessApi.createBusinessApiClient({
      ...config.business,
      clientId: persistedClientId,
      userId: persistedUserId,
    });
    const verified = businessApi.normalizeBusinessInfo(
      await client.getOrderInfo(safeExternalOrderId),
    );
    if (
      !verified ||
      verified.externalOrderId !== safeExternalOrderId ||
      verified.userId !== persistedUserId
    ) {
      throw deliveryError(
        'ID не принадлежит сохранённому сотруднику этой заявки. Привязка отменена.',
        409,
        'YANDEX_BUSINESS_RECONCILIATION_ORDER_MISMATCH',
      );
    }
  }
  const updates =
    resolution === 'attach'
      ? {
          external_claim_id: safeExternalOrderId,
          provider_status: BUSINESS_CREATE_RESOLUTION_STATUSES.attach,
          internal_status: 'unassigned',
          raw_response: {
            ...safeRawResponse(job.raw_response),
            createReconciliation: resolutionAudit,
          },
          request_payload_ciphertext: null,
          reconciliation_next_at: null,
          last_error: 'Проверенный ID найден; завершается синхронизация заказа Яндекса',
          last_synced_at: now,
        }
      : {
          provider_status: BUSINESS_CREATE_RESOLUTION_STATUSES.notCreated,
          internal_status: 'unassigned',
          raw_response: {
            ...safeRawResponse(job.raw_response),
            createReconciliation: resolutionAudit,
          },
          request_payload_ciphertext: null,
          request_payload: {
            apiFamily: API_FAMILIES.BUSINESS,
            createConfirmedAbsent: true,
          },
          authorized_max_price: null,
          quoted_price: null,
          quoted_at: null,
          quote_fingerprint: null,
          quote_expires_at: null,
          reconciliation_next_at: null,
          last_error: 'Подтверждено отсутствие заявки; завершается освобождение заказа',
          last_synced_at: now,
        };
  let data;
  let updateError;
  try {
    ({ data, error: updateError } = await supabase
      .from('delivery_jobs')
      .update(updates)
      .eq('id', job.id)
      .eq('order_id', orderId)
      .eq('provider', 'yandex')
      .eq('api_family', API_FAMILIES.BUSINESS)
      .eq('provider_status', 'creating_exhausted')
      .is('external_claim_id', null)
      .select('*')
      .maybeSingle());
  } catch (error) {
    if (resolution === 'attach' && isUniqueViolation(error)) {
      throw businessExternalOrderAlreadyBoundError(job.id);
    }
    throw error;
  }
  if (updateError) {
    if (resolution === 'attach' && isUniqueViolation(updateError)) {
      throw businessExternalOrderAlreadyBoundError(job.id);
    }
    throw updateError;
  }
  if (!data) {
    throw deliveryError(
      'Состояние заявки изменилось. Обновите заказ.',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_RESOLUTION_RACE_LOST',
    );
  }
  if (resolution === 'not_created') {
    return finalizeBusinessCreateNotCreated(data);
  }
  await markOrderExternalDispatchActive(orderId);
  return syncBusinessDeliveryJob(data, config);
}

async function syncDeliveryJob(jobOrId) {
  const config = getConfig();
  let job = typeof jobOrId === 'string' ? await readJob(jobOrId) : jobOrId;
  const apiFamily = job?.api_family || API_FAMILIES.CARGO;
  assertConfigured(config, apiFamily);
  if (apiFamily === API_FAMILIES.BUSINESS) return syncBusinessDeliveryJob(job, config);
  if (!job?.external_claim_id) return normalizeDeliveryJob(job);
  if (isTerminalStatus(job.provider_status)) {
    await updateOrderFromJob(job, {});
    if (job.last_error) {
      job = await updateJob(job.id, {
        last_error: null,
        last_synced_at: new Date().toISOString(),
      });
    }
    return normalizeDeliveryJob(job);
  }
  try {
    let info = await apiRequest('/claims/info', {
      query: { claim_id: job.external_claim_id },
      config,
    });
    if (info.status === 'ready_for_approval' && job.auto_accept) {
      const accepted = await apiRequest('/claims/accept', {
        query: { claim_id: job.external_claim_id },
        body: { version: Number(info.version) },
        config,
      });
      info = { ...info, ...accepted, status: accepted.status || 'accepted' };
    }
    const performer = info.performer_info || {};
    const finalPrice = info.pricing?.final_price ?? info.pricing?.offer?.price ?? null;
    const extra = await supplementaryCourierData(info, job, config);
    const internalStatus = mapYandexStatus(info.status);
    const now = new Date().toISOString();
    const updates = {
      provider_status: info.status || job.provider_status,
      internal_status: internalStatus,
      external_version: info.version == null ? job.external_version : Number(info.version),
      provider_price: finalPrice == null ? job.provider_price : Number(finalPrice),
      currency:
        info.pricing?.currency || info.pricing?.currency_rules?.code || job.currency || 'KZT',
      quote_expires_at: info.pricing?.offer?.valid_until || job.quote_expires_at,
      courier_name: performer.courier_name || job.courier_name,
      courier_transport_type: performer.transport_type || job.courier_transport_type,
      courier_car_model: performer.car_model || job.courier_car_model,
      courier_car_number: performer.car_number || job.courier_car_number,
      courier_car_color: performer.car_color || job.courier_car_color,
      ...(extra.tracking_url && { tracking_url: extra.tracking_url }),
      ...(extra.courier_phone && { courier_phone: extra.courier_phone }),
      ...(extra.courier_latitude != null && {
        courier_latitude: extra.courier_latitude,
        courier_longitude: extra.courier_longitude,
        courier_location_updated_at: extra.courier_location_updated_at,
        ...(extra.courier_location_accuracy != null && {
          courier_location_accuracy: extra.courier_location_accuracy,
        }),
        ...(extra.courier_speed != null && { courier_speed: extra.courier_speed }),
        ...(extra.courier_direction != null && { courier_direction: extra.courier_direction }),
      }),
      accepted_at: ['accepted', 'performer_lookup', 'performer_draft', 'performer_found'].includes(
        info.status,
      )
        ? job.accepted_at || now
        : job.accepted_at,
      picked_up_at: [
        'pickuped',
        'delivery_arrived',
        'ready_for_delivery_confirmation',
        'delivered',
        'delivered_finish',
      ].includes(info.status)
        ? job.picked_up_at || now
        : job.picked_up_at,
      delivered_at: ['delivered', 'delivered_finish'].includes(info.status)
        ? job.delivered_at || now
        : job.delivered_at,
      cancelled_at:
        isTerminalStatus(info.status) && !['delivered', 'delivered_finish'].includes(info.status)
          ? job.cancelled_at || now
          : job.cancelled_at,
      raw_response: info,
      last_error: null,
      last_synced_at: now,
    };
    if (internalStatus === 'delivered') {
      // Complete the customer order before persisting a terminal provider
      // status. If completion fails, the active job remains retryable.
      const projectionJob = await persistOrderProjectionIntent(job, internalStatus);
      await updateOrderFromJob({ ...projectionJob, ...updates }, info);
      job = await updateJob(job.id, updates);
    } else if (isTerminalStatus(info.status)) {
      const projectionJob = await persistOrderProjectionIntent(job, internalStatus);
      await updateOrderFromJob({ ...projectionJob, ...updates }, info);
      job = await updateJob(job.id, updates);
    } else {
      const projectionJob = await persistOrderProjectionIntent(job, internalStatus);
      job = await updateJob(job.id, { ...updates, internal_status: projectionJob.internal_status });
      await updateOrderFromJob(job, info);
    }
    return normalizeDeliveryJob(job);
  } catch (error) {
    await saveJobError(job, error);
    throw error;
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function dispatchBusinessOrder(order, options, config) {
  assertConfigured(config, API_FAMILIES.BUSINESS);
  const requestedJobId = String(options?.deliveryJobId || '');
  const requestedMaximum = Number(options?.maxPriceKzt);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestedJobId,
    )
  ) {
    throw deliveryError(
      'Сначала рассчитайте стоимость и подтвердите конкретную заявку',
      409,
      'YANDEX_BUSINESS_QUOTE_REQUIRED',
    );
  }
  if (!Number.isFinite(requestedMaximum) || requestedMaximum <= 0) {
    throw deliveryError(
      'Подтвердите максимальную стоимость доставки',
      422,
      'YANDEX_BUSINESS_MAX_PRICE_REQUIRED',
    );
  }
  let job = await readJob(requestedJobId);
  if (
    String(job.order_id) !== String(order.id) ||
    (job.api_family || API_FAMILIES.CARGO) !== API_FAMILIES.BUSINESS
  ) {
    throw deliveryError(
      'Расчёт доставки не относится к этому заказу',
      404,
      'DELIVERY_JOB_NOT_FOUND',
    );
  }
  if (job.external_claim_id) return syncBusinessDeliveryJob(job, config);
  if (
    job.provider_status === 'creating_exhausted' ||
    Object.values(BUSINESS_CREATE_RESOLUTION_STATUSES).includes(job.provider_status)
  ) {
    throw deliveryError(
      job.provider_status === 'creating_exhausted'
        ? 'Автоматические попытки восстановления исчерпаны. Проверьте заказ в кабинете Яндекса вручную.'
        : 'Ручная проверка кабинета уже выполняется. Дождитесь её безопасного завершения.',
      409,
      job.provider_status === 'creating_exhausted'
        ? 'YANDEX_BUSINESS_RECONCILIATION_EXHAUSTED'
        : 'YANDEX_BUSINESS_RECONCILIATION_IN_PROGRESS',
      { deliveryJobId: job.id, attemptCount: Number(job.reconciliation_attempts || 0) },
    );
  }
  const uncertainRetry = ['creating', 'creating_uncertain'].includes(job.provider_status);
  const authorizedMaximum = uncertainRetry ? Number(job.authorized_max_price) : requestedMaximum;
  if (!Number.isFinite(authorizedMaximum) || authorizedMaximum <= 0) {
    throw deliveryError(
      'Сохранённый финансовый лимит заявки отсутствует. Автоматический повтор заблокирован.',
      409,
      'YANDEX_BUSINESS_AUTHORIZATION_MISSING',
    );
  }
  if (!uncertainRetry && config.business.restaurantDeliveryConfirmed !== true) {
    throw deliveryError(
      'Вызов заблокирован: получите письменное подтверждение Яндекса для ресторанной доставки и включите серверное разрешение.',
      409,
      'YANDEX_BUSINESS_RESTAURANT_DELIVERY_NOT_CONFIRMED',
    );
  }
  if (
    !uncertainRetry &&
    (config.opsAlertReceiver.configured !== true || config.opsAlertReceiver.required !== true)
  ) {
    throw deliveryError(
      'Вызов заблокирован: настройте обязательный HTTPS-приёмник операционных тревог.',
      503,
      'YANDEX_BUSINESS_ALERT_RECEIVER_REQUIRED',
    );
  }
  if (!uncertainRetry && config.opsAlertReceiver.workersEnabled !== true) {
    throw deliveryError(
      'Вызов заблокирован: фоновый обработчик тревог выключен.',
      503,
      'YANDEX_BUSINESS_ALERT_WORKER_REQUIRED',
    );
  }
  if (!uncertainRetry && config.opsAlertReceiver.deliverySyncEnabled !== true) {
    throw deliveryError(
      'Вызов заблокирован: фоновая синхронизация Яндекс Go выключена.',
      503,
      'YANDEX_BUSINESS_SYNC_WORKER_REQUIRED',
    );
  }
  const approvedFingerprint = String(options?.quoteFingerprint || '');
  if (
    !uncertainRetry &&
    (!/^[a-f0-9]{64}$/.test(approvedFingerprint) ||
      approvedFingerprint !== String(job.quote_fingerprint || ''))
  ) {
    throw deliveryError(
      'Расчёт цены изменился после подтверждения. Проверьте новую цену и подтвердите её заново.',
      409,
      'YANDEX_BUSINESS_QUOTE_VERSION_CHANGED',
    );
  }
  if (!uncertainRetry) validateDeliveryOrder(order, config);
  const quotedPrice = Number(job.quoted_price);
  if (
    !Number.isFinite(quotedPrice) ||
    quotedPrice <= 0 ||
    job.raw_response?.fixedPrice !== true ||
    !job.quote_fingerprint ||
    !job.quote_expires_at ||
    (!uncertainRetry && new Date(job.quote_expires_at).getTime() <= Date.now())
  ) {
    throw deliveryError(
      'Расчёт цены устарел или не является фиксированным. Рассчитайте заново.',
      409,
      'YANDEX_BUSINESS_QUOTE_EXPIRED',
    );
  }
  if (
    quotedPrice > authorizedMaximum ||
    (!uncertainRetry && authorizedMaximum > Number(config.business.maxPriceKzt))
  ) {
    throw deliveryError(
      'Цена превышает подтверждённый или серверный лимит',
      409,
      'YANDEX_BUSINESS_PRICE_LIMIT_EXCEEDED',
      {
        quotedPrice,
        authorizedMaximum,
        serverMaximum: config.business.maxPriceKzt,
      },
    );
  }
  let createPayload;
  try {
    createPayload = decryptBusinessRequest(job);
  } catch (error) {
    if (!uncertainRetry || !isUnreadableBusinessRequestError(error)) throw error;
    job = await exhaustUnreadableBusinessCreate(job);
    throw deliveryError(
      'Сохранённый запрос нельзя безопасно повторить. Проверьте заказ в кабинете Яндекса вручную.',
      409,
      'YANDEX_BUSINESS_RECONCILIATION_EXHAUSTED',
      { deliveryJobId: job.id, attemptCount: Number(job.reconciliation_attempts || 0) },
    );
  }
  const persistedBusinessConfig = {
    ...config.business,
    clientId: job.external_client_id || config.business.clientId,
    userId: job.external_user_id || config.business.userId,
  };
  if (!uncertainRetry) {
    const currentCreatePayload = businessApi.buildBusinessCreatePayload(
      order,
      persistedBusinessConfig,
      {
        offer: createPayload.offer,
        requirements: createPayload.requirements || {},
        className: createPayload.class,
      },
    );
    const expectedFingerprint = businessQuoteFingerprint(
      order,
      {
        className: createPayload.class,
        price: quotedPrice,
        currency: job.currency,
        offer: createPayload.offer,
        requirements: createPayload.requirements || {},
      },
      persistedBusinessConfig,
      currentCreatePayload,
    );
    if (expectedFingerprint !== job.quote_fingerprint) {
      throw deliveryError(
        'Маршрут или расчёт изменился. Получите новую цену.',
        409,
        'YANDEX_BUSINESS_QUOTE_CHANGED',
      );
    }
  }
  if (!uncertainRetry) {
    job = await beginBusinessCreate(job.id, authorizedMaximum, approvedFingerprint);
  }
  const client = businessApi.createBusinessApiClient(persistedBusinessConfig);
  if (uncertainRetry) {
    const reservationIntact =
      !order.courier_id &&
      ['', 'unassigned'].includes(String(order.delivery_status || '')) &&
      order.courier_dispatch_status === 'processing' &&
      order.courier_dispatch_provider === 'yandex';
    if (reservationIntact) {
      const { error: retryReservationError } = await supabase
        .from('kaspi_orders')
        .update({ courier_dispatch_attempted_at: new Date().toISOString() })
        .eq('id', order.id)
        .eq('courier_dispatch_status', 'processing')
        .eq('courier_dispatch_provider', 'yandex');
      if (retryReservationError) throw retryReservationError;
    } else if (job.provider_status !== 'creating') {
      throw deliveryError(
        'Неопределённую заявку нельзя повторить: резерв заказа изменился.',
        409,
        'DELIVERY_DISPATCH_RACE_LOST',
      );
    } else {
      // The process can stop after the quoted->creating CAS but before the
      // order reservation. No provider call has happened yet in that state,
      // so the worker safely finishes the reservation and reuses the same UUID.
      const { data: recoveredReservation, error: recoveryError } = await supabase
        .from('kaspi_orders')
        .update({
          courier_dispatch_status: 'processing',
          courier_dispatch_provider: 'yandex',
          courier_dispatch_attempted_at: new Date().toISOString(),
          courier_dispatch_error: null,
        })
        .eq('id', order.id)
        .is('courier_id', null)
        .eq('delivery_status', 'unassigned')
        .or(
          'courier_dispatch_status.is.null,courier_dispatch_status.in.(pending,retrying,awaiting_confirmation,failed)',
        )
        .select('id')
        .maybeSingle();
      if (recoveryError) throw recoveryError;
      if (!recoveredReservation) {
        throw deliveryError(
          'Не удалось восстановить резерв заказа для безопасного повтора.',
          409,
          'DELIVERY_DISPATCH_RACE_LOST',
        );
      }
    }
  } else {
    const { data: reservedOrder, error: reserveError } = await supabase
      .from('kaspi_orders')
      .update({
        courier_dispatch_status: 'processing',
        courier_dispatch_provider: 'yandex',
        courier_dispatch_attempted_at: new Date().toISOString(),
        courier_dispatch_error: null,
      })
      .eq('id', order.id)
      .is('courier_id', null)
      .eq('delivery_status', 'unassigned')
      .or(
        'courier_dispatch_status.is.null,courier_dispatch_status.in.(pending,retrying,awaiting_confirmation,failed)',
      )
      .select('id')
      .maybeSingle();
    if (reserveError) {
      await resetBusinessCreateToQuoted(job.id).catch(() => {});
      throw reserveError;
    }
    if (!reservedOrder) {
      await resetBusinessCreateToQuoted(job.id).catch(() => {});
      throw deliveryError(
        'Заказ уже взят другим диспетчером или курьером. Обновите список.',
        409,
        'DELIVERY_DISPATCH_RACE_LOST',
      );
    }
  }
  job = await claimBusinessReconciliationAttempt(job);
  let providerAccepted = false;
  try {
    const created = await client.createOrder(createPayload, {
      idempotencyToken: job.client_request_id,
    });
    const externalOrderId = String(created?.order_id || created?.id || '').trim();
    if (!/^[0-9A-Za-z._:-]{1,160}$/.test(externalOrderId)) {
      providerAccepted = true;
      job = await updateJob(job.id, {
        provider_status: 'creating_exhausted',
        internal_status: 'unassigned',
        request_payload_ciphertext: null,
        reconciliation_next_at: null,
        last_error:
          'Яндекс создал заказ, но вернул некорректный ID; требуется ручная проверка кабинета',
        last_synced_at: new Date().toISOString(),
      });
      throw deliveryError(
        'Яндекс создал заказ, но его ID нельзя безопасно сохранить. Требуется ручная проверка.',
        409,
        'YANDEX_BUSINESS_ORDER_ID_INVALID',
        { deliveryJobId: job.id },
      );
    }
    providerAccepted = true;
    const createdStatus = normalizeBusinessProviderStatus(created?.status || 'search', 'search');
    const createdIsTerminal = businessApi.isBusinessTerminalStatus(createdStatus);
    try {
      job = await updateJob(job.id, {
        external_claim_id: externalOrderId,
        // `/orders/create` can report a terminal status before the Bulka order
        // projection exists. Keep a locally active sync state until `/orders/info`
        // is fetched and projected; otherwise a crash could release the order.
        provider_status: createdIsTerminal ? 'create_resolution_attaching' : createdStatus,
        internal_status: createdIsTerminal
          ? 'unassigned'
          : businessApi.mapBusinessStatus(createdStatus),
        raw_response: {
          ...safeRawResponse(job.raw_response),
          fixedPrice: true,
          className: createPayload.class,
          orderCreated: true,
          ...(createdIsTerminal && { createReportedStatus: createdStatus }),
        },
        request_payload_ciphertext: null,
        reconciliation_next_at: null,
        last_error: createdIsTerminal
          ? 'Яндекс сразу вернул конечный статус; завершается безопасная синхронизация'
          : null,
        last_synced_at: new Date().toISOString(),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      providerAccepted = false;
      job = await updateJob(job.id, {
        provider_status: 'creating_exhausted',
        internal_status: 'unassigned',
        request_payload_ciphertext: null,
        reconciliation_next_at: null,
        last_error:
          'Яндекс создал заказ с ID, уже привязанным к другой заявке; требуется ручная проверка кабинета',
        last_synced_at: new Date().toISOString(),
      });
      throw businessExternalOrderAlreadyBoundError(job.id);
    }
    await markOrderExternalDispatchActive(order.id);
    return syncBusinessDeliveryJob(job, config);
  } catch (error) {
    if (
      ['YANDEX_BUSINESS_EXTERNAL_ORDER_ALREADY_BOUND', 'YANDEX_BUSINESS_ORDER_ID_INVALID'].includes(
        error?.code,
      ) &&
      job.provider_status === 'creating_exhausted'
    ) {
      throw error;
    }
    if (providerAccepted && job.external_claim_id) {
      await saveJobError(job, error);
    } else if (
      providerAccepted ||
      error?.uncertain === true ||
      error?.details?.uncertain === true
    ) {
      const attempts = Number(job.reconciliation_attempts || 0);
      const exhausted = attempts >= BUSINESS_RECONCILIATION_MAX_ATTEMPTS;
      await updateJob(job.id, {
        provider_status: exhausted ? 'creating_exhausted' : 'creating_uncertain',
        ...(exhausted && { request_payload_ciphertext: null }),
        reconciliation_next_at: exhausted ? null : job.reconciliation_next_at,
        last_error: exhausted
          ? 'Автоматическое восстановление исчерпано; проверьте заказ в кабинете Яндекса вручную'
          : boundedString(error.message, 2000),
        last_synced_at: new Date().toISOString(),
      });
    } else {
      job = await updateJob(job.id, {
        provider_status: 'draft',
        authorized_max_price: null,
        quoted_price: null,
        quoted_at: null,
        quote_fingerprint: null,
        quote_expires_at: null,
        request_payload: {
          apiFamily: API_FAMILIES.BUSINESS,
          lastCreateRejected: true,
        },
        request_payload_ciphertext: null,
        raw_response: {},
        reconciliation_attempts: 0,
        reconciliation_next_at: null,
        last_error: boundedString(error.message, 2000),
        last_synced_at: new Date().toISOString(),
      }).catch(() => job);
      await supabase
        .from('kaspi_orders')
        .update({
          courier_dispatch_status: 'awaiting_confirmation',
          courier_dispatch_error: boundedString(error.message, 2000),
        })
        .eq('id', order.id)
        .eq('courier_dispatch_status', 'processing')
        .eq('courier_dispatch_provider', 'yandex');
    }
    throw error;
  }
}

async function dispatchOrder(orderId, options = {}) {
  const config = getConfig();
  const order = await readOrder(orderId);
  const existing = await findActiveJob(order.id);
  const apiFamily = existing?.api_family || config.apiMode;
  assertConfigured(config, apiFamily);
  if (
    !order.courier_dispatch_requested_at &&
    !['preparing', 'ready', 'handed_over'].includes(String(order.kitchen_status || 'queued'))
  ) {
    throw deliveryError(
      'Сначала примите заказ на кухне. Оплата сама по себе курьера не вызывает.',
      409,
      'KITCHEN_ACCEPTANCE_REQUIRED',
    );
  }
  if (apiFamily === API_FAMILIES.BUSINESS) {
    return dispatchBusinessOrder(order, options, config);
  }
  const currentPayload = buildClaimPayload(order, config);
  let job = await getOrCreateJob(order, currentPayload);
  const cargoCreateRetry =
    !job.external_claim_id && ['creating', 'creating_uncertain'].includes(job.provider_status);
  const payload = cargoCreateRetry ? job.request_payload : currentPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw deliveryError(
      'Сохранённый Cargo-запрос отсутствует. Автоматический повтор заблокирован.',
      409,
      'YANDEX_DELIVERY_RECOVERY_PAYLOAD_MISSING',
    );
  }
  if (
    !cargoCreateRetry &&
    (!job.auto_accept || JSON.stringify(job.request_payload || {}) !== JSON.stringify(payload))
  ) {
    job = await updateJob(job.id, {
      auto_accept: true,
      request_payload: payload,
      last_error: null,
    });
  }
  if (!job.external_claim_id) {
    if (!cargoCreateRetry) job = await beginCargoCreate(job.id);
    try {
      const claim = await apiRequest('/claims/create', {
        query: { request_id: job.client_request_id },
        body: payload,
        config,
      });
      job = await updateJob(job.id, {
        external_claim_id: claim.id,
        external_version: claim.version == null ? null : Number(claim.version),
        provider_status: claim.status || 'new',
        internal_status: mapYandexStatus(claim.status),
        raw_response: claim,
        last_error: null,
        last_synced_at: new Date().toISOString(),
      });
    } catch (error) {
      const providerStatus = Number(error?.details?.providerStatus);
      const definitelyRejected = [400, 401, 403, 404, 422].includes(providerStatus);
      job = await updateJob(job.id, {
        provider_status: definitelyRejected ? 'quoted' : 'creating_uncertain',
        last_error: boundedString(error?.message, 2000),
        last_synced_at: new Date().toISOString(),
      }).catch(() => job);
      throw error;
    }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await syncDeliveryJob(job.id);
    if (
      result.status !== 'new' &&
      result.status !== 'estimating' &&
      result.status !== 'ready_for_approval'
    )
      return result;
    if (attempt < 4) await sleep(500);
  }
  return normalizeDeliveryJob(await readJob(job.id));
}

async function syncOrderDelivery(orderId) {
  const job = await findActiveJob(orderId);
  if (!job) {
    const latest = (await listOrderJobs(orderId))[0] || null;
    if (latest?.last_error && latest.external_claim_id) return syncDeliveryJob(latest);
    return normalizeDeliveryJob(latest);
  }
  if (['creating', 'creating_uncertain'].includes(job.provider_status)) {
    const config = getConfig();
    if ((job.api_family || API_FAMILIES.CARGO) === API_FAMILIES.BUSINESS) {
      return dispatchBusinessOrder(
        await readOrder(orderId),
        { deliveryJobId: job.id, maxPriceKzt: Number(job.authorized_max_price) },
        config,
      );
    }
    return dispatchOrder(orderId);
  }
  if (job.provider_status === BUSINESS_CREATE_RESOLUTION_STATUSES.notCreated) {
    return finalizeBusinessCreateNotCreated(job);
  }
  if (job.provider_status === 'creating_exhausted') return normalizeDeliveryJob(job);
  return syncDeliveryJob(job);
}

async function getCancellationInfo(orderId) {
  const job = await findActiveJob(orderId);
  if (!job) throw deliveryError('Активная доставка не найдена', 404);
  if (!job.external_claim_id) {
    if ((job.api_family || API_FAMILIES.CARGO) === API_FAMILIES.BUSINESS) {
      if (
        [
          'creating',
          'creating_uncertain',
          'creating_exhausted',
          ...Object.values(BUSINESS_CREATE_RESOLUTION_STATUSES),
        ].includes(String(job.provider_status))
      ) {
        throw deliveryError(
          'Яндекс мог создать заказ, но его ID ещё не подтверждён. Сначала выполните синхронизацию с тем же UUID.',
          409,
          'YANDEX_BUSINESS_CREATE_UNCERTAIN',
          { deliveryJobId: job.id },
        );
      }
      return {
        cancelState: 'free',
        price: 0,
        currency: job.currency || 'KZT',
        message: 'Внешний заказ ещё не подтверждён Яндексом',
      };
    }
    if (['creating', 'creating_uncertain'].includes(String(job.provider_status))) {
      throw deliveryError(
        'Локальную заявку Cargo нельзя отменять во время возможного создания. Выполните синхронизацию.',
        409,
        'YANDEX_DELIVERY_CREATE_UNCERTAIN',
        { deliveryJobId: job.id },
      );
    }
    return {
      cancelState: 'free',
      price: 0,
      currency: job.currency || 'KZT',
      message: 'Внешний заказ ещё не подтверждён Яндексом',
    };
  }
  if ((job.api_family || API_FAMILIES.CARGO) === API_FAMILIES.BUSINESS) {
    const config = getConfig();
    assertConfigured(config, API_FAMILIES.BUSINESS);
    const client = businessApi.createBusinessApiClient({
      ...config.business,
      clientId: job.external_client_id || config.business.clientId,
      userId: job.external_user_id || config.business.userId,
    });
    const info = businessApi.normalizeBusinessInfo(
      await client.getOrderInfo(job.external_claim_id),
    );
    if (
      !info ||
      info.externalOrderId !== String(job.external_claim_id) ||
      info.userId !== String(job.external_user_id || config.business.userId)
    ) {
      throw deliveryError(
        'Ответ Яндекса не соответствует сохранённому заказу или сотруднику. Отмена остановлена.',
        409,
        'YANDEX_BUSINESS_ORDER_IDENTITY_MISMATCH',
        { deliveryJobId: job.id },
      );
    }
    const rules = info?.cancelRules;
    return {
      cancelState: rules?.canCancel ? rules.state || 'unavailable' : 'unavailable',
      price: null,
      currency: job.currency || 'KZT',
      message: rules?.message || null,
      title: rules?.title || null,
    };
  }
  const result = await apiRequest('/claims/cancel-info', {
    query: { claim_id: job.external_claim_id },
  });
  return {
    cancelState: result.cancel_state,
    price: Number(result.price || 0),
    currency: result.currency || job.currency || 'KZT',
  };
}

async function cancelDelivery(orderId, { allowPaid = false } = {}) {
  let job = await findActiveJob(orderId);
  if (!job) throw deliveryError('Активная доставка не найдена', 404);
  const apiFamily = job.api_family || API_FAMILIES.CARGO;
  if (!job.external_claim_id) {
    if (
      apiFamily === API_FAMILIES.BUSINESS &&
      [
        'creating',
        'creating_uncertain',
        'creating_exhausted',
        ...Object.values(BUSINESS_CREATE_RESOLUTION_STATUSES),
      ].includes(String(job.provider_status))
    ) {
      throw deliveryError(
        'Отмена заблокирована: заказ мог быть создан в Яндексе. Сначала восстановите его ID синхронизацией с тем же UUID.',
        409,
        'YANDEX_BUSINESS_CREATE_UNCERTAIN',
        { deliveryJobId: job.id },
      );
    }
    if (
      apiFamily === API_FAMILIES.CARGO &&
      ['creating', 'creating_uncertain'].includes(String(job.provider_status))
    ) {
      throw deliveryError(
        'Отмена локальной Cargo-заявки заблокирована до подтверждения результата создания.',
        409,
        'YANDEX_DELIVERY_CREATE_UNCERTAIN',
        { deliveryJobId: job.id },
      );
    }
    job =
      apiFamily === API_FAMILIES.BUSINESS
        ? await cancelUncreatedBusinessJob(job.id)
        : await cancelUncreatedCargoJob(job.id);
    await updateOrderFromJob(job, {});
    return normalizeDeliveryJob(job);
  }
  if (apiFamily === API_FAMILIES.BUSINESS) {
    if (
      job.provider_status === BUSINESS_ITEMS_UNRESOLVED_STATUS ||
      Object.values(BUSINESS_ITEMS_RESOLUTION_STATUSES).includes(job.provider_status)
    ) {
      throw deliveryError(
        'Курьер уже получил заказ. Зафиксируйте вручную: заказ возвращён или доставлен.',
        409,
        'YANDEX_BUSINESS_ITEMS_RESOLUTION_REQUIRED',
        { deliveryJobId: job.id },
      );
    }
    const config = getConfig();
    assertConfigured(config, API_FAMILIES.BUSINESS);
    const client = businessApi.createBusinessApiClient({
      ...config.business,
      clientId: job.external_client_id || config.business.clientId,
      userId: job.external_user_id || config.business.userId,
    });
    const info = businessApi.normalizeBusinessInfo(
      await client.getOrderInfo(job.external_claim_id),
    );
    if (
      !info ||
      info.externalOrderId !== String(job.external_claim_id) ||
      info.userId !== String(job.external_user_id || config.business.userId)
    ) {
      throw deliveryError(
        'Ответ Яндекса не соответствует сохранённому заказу или сотруднику. Отмена остановлена.',
        409,
        'YANDEX_BUSINESS_ORDER_IDENTITY_MISMATCH',
        { deliveryJobId: job.id },
      );
    }
    const rules = info?.cancelRules;
    if (!rules?.canCancel || !rules.state) {
      throw deliveryError(
        rules?.message || 'Яндекс сейчас не разрешает отменить заказ',
        409,
        'CANCELLATION_UNAVAILABLE',
      );
    }
    const requiresPaidConfirmation = ['paid', 'minimal'].includes(rules.state);
    if (requiresPaidConfirmation && (!allowPaid || !config.business.allowPaidCancel)) {
      throw deliveryError(
        rules.message || 'Отмена может быть платной и требует отдельного разрешения',
        409,
        'PAID_CANCELLATION_CONFIRMATION_REQUIRED',
        {
          cancelState: rules.state,
          price: null,
          currency: job.currency || 'KZT',
          title: rules.title,
          message: rules.message,
        },
      );
    }
    const preCancelStatus = normalizeBusinessProviderStatus(info?.providerStatus, 'unknown');
    const preCancelVehicle = info?.courier?.vehicle || {};
    const preCancelHasPerformer = Boolean(
      info?.courier?.name ||
      info?.courier?.phone ||
      preCancelVehicle.model ||
      preCancelVehicle.number ||
      preCancelVehicle.color,
    );
    const strictlyPrePickup =
      rules.state === 'free' &&
      ['search', 'scheduling'].includes(preCancelStatus) &&
      !preCancelHasPerformer;
    const result = await client.cancelOrder(job.external_claim_id, rules.state);
    if (String(result?.status || '').toLowerCase() !== 'cancelled') {
      const error = deliveryError(
        'Яндекс не подтвердил отмену. Заявка сохранена активной до следующей синхронизации.',
        502,
        'YANDEX_BUSINESS_CANCEL_UNCONFIRMED',
      );
      await saveJobError(job, error);
      throw error;
    }
    let postCancelStatus = 'unknown';
    let postCancelIdentityVerified = false;
    let postCancelHasPerformer = false;
    try {
      const postCancelInfo = businessApi.normalizeBusinessInfo(
        await client.getOrderInfo(job.external_claim_id),
      );
      postCancelStatus = normalizeBusinessProviderStatus(postCancelInfo?.providerStatus, 'unknown');
      postCancelIdentityVerified =
        postCancelInfo?.externalOrderId === String(job.external_claim_id) &&
        postCancelInfo?.userId === String(job.external_user_id || config.business.userId);
      const postVehicle = postCancelInfo?.courier?.vehicle || {};
      postCancelHasPerformer = Boolean(
        postCancelInfo?.courier?.name ||
        postCancelInfo?.courier?.phone ||
        postVehicle.model ||
        postVehicle.number ||
        postVehicle.color,
      );
    } catch {
      // A successful cancel response is not proof that goods were never handed
      // over. Failed post-cancel evidence is deliberately resolved by an owner.
    }
    const freshEvidenceJob = {
      ...job,
      provider_status: info?.providerStatus || job.provider_status,
      internal_status: info?.internalStatus || job.internal_status,
    };
    const localHandoffEvidence = await hasBusinessItemsHandoffEvidence(
      freshEvidenceJob,
      'cancelled',
    );
    const mayHaveItems =
      !strictlyPrePickup ||
      !postCancelIdentityVerified ||
      postCancelStatus !== 'cancelled' ||
      postCancelHasPerformer ||
      localHandoffEvidence;
    if (mayHaveItems) {
      job = await preservePostPickupBusinessItems(
        {
          ...freshEvidenceJob,
          raw_response: {
            ...safeRawResponse(job.raw_response),
            cancellationState: rules.state,
            cancellationEvidence: {
              preStatus: preCancelStatus,
              postStatus: postCancelStatus,
              postIdentityVerified: postCancelIdentityVerified,
              postHasPerformer: postCancelHasPerformer,
              strictlyPrePickup,
            },
          },
        },
        postCancelStatus,
      );
      return normalizeDeliveryJob(job);
    }
    const cancellationOverrunError = retainedBusinessPriceOverrunError(job);
    const cancellationUpdates = {
      provider_status: 'cancelled',
      internal_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      raw_response: {
        ...safeRawResponse(job.raw_response),
        fixedPrice: job.raw_response?.fixedPrice === true,
        cancellationState: rules.state,
        cancellationEvidence: {
          preStatus: preCancelStatus,
          postStatus: postCancelStatus,
          postIdentityVerified: true,
          postHasPerformer: false,
          strictlyPrePickup: true,
        },
      },
      last_error: cancellationOverrunError,
      last_synced_at: new Date().toISOString(),
    };
    job = await persistOrderProjectionIntent(job, 'cancelled');
    await updateOrderFromJob({ ...job, ...cancellationUpdates }, result || {});
    job = await updateJob(job.id, cancellationUpdates);
    return normalizeDeliveryJob(job);
  }
  await syncDeliveryJob(job);
  job = await readJob(job.id);
  if (isTerminalStatus(job.provider_status)) return normalizeDeliveryJob(job);
  const terms = await getCancellationInfo(orderId);
  if (terms.cancelState === 'unavailable') {
    throw deliveryError(
      'Курьер уже забрал заказ. Отмена доступна только через поддержку Яндекса.',
      409,
      'CANCELLATION_UNAVAILABLE',
    );
  }
  if (terms.cancelState === 'paid' && !allowPaid) {
    throw deliveryError(
      'Отмена платная. Требуется отдельное подтверждение.',
      409,
      'PAID_CANCELLATION_CONFIRMATION_REQUIRED',
      terms,
    );
  }
  const result = await apiRequest('/claims/cancel', {
    query: { claim_id: job.external_claim_id },
    body: { version: Number(job.external_version), cancel_state: terms.cancelState },
  });
  const cancelledStatus =
    result.status || (terms.cancelState === 'paid' ? 'cancelled_with_payment' : 'cancelled');
  const cancellationUpdates = {
    provider_status: cancelledStatus,
    internal_status: 'cancelled',
    external_version: result.version == null ? job.external_version : Number(result.version),
    cancelled_at: new Date().toISOString(),
    raw_response: result,
    last_error: null,
    last_synced_at: new Date().toISOString(),
  };
  // Project while the Cargo job is still active. A process crash therefore
  // leaves the existing reservation retryable instead of silently freeing it.
  job = await persistOrderProjectionIntent(job, 'cancelled');
  await updateOrderFromJob({ ...job, ...cancellationUpdates }, result);
  job = await updateJob(job.id, cancellationUpdates);
  return normalizeDeliveryJob(job);
}

async function listJobsForOrders(orderIds) {
  const ids = [...new Set((orderIds || []).map(String).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('delivery_jobs')
    .select('*')
    .in('order_id', ids)
    .eq('provider', 'yandex')
    .order('created_at', { ascending: false });
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code)) return new Map();
    throw error;
  }
  const jobs = new Map();
  for (const job of data || []) {
    const orderId = String(job.order_id);
    if (!jobs.has(orderId)) jobs.set(orderId, normalizeDeliveryJob(job));
  }
  return jobs;
}

async function syncActiveDeliveries({ limit = 25 } = {}) {
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const [businessExpiry, cargoExpiry] = await Promise.all([
    expireStaleBusinessQuotes({ limit: normalizedLimit }),
    expireStaleCargoQuotes({ limit: normalizedLimit }),
  ]);
  if (businessExpiry.failed || cargoExpiry.failed) {
    throw deliveryError(
      'Не удалось безопасно закрыть часть просроченных расчётов доставки',
      503,
      'YANDEX_DELIVERY_QUOTE_EXPIRY_PARTIAL_FAILURE',
      { failed: businessExpiry.failed + cargoExpiry.failed },
    );
  }
  const [cargoResult, businessResult] = await Promise.all([
    supabase
      .from('delivery_jobs')
      .select('*')
      .eq('provider', 'yandex')
      .eq('api_family', API_FAMILIES.CARGO)
      .not('external_claim_id', 'is', null)
      .not('provider_status', 'in', `(${[...TERMINAL_STATUSES].join(',')})`)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(normalizedLimit),
    supabase
      .from('delivery_jobs')
      .select('*')
      .eq('provider', 'yandex')
      .eq('api_family', API_FAMILIES.BUSINESS)
      .not('external_claim_id', 'is', null)
      .not('provider_status', 'in', `(${[...businessApi.BUSINESS_TERMINAL_STATUSES].join(',')})`)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(normalizedLimit),
  ]);
  if (cargoResult.error) throw cargoResult.error;
  if (businessResult.error) throw businessResult.error;
  const data = [...(cargoResult.data || []), ...(businessResult.data || [])];
  const { data: uncertainData, error: uncertainError } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('provider', 'yandex')
    .in('provider_status', [
      'creating',
      'creating_uncertain',
      BUSINESS_CREATE_RESOLUTION_STATUSES.notCreated,
    ])
    .is('external_claim_id', null)
    .or(`reconciliation_next_at.is.null,reconciliation_next_at.lte.${new Date().toISOString()}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(normalizedLimit);
  if (uncertainError) throw uncertainError;
  const { data: retryData, error: retryError } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('provider', 'yandex')
    .in('internal_status', ['delivered', 'cancelled'])
    .not('last_error', 'is', null)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(normalizedLimit);
  if (retryError) throw retryError;
  const timestampForQueue = (job) => {
    const value = new Date(job.last_synced_at || job.created_at || 0).getTime();
    return Number.isFinite(value) ? value : 0;
  };
  const projectionRetries = (retryData || []).filter(
    (job) =>
      !(
        (job.api_family || API_FAMILIES.CARGO) === API_FAMILIES.BUSINESS &&
        job.raw_response?.priceOverrun === true
      ),
  );
  const queuedJobs = [...(uncertainData || []), ...projectionRetries, ...(data || [])]
    .filter((job, index, jobs) => jobs.findIndex((candidate) => candidate.id === job.id) === index)
    .sort(
      (left, right) =>
        timestampForQueue(left) - timestampForQueue(right) ||
        String(left.id).localeCompare(right.id),
    );
  let synced = 0;
  let failed = 0;
  for (const job of queuedJobs.slice(0, normalizedLimit)) {
    try {
      if (
        !job.external_claim_id &&
        ['creating', 'creating_uncertain', BUSINESS_CREATE_RESOLUTION_STATUSES.notCreated].includes(
          job.provider_status,
        )
      ) {
        const result = await syncOrderDelivery(job.order_id);
        if (result?.lastError) {
          throw deliveryError(result.lastError, 503, 'YANDEX_BUSINESS_STATUS_UNCERTAIN');
        }
      } else {
        const result = await syncDeliveryJob(job);
        if (
          result?.lastError &&
          result?.apiFamily === API_FAMILIES.BUSINESS &&
          result?.attentionRequired !== true
        ) {
          throw deliveryError(result.lastError, 503, 'YANDEX_BUSINESS_STATUS_UNCERTAIN');
        }
      }
      synced += 1;
    } catch (syncError) {
      failed += 1;
      await saveJobError(job, syncError);
      console.error(`Yandex delivery sync failed for ${job.id}:`, syncError.message);
    }
  }
  if (failed) {
    throw Object.assign(new Error(`Yandex delivery sync failed for ${failed} job(s)`), {
      code: 'YANDEX_DELIVERY_SYNC_PARTIAL_FAILURE',
      details: { synced, failed },
    });
  }
  return { skipped: false, synced, failed: 0 };
}

module.exports = {
  STATUS_LABELS,
  buildClaimPayload,
  buildQuotePayload,
  cancelDelivery,
  dispatchOrder,
  getCancellationInfo,
  getConfigurationStatus,
  isTerminalStatus,
  listJobsForOrders,
  mapYandexStatus,
  normalizeDeliveryJob,
  normalizeCity,
  quoteOrder,
  resolveBusinessCreateReconciliation,
  resolveBusinessDeliveryItems,
  syncActiveDeliveries,
  syncDeliveryJob,
  syncOrderDelivery,
  validateDeliveryOrder,
};
