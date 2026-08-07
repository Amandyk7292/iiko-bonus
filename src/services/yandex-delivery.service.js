const crypto = require('crypto');
const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');
const { isDeliveryFulfillment } = require('../utils/fulfillment.util');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const realtime = require('./realtime.service');

const API_PREFIX = '/b2b/cargo/integration/v2';
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
  return {
    enabled: env.YANDEX_DELIVERY_ENABLED === 'true',
    autoDispatch: env.YANDEX_DELIVERY_AUTO_DISPATCH === 'true',
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
  const missing = [];
  if (!config.enabled) missing.push('YANDEX_DELIVERY_ENABLED');
  if (!config.token) missing.push('YANDEX_DELIVERY_API_TOKEN');
  if (!config.senderPhone) missing.push('YANDEX_DELIVERY_SENDER_PHONE');
  return {
    enabled: config.enabled,
    configured: missing.length === 0,
    missing,
    autoDispatch: config.autoDispatch,
    taxiClass: config.taxiClass,
    cargoOptions: config.cargoOptions,
    automobileOnly: true,
    thermobagRequired: true,
  };
}

function assertConfigured(config = getConfig()) {
  if (!config.enabled) {
    throw deliveryError(
      'Яндекс.Доставка выключена в настройках сервера',
      503,
      'YANDEX_DELIVERY_DISABLED',
    );
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

function destinationAddress(order) {
  const raw =
    order.delivery_address && typeof order.delivery_address === 'object'
      ? order.delivery_address
      : {};
  const address = boundedString(raw.address || raw.fullname || raw.fullAddress || raw.label, 300);
  const city = boundedString(raw.city || order.bulka_locations?.city || 'Астана', 100);
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
  if (!isDeliveryFulfillment(order)) throw deliveryError('Заказ не относится к доставке', 409);
  if (order.courier_id) throw deliveryError('На заказ уже назначен курьер Bulka', 409);
  const branch = order.bulka_locations || {};
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
    order.additional_phone || order.phone || order.customers?.phone,
  );
  if (!customerPhone)
    throw deliveryError('У клиента указан некорректный телефон', 422, 'CUSTOMER_PHONE_REQUIRED');
  const destination = destinationAddress(order);
  if (!destination.fullname)
    throw deliveryError('У заказа не заполнен адрес доставки', 422, 'DELIVERY_ADDRESS_REQUIRED');
  if (!config.senderPhone) throw deliveryError('Не заполнен телефон пекарни для курьера', 503);
  return { branch, customerPhone, destination };
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
          city: boundedString(branch.city || 'Астана', 100),
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
  assertConfigured(config);
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

function mapYandexStatus(status) {
  if (['performer_found', 'pickup_arrived', 'ready_for_pickup_confirmation'].includes(status))
    return 'assigned';
  if (status === 'pickuped') return 'picked_up';
  if (['delivery_arrived', 'ready_for_delivery_confirmation'].includes(status)) return 'en_route';
  if (['delivered', 'delivered_finish'].includes(status)) return 'delivered';
  if (TERMINAL_STATUSES.has(status)) return 'cancelled';
  return 'unassigned';
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || ''));
}

function normalizeDeliveryJob(job) {
  if (!job) return null;
  const status = job.provider_status || 'draft';
  const car = [job.courier_car_color, job.courier_car_model, job.courier_car_number]
    .filter(Boolean)
    .join(' · ');
  const transportType = String(job.courier_transport_type || '').trim() || null;
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
    claimId: job.external_claim_id || null,
    status,
    statusLabel: STATUS_LABELS[status] || 'Статус обновляется',
    deliveryStatus: job.internal_status || mapYandexStatus(status),
    autoAccept: job.auto_accept === true,
    quotedPrice: job.quoted_price == null ? null : Number(job.quoted_price),
    price: job.provider_price == null ? null : Number(job.provider_price),
    currency: job.currency || 'KZT',
    etaMinutes: job.eta_minutes == null ? null : Number(job.eta_minutes),
    distanceMeters: job.distance_meters == null ? null : Number(job.distance_meters),
    trackingUrl: job.tracking_url || null,
    courier:
      job.courier_name || car || transportType
        ? {
            name: job.courier_name || 'Курьер Яндекс.Доставки',
            phone: job.courier_phone || '',
            vehicle: car || transportType || null,
            transportType,
            isAutomobile,
          }
        : null,
    automobileRequired: true,
    transportWarning:
      isAutomobile === false
        ? 'Назначен не автомобильный курьер. Передавать продукты запрещено.'
        : null,
    quoteExpiresAt: job.quote_expires_at || null,
    canCancel:
      Boolean(job.external_claim_id) &&
      !isTerminalStatus(status) &&
      !['pickuped', 'delivery_arrived', 'ready_for_delivery_confirmation'].includes(status),
    terminal: isTerminalStatus(status),
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
      'id,order_number,status,fulfillment_status,fulfillment_type,preorder_fulfillment_type,amount,phone,additional_phone,cart_items,comment,branch_id,branch_name,courier_id,delivery_address,delivery_latitude,delivery_longitude,customer_id,kitchen_status,courier_dispatch_requested_at,customers(name,phone),bulka_locations(id,name,city,address,latitude,longitude)',
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
  return jobs.find((job) => !isTerminalStatus(job.provider_status)) || null;
}

