const businessApi = require('./yandex-business-api');
const { isDeliveryFulfillment } = require('../utils/fulfillment.util');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { deliveryDestination, deliveryCourierComment } = require('../utils/delivery-address.util');
const { cargoPriceLimit } = require('./yandex-cargo-price');

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
    cargoMaxPriceKzt: cargoPriceLimit(env.YANDEX_DELIVERY_MAX_PRICE_KZT),
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
    (config.apiMode === API_FAMILIES.CARGO
      ? !!config.cargoMaxPriceKzt
      : businessDispatchMissing.length === 0);
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
    maxPriceKzt:
      config.apiMode === API_FAMILIES.CARGO ? config.cargoMaxPriceKzt : config.business.maxPriceKzt,
    quoteMaxAgeSeconds: config.business.quoteMaxAgeSeconds,
    restaurantDeliveryConfirmed: config.business.restaurantDeliveryConfirmed,
    alertReceiverConfigured: config.opsAlertReceiver.configured,
    alertReceiverRequired: config.opsAlertReceiver.required,
    alertReceiverReady,
    alertWorkersEnabled: config.opsAlertReceiver.workersEnabled,
    deliverySyncWorkerEnabled: config.opsAlertReceiver.deliverySyncEnabled,
    dispatchMissing:
      config.apiMode === API_FAMILIES.BUSINESS
        ? businessDispatchMissing
        : config.cargoMaxPriceKzt
          ? []
          : ['YANDEX_DELIVERY_MAX_PRICE_KZT'],
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
  return deliveryDestination(raw, order.delivery_city);
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
    const orderedQuantity = Number(item.quantity) || 1;
    // Cargo quantities describe packages. A weighed line is one package with
    // its actual weight and the cost of that entire line, not a rounded kg count.
    const weighed = Number(item.quantityStep || 1) < 1;
    const quantity = weighed ? 1 : Math.min(99, Math.max(1, Math.round(orderedQuantity)));
    const size = {
      length: Number(item.deliveryLengthM || item.lengthM) || config.defaultItem.length,
      width: Number(item.deliveryWidthM || item.widthM) || config.defaultItem.width,
      height: Number(item.deliveryHeightM || item.heightM) || config.defaultItem.height,
    };
    const base = {
      size,
      weight: weighed
        ? orderedQuantity
        : Number(item.deliveryWeightKg || item.weightKg) || config.defaultItem.weight,
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
      cost_value: money(
        weighed ? (item.lineTotal ?? Math.round(Number(item.price) * orderedQuantity)) : item.price,
      ),
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
  const customerPhone = normalizeKazakhstanPhone(order.customers?.phone || order.phone);
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
  return cargoQuotePayload(branch, destination, order, config);
}

function cargoQuotePayload(branch, destination, order, config) {
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

// Checkout estimation creates neither a provider claim nor a delivery job.
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
  const { courierOrderHandoffNote } = require('../utils/order-handoff-note.util');
  const handoffNote = courierOrderHandoffNote(order);
  const comment = boundedString(
    [handoffNote, deliveryCourierComment(destination, order.comment)].filter(Boolean).join(' '),
    700,
  );
  const itemSummary = orderItemsSummary(order);
  const pickupComment = boundedString(
    [
      handoffNote,
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
          shortname: destination.shortname,
          coordinates: [Number(order.delivery_longitude), Number(order.delivery_latitude)],
          country: config.country,
          city: destination.city,
          ...(destination.house && { building: destination.house }),
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
      `${handoffNote} Забрать: ${itemSummary}. Только автомобиль, термосумка обязательна.`,
      7000,
    ),
    referral_source: 'bulka',
  };
}

module.exports = {
  API_FAMILIES,
  API_PREFIX,
  BUSINESS_CREATE_RESOLUTION_STATUSES,
  BUSINESS_ITEMS_RESOLUTION_STATUSES,
  BUSINESS_ITEMS_UNRESOLVED_STATUS,
  BUSINESS_POST_PICKUP_FAILURES,
  BUSINESS_RECONCILIATION_MAX_ATTEMPTS,
  COURIER_VISIBLE_STATUSES,
  NON_RETRYABLE_DELIVERY_CODES,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  assertConfigured,
  buildClaimPayload,
  buildQuotePayload,
  cargoItems,
  cargoQuotePayload,
  boundedString,
  deliveryError,
  destinationAddress,
  finiteCoordinate,
  getConfig,
  getConfigurationStatus,
  isPlainRecord,
  isUniqueViolation,
  money,
  normalizeBusinessProviderStatus,
  normalizeCity,
  numberFromEnv,
  orderItemsSummary,
  requiredCargoOptions,
  safeRawResponse,
  businessExternalOrderAlreadyBoundError,
  validateDeliveryOrder,
};