async function getOrCreateJob(order, requestPayload = {}) {
  const active = await findActiveJob(order.id);
  if (active) return active;
  const { data, error } = await supabase
    .from('delivery_jobs')
    .insert({
      order_id: order.id,
      provider: 'yandex',
      client_request_id: crypto.randomUUID(),
      provider_status: 'draft',
      internal_status: 'unassigned',
      request_payload: requestPayload,
    })
    .select('*')
    .single();
  if (!error) return data;
  if (error.code === '23505') {
    const raced = await findActiveJob(order.id);
    if (raced) return raced;
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

async function saveJobError(job, error) {
  const message = boundedString(error?.message || 'Неизвестная ошибка Яндекс.Доставки', 2000);
  return updateJob(job.id, { last_error: message, last_synced_at: new Date().toISOString() }).catch(
    () => job,
  );
}

async function quoteOrder(orderId) {
  const config = getConfig();
  assertConfigured(config);
  const order = await readOrder(orderId);
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
      'id,order_number,customer_id,fulfillment_status,delivery_status,courier_assigned_at,handed_to_courier_at,out_for_delivery_at,delivered_at',
    )
    .eq('id', job.order_id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return;
  const now = new Date().toISOString();
  const internal = job.internal_status || mapYandexStatus(job.provider_status);
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
  const { error } = await supabase.from('kaspi_orders').update(updates).eq('id', job.order_id);
  if (error) throw error;

  if (
    internal === 'delivered' &&
    !['completed', 'cancelled'].includes(current.fulfillment_status)
  ) {
    const { updateAdminOrderStatus } = require('./customer-order.service');
    await updateAdminOrderStatus(job.order_id, 'completed').catch((statusError) => {
      console.error('Yandex delivery order completion failed:', statusError.message);
    });
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

async function supplementaryCourierData(info, job, config) {
  if (!COURIER_VISIBLE_STATUSES.has(info.status)) return {};
  const updates = {};
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

async function syncDeliveryJob(jobOrId) {
  const config = getConfig();
  assertConfigured(config);
  let job = typeof jobOrId === 'string' ? await readJob(jobOrId) : jobOrId;
  if (!job?.external_claim_id || isTerminalStatus(job.provider_status))
    return normalizeDeliveryJob(job);
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
    job = await updateJob(job.id, updates);
    await updateOrderFromJob(job, info);
    return normalizeDeliveryJob(job);
  } catch (error) {
    await saveJobError(job, error);
    throw error;
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function dispatchOrder(orderId) {
  const config = getConfig();
  assertConfigured(config);
  const order = await readOrder(orderId);
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
  const payload = buildClaimPayload(order, config);
  let job = await getOrCreateJob(order, payload);
  if (!job.auto_accept || JSON.stringify(job.request_payload || {}) !== JSON.stringify(payload)) {
    job = await updateJob(job.id, {
      auto_accept: true,
      request_payload: payload,
      last_error: null,
    });
  }
  if (!job.external_claim_id) {
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
      await saveJobError(job, error);
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
    return normalizeDeliveryJob(latest);
  }
  return syncDeliveryJob(job);
}

async function getCancellationInfo(orderId) {
  const job = await findActiveJob(orderId);
  if (!job) throw deliveryError('Активная доставка не найдена', 404);
  if (!job.external_claim_id) {
    return { cancelState: 'free', price: 0, currency: job.currency || 'KZT' };
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
  if (!job.external_claim_id) {
    job = await updateJob(job.id, {
      provider_status: 'cancelled',
      internal_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      last_error: null,
    });
    await updateOrderFromJob(job, {});
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
  job = await updateJob(job.id, {
    provider_status:
      result.status || (terms.cancelState === 'paid' ? 'cancelled_with_payment' : 'cancelled'),
    internal_status: 'cancelled',
    external_version: result.version == null ? job.external_version : Number(result.version),
    cancelled_at: new Date().toISOString(),
    raw_response: result,
    last_error: null,
    last_synced_at: new Date().toISOString(),
  });
  await updateOrderFromJob(job, result);
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
  const status = getConfigurationStatus();
  if (!status.configured) return { skipped: true, reason: status.missing.join(', ') };
  const { data, error } = await supabase
    .from('delivery_jobs')
    .select('*')
    .eq('provider', 'yandex')
    .not('external_claim_id', 'is', null)
    .not('provider_status', 'in', `(${[...TERMINAL_STATUSES].join(',')})`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(Math.min(100, Math.max(1, Number(limit) || 25)));
  if (error) throw error;
  let synced = 0;
  let failed = 0;
  for (const job of data || []) {
    try {
      await syncDeliveryJob(job);
      synced += 1;
    } catch (syncError) {
      failed += 1;
      console.error(`Yandex delivery sync failed for ${job.id}:`, syncError.message);
    }
  }
  return { skipped: false, synced, failed };
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
  quoteOrder,
  syncActiveDeliveries,
  syncDeliveryJob,
  syncOrderDelivery,
};
