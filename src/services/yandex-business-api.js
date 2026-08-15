const fetch = require('node-fetch');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');

const DEFAULT_BUSINESS_API_BASE_URL = 'https://b2b-api.go.yandex.ru/integration/2.0';
const DEFAULT_DELIVERY_CLASSES = Object.freeze(['express', 'courier']);
const BUSINESS_KNOWN_STATUSES = new Set([
  'search',
  'scheduling',
  'scheduled',
  'driving',
  'waiting',
  'transporting',
  'complete',
  'finished',
  'cancelled',
  'failed',
  'expired',
  // Local fail-closed states. Yandex never sends these values; they keep the
  // delivery reservation active until an owner records what happened to the
  // goods after a post-pickup cancellation.
  'cancelled_items_unresolved',
  'items_resolution_returned',
  'items_resolution_delivered',
  'creating_exhausted',
  'create_resolution_attaching',
  'create_resolution_not_created',
]);
const BUSINESS_TERMINAL_STATUSES = new Set(['complete', 'finished', 'cancelled', 'failed']);
const BUSINESS_STATUS_LABELS = Object.freeze({
  search: 'Ищем курьера',
  scheduling: 'Заказ планируется',
  scheduled: 'Заказ запланирован',
  driving: 'Курьер едет к отправителю',
  waiting: 'Курьер ожидает заказ',
  transporting: 'Курьер везёт заказ',
  complete: 'Заказ доставлен',
  finished: 'Заказ доставлен',
  cancelled: 'Доставка отменена',
  failed: 'Ошибка доставки',
  expired: 'Статус заказа неизвестен',
  cancelled_items_unresolved: 'Нужно уточнить, где заказ',
  items_resolution_returned: 'Фиксируем возврат заказа',
  items_resolution_delivered: 'Фиксируем доставку заказа',
  creating_exhausted: 'Нужно вручную проверить создание заказа',
  create_resolution_attaching: 'Проверяем найденный заказ Яндекса',
  create_resolution_not_created: 'Завершаем проверку отсутствующей заявки',
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const replaceControlCharacters = (value) =>
  [...String(value == null ? '' : value)]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('');

const boundedString = (value, maximum = 500) =>
  replaceControlCharacters(value).trim().slice(0, maximum);

// Operators often paste the complete header value into the environment. The
// API client adds the scheme itself, so accept and remove one optional scheme
// prefix here instead of sending the invalid `Bearer Bearer ...` value.
function normalizeOAuthToken(value) {
  let token = String(value == null ? '' : value).trim();
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token.replace(/^(?:Bearer|OAuth)\s+/i, '').trim();
}

const safeErrorCode = (value, fallback = 'YANDEX_BUSINESS_API_ERROR') => {
  const code = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 100);
  return code || fallback;
};

function businessApiError(message, statusCode, code, details = {}) {
  return Object.assign(new Error(boundedString(message, 700)), {
    statusCode,
    code: safeErrorCode(code),
    isYandexBusinessApiError: true,
    ...details,
  });
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_BUSINESS_API_BASE_URL).trim());
  } catch {
    throw businessApiError(
      'Некорректный адрес Yandex Business API',
      503,
      'YANDEX_BUSINESS_CONFIGURATION',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'b2b-api.go.yandex.ru' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/integration/2.0', ''].includes(url.pathname.replace(/\/+$/, '') || '/')
  ) {
    throw businessApiError(
      'Yandex Business API должен использовать защищённый HTTPS-адрес без учётных данных',
      503,
      'YANDEX_BUSINESS_CONFIGURATION',
    );
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname && pathname !== '/' ? pathname : '/integration/2.0';
  return url.toString().replace(/\/+$/, '');
}

function parsePreferredClasses(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const parsed = source
    .map((item) =>
      String(item || '')
        .trim()
        .toLowerCase(),
    )
    .filter((item) => /^[a-z0-9_-]{1,80}$/.test(item));
  return [...new Set(parsed.length ? parsed : DEFAULT_DELIVERY_CLASSES)];
}

function parseRequestedRequirements(value) {
  if (value == null || value === '') return {};
  let parsed = value;
  if (typeof value === 'string') {
    const source = value.trim();
    if (!source) return {};
    if (source.startsWith('{')) {
      try {
        parsed = JSON.parse(source);
      } catch {
        return {};
      }
    } else {
      return Object.fromEntries(
        source
          .split(',')
          .map((name) => name.trim())
          .filter((name) => /^[a-zA-Z0-9_-]{1,100}$/.test(name))
          .map((name) => [name, true]),
      );
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      ([name]) => /^[a-zA-Z0-9_-]{1,100}$/.test(name) && name !== '__proto__',
    ),
  );
}

function normalizeBusinessApiConfig(input = {}) {
  const timeout = Number(input.timeoutMs);
  const maxPrice = Number(input.maxPriceKzt);
  const quoteMaxAge = Number(input.quoteMaxAgeSeconds);
  const preferredClasses = parsePreferredClasses(
    input.preferredClasses || input.preferredClass || input.tariffClass || input.taxiClass,
  );
  return {
    enabled: input.enabled === true,
    token: normalizeOAuthToken(input.token),
    clientId: boundedString(input.clientId, 160),
    userId: boundedString(input.userId, 160),
    senderPhone: normalizeKazakhstanPhone(input.senderPhone),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    timeoutMs: Number.isFinite(timeout)
      ? Math.round(Math.min(30000, Math.max(1000, timeout)))
      : 15000,
    preferredClasses,
    tariffClass: preferredClasses[0],
    requirements: parseRequestedRequirements(input.requirements),
    maxPriceKzt: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null,
    quoteMaxAgeSeconds: Number.isFinite(quoteMaxAge)
      ? Math.round(Math.min(300, Math.max(30, quoteMaxAge)))
      : 120,
    allowPaidCancel: input.allowPaidCancel === true,
    restaurantDeliveryConfirmed: input.restaurantDeliveryConfirmed === true,
  };
}

function getBusinessApiConfigurationStatus(input = {}) {
  const config = normalizeBusinessApiConfig(input);
  const missing = [];
  if (!config.token) missing.push('YANDEX_BUSINESS_API_TOKEN');
  if (!config.clientId) missing.push('YANDEX_BUSINESS_CORP_CLIENT_ID');
  if (!config.userId) missing.push('YANDEX_BUSINESS_USER_ID');
  return {
    configured: missing.length === 0,
    missing,
    baseUrl: config.baseUrl,
    preferredClasses: config.preferredClasses,
    timeoutMs: config.timeoutMs,
  };
}

function getBusinessConfig(env = process.env) {
  return normalizeBusinessApiConfig({
    enabled:
      env.YANDEX_DELIVERY_ENABLED === 'true' &&
      String(env.YANDEX_DELIVERY_API_MODE || 'cargo_v2') === 'business_v2',
    token: env.YANDEX_BUSINESS_API_TOKEN,
    clientId: env.YANDEX_BUSINESS_CORP_CLIENT_ID,
    userId: env.YANDEX_BUSINESS_USER_ID,
    senderPhone: env.YANDEX_DELIVERY_SENDER_PHONE,
    baseUrl: env.YANDEX_BUSINESS_BASE_URL,
    timeoutMs: env.YANDEX_DELIVERY_TIMEOUT_MS,
    preferredClasses: env.YANDEX_BUSINESS_TARIFF_CLASS || 'express',
    // Business requirement names are account/zone/class specific. Never copy
    // Cargo API names by default; operators must use exact /zoneinfo keys.
    requirements: env.YANDEX_BUSINESS_REQUIRED_REQUIREMENTS || '',
    maxPriceKzt: env.YANDEX_BUSINESS_MAX_PRICE_KZT,
    quoteMaxAgeSeconds: env.YANDEX_BUSINESS_QUOTE_MAX_AGE_SECONDS,
    allowPaidCancel: env.YANDEX_BUSINESS_ALLOW_PAID_CANCEL === 'true',
    restaurantDeliveryConfirmed: env.YANDEX_BUSINESS_RESTAURANT_DELIVERY_CONFIRMED === 'true',
  });
}

function assertBusinessConfigured(input = {}) {
  const config = normalizeBusinessApiConfig(input);
  const missing = [];
  if (!config.token) missing.push('YANDEX_BUSINESS_API_TOKEN');
  if (!config.clientId) missing.push('YANDEX_BUSINESS_CORP_CLIENT_ID');
  if (!config.userId) missing.push('YANDEX_BUSINESS_USER_ID');
  if (missing.length) {
    throw businessApiError(
      `Не заполнены настройки Yandex Business: ${missing.join(', ')}`,
      503,
      'YANDEX_BUSINESS_NOT_CONFIGURED',
      { missing },
    );
  }
  return config;
}

const coordinateValue = (point, longName, shortName, index) => {
  if (Array.isArray(point)) return point[index];
  if (Array.isArray(point?.geopoint)) return point.geopoint[index];
  if (own(point, longName)) return point[longName];
  return point?.[shortName];
};

function buildGeopoint(point) {
  const longitude = Number(coordinateValue(point, 'longitude', 'lon', 0));
  const latitude = Number(coordinateValue(point, 'latitude', 'lat', 1));
  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw businessApiError(
      'Некорректные координаты маршрута',
      422,
      'YANDEX_BUSINESS_INVALID_COORDINATES',
    );
  }
  return [longitude, latitude];
}

function buildZoneCoordinates(point) {
  const [lon, lat] = buildGeopoint(point);
  return { lat, lon };
}

function routeFromInput({ route, origin, destination }) {
  const points = Array.isArray(route) && route.length ? route : [origin, destination];
  if (points.length < 2) {
    throw businessApiError(
      'Маршрут должен содержать точки отправления и назначения',
      422,
      'YANDEX_BUSINESS_INVALID_ROUTE',
    );
  }
  return points;
}

function buildRouteStatsPayload({
  route,
  origin,
  destination,
  userId,
  user_id,
  requirements,
} = {}) {
  const employeeId = boundedString(userId || user_id, 160);
  if (!employeeId) {
    throw businessApiError(
      'Не указан сотрудник Yandex Business',
      503,
      'YANDEX_BUSINESS_USER_REQUIRED',
    );
  }
  const safeRequirements = parseRequestedRequirements(requirements);
  return {
    route: routeFromInput({ route, origin, destination }).map(buildGeopoint),
    user_id: employeeId,
    ...(Object.keys(safeRequirements).length ? { requirements: safeRequirements } : {}),
  };
}

function buildOrderRoutePoint(point) {
  const fullname = boundedString(point?.fullname || point?.address || point?.label, 500);
  if (!fullname) {
    throw businessApiError(
      'Для каждой точки маршрута нужен полный адрес',
      422,
      'YANDEX_BUSINESS_ADDRESS_REQUIRED',
    );
  }
  const porchNumber = boundedString(point?.porchnumber, 40);
  const premiseNumber = boundedString(point?.premisenumber, 40);
  const sourceExtraData =
    point?.extra_data && typeof point.extra_data === 'object' ? point.extra_data : {};
  const contactPhone = normalizeKazakhstanPhone(sourceExtraData.contact_phone);
  const extraData = {
    ...(contactPhone ? { contact_phone: contactPhone } : {}),
    ...(boundedString(sourceExtraData.floor, 30)
      ? { floor: boundedString(sourceExtraData.floor, 30) }
      : {}),
    ...(boundedString(sourceExtraData.apartment, 40)
      ? { apartment: boundedString(sourceExtraData.apartment, 40) }
      : {}),
    ...(boundedString(sourceExtraData.comment, 500)
      ? { comment: boundedString(sourceExtraData.comment, 500) }
      : {}),
  };
  return {
    geopoint: buildGeopoint(point),
    fullname,
    ...(porchNumber ? { porchnumber: porchNumber } : {}),
    ...(premiseNumber ? { premisenumber: premiseNumber } : {}),
    ...(Object.keys(extraData).length ? { extra_data: extraData } : {}),
  };
}

function normalizeCostCenters(values) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, 30)
    .map((item) => ({
      id: boundedString(item?.id, 160),
      title: boundedString(item?.title, 300),
      value: boundedString(item?.value, 500),
    }))
    .filter((item) => item.id && item.title && item.value);
}

function buildOrderCreatePayload({
  route,
  origin,
  destination,
  userId,
  user_id,
  className,
  class: tariffClass,
  offer,
  requirements,
  comment,
  dueDate,
  due_date,
  costCenterValues,
  cost_center_values,
} = {}) {
  const employeeId = boundedString(userId || user_id, 160);
  const selectedClass = boundedString(className || tariffClass, 80).toLowerCase();
  if (!employeeId) {
    throw businessApiError(
      'Не указан сотрудник Yandex Business',
      503,
      'YANDEX_BUSINESS_USER_REQUIRED',
    );
  }
  if (!/^[a-z0-9_-]+$/.test(selectedClass)) {
    throw businessApiError(
      'Не выбран доступный тариф Yandex Business',
      422,
      'YANDEX_BUSINESS_CLASS_REQUIRED',
    );
  }
  const safeRequirements = parseRequestedRequirements(requirements);
  const costCenters = normalizeCostCenters(costCenterValues || cost_center_values);
  const safeComment = boundedString(comment, 1000);
  const safeOffer = boundedString(offer, 500);
  const scheduledAt = boundedString(dueDate || due_date, 50);
  return {
    user_id: employeeId,
    route: routeFromInput({ route, origin, destination }).map(buildOrderRoutePoint),
    class: selectedClass,
    ...(safeOffer ? { offer: safeOffer } : {}),
    ...(Object.keys(safeRequirements).length ? { requirements: safeRequirements } : {}),
    ...(costCenters.length ? { cost_center_values: costCenters } : {}),
    ...(safeComment ? { comment: safeComment } : {}),
    ...(scheduledAt ? { due_date: scheduledAt } : {}),
  };
}

const addressText = (city, address) => {
  const safeCity = boundedString(city, 120);
  const safeAddress = boundedString(address, 500);
  if (
    safeCity &&
    safeAddress.toLocaleLowerCase('ru-RU').includes(safeCity.toLocaleLowerCase('ru-RU'))
  ) {
    return safeAddress;
  }
  return [safeCity, safeAddress].filter(Boolean).join(', ');
};

function buildBusinessRoute(order, input = {}) {
  const config = normalizeBusinessApiConfig(input);
  const branch = order?.bulka_locations || {};
  const rawDestination =
    order?.delivery_address && typeof order.delivery_address === 'object'
      ? order.delivery_address
      : { address: order?.delivery_address };
  const destinationCity = rawDestination.city || branch.city;
  const courierComment = [rawDestination.comment, order?.comment]
    .map((value) => boundedString(value, 300))
    .filter(Boolean)
    .join('. ')
    .slice(0, 500);
  return [
    buildOrderRoutePoint({
      longitude: branch.longitude,
      latitude: branch.latitude,
      fullname: addressText(branch.city, branch.address || branch.full_address || branch.name),
      extra_data: { contact_phone: config.senderPhone },
    }),
    buildOrderRoutePoint({
      longitude: order?.delivery_longitude,
      latitude: order?.delivery_latitude,
      fullname: addressText(
        destinationCity,
        rawDestination.address ||
          rawDestination.fullname ||
          rawDestination.fullAddress ||
          rawDestination.label,
      ),
      porchnumber: rawDestination.entrance || rawDestination.porch,
      premisenumber: rawDestination.premisenumber,
      extra_data: {
        contact_phone: order?.additional_phone || order?.phone || order?.customers?.phone,
        floor: rawDestination.floor,
        apartment: rawDestination.apartment || rawDestination.flat,
        comment: courierComment,
      },
    }),
  ];
}

function buildBusinessQuotePayload(order, input = {}, requirements) {
  const config = normalizeBusinessApiConfig(input);
  return buildRouteStatsPayload({
    route: buildBusinessRoute(order, config),
    userId: config.userId,
    requirements: requirements ?? config.requirements,
  });
}

function buildBusinessCreatePayload(
  order,
  input = {},
  { offer, requirements, className, comment } = {},
) {
  const config = normalizeBusinessApiConfig(input);
  const addressComment =
    order?.delivery_address && typeof order.delivery_address === 'object'
      ? boundedString(order.delivery_address.comment, 500)
      : '';
  const customerOrderComment = boundedString(order?.comment, 500);
  const orderComment = boundedString(
    comment ||
      [
        `Bulka, заказ №${order?.order_number || order?.id || ''}`,
        addressComment,
        customerOrderComment,
      ]
        .filter(Boolean)
        .join('. '),
    1000,
  );
  return buildOrderCreatePayload({
    route: buildBusinessRoute(order, config),
    userId: config.userId,
    className: className || config.preferredClasses[0],
    offer,
    requirements: requirements ?? config.requirements,
    comment: orderComment,
  });
}

function parseLocalizedPrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const source = String(value == null ? '' : value).trim();
  if (!source || source.length > 100 || /-/.test(source)) return null;
  const matches = source.match(/[0-9][0-9\s\u00a0\u202f'.,]*/g);
  if (!matches || matches.length !== 1) return null;
  let numeric = matches[0].replace(/[\s\u00a0\u202f']/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(numeric)) return null;

  const comma = numeric.lastIndexOf(',');
  const dot = numeric.lastIndexOf('.');
  let decimalSeparator = null;
  if (comma >= 0 && dot >= 0) {
    decimalSeparator = comma > dot ? ',' : '.';
    if (numeric.length - Math.max(comma, dot) - 1 > 2) return null;
  } else {
    const separator = comma >= 0 ? ',' : dot >= 0 ? '.' : null;
    if (separator) {
      const groups = numeric.split(separator);
      const fractionalDigits = groups.at(-1).length;
      if (groups.length === 2 && fractionalDigits >= 1 && fractionalDigits <= 2) {
        decimalSeparator = separator;
      } else if (!(groups[0].length >= 1 && groups.slice(1).every((group) => group.length === 3))) {
        return null;
      }
    }
  }

  if (decimalSeparator) {
    const decimalIndex = numeric.lastIndexOf(decimalSeparator);
    const integerPart = numeric.slice(0, decimalIndex).replace(/[.,]/g, '');
    const fractionPart = numeric.slice(decimalIndex + 1);
    numeric = `${integerPart}.${fractionPart}`;
  } else {
    numeric = numeric.replace(/[.,]/g, '');
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}

function tariffClasses(zoneInfo) {
  return Array.isArray(zoneInfo?.tariff_classes) ? zoneInfo.tariff_classes : [];
}

function serviceLevels(routeStats) {
  return Array.isArray(routeStats?.service_levels) ? routeStats.service_levels : [];
}

function pickAvailableDeliveryClass(zoneInfo, routeStats, preferredClasses) {
  const preferred = parsePreferredClasses(preferredClasses);
  const zoneNames = new Set(
    tariffClasses(zoneInfo)
      .map((item) => String(item?.name || ''))
      .filter(Boolean),
  );
  const quotedNames = new Set(
    serviceLevels(routeStats)
      .map((item) => String(item?.class || ''))
      .filter(Boolean),
  );
  return preferred.find((name) => zoneNames.has(name) && quotedNames.has(name)) || null;
}

function selectAvailableServiceLevel(zoneInfo, routeStats, preferredClasses) {
  const className = pickAvailableDeliveryClass(zoneInfo, routeStats, preferredClasses);
  if (!className) return null;
  const tariffClass = tariffClasses(zoneInfo).find((item) => item?.name === className) || null;
  const serviceLevel = serviceLevels(routeStats).find((item) => item?.class === className) || null;
  return {
    className,
    price: parseLocalizedPrice(serviceLevel?.price),
    isFixedPrice: serviceLevel?.is_fixed_price === true,
    tariffClass,
    serviceLevel,
  };
}

function selectBusinessQuote(zoneInfo, routeStats, input = {}) {
  const config = normalizeBusinessApiConfig(input);
  const selected = selectAvailableServiceLevel(zoneInfo, routeStats, config.preferredClasses);
  if (!selected) return null;
  return {
    ...selected,
    offer: boundedString(routeStats?.offer, 500) || null,
    currency: boundedString(zoneInfo?.currency_code, 12) || null,
    requirements: filterSupportedRequirements(
      config.requirements,
      selected.tariffClass,
      selected.className,
    ),
  };
}

const selectDefinition = (definition, value) => {
  const options = Array.isArray(definition?.select?.options) ? definition.select.options : [];
  const byName = new Map(options.map((option) => [option?.name, option?.value]));
  const normalize = (item) => (byName.has(item) ? byName.get(item) : item);
  const normalized = Array.isArray(value) ? value.map(normalize) : normalize(value);
  const expectedType = definition?.select?.type;
  if (Array.isArray(normalized)) {
    if (!definition?.multiselect || !normalized.length) return undefined;
    if (expectedType === 'number' && !normalized.every((item) => Number.isFinite(item)))
      return undefined;
    if (expectedType === 'string' && !normalized.every((item) => typeof item === 'string'))
      return undefined;
    return normalized;
  }
  if (expectedType === 'number' && !Number.isFinite(normalized)) return undefined;
  if (expectedType === 'string' && typeof normalized !== 'string') return undefined;
  return ['number', 'string', 'boolean'].includes(typeof normalized) ? normalized : undefined;
};

function filterSupportedRequirements(requested, zoneInfoOrTariff, className) {
  const safeRequested = parseRequestedRequirements(requested);
  const tariff = Array.isArray(zoneInfoOrTariff?.supported_requirements)
    ? zoneInfoOrTariff
    : tariffClasses(zoneInfoOrTariff).find((item) => item?.name === className);
  const definitions = Array.isArray(tariff?.supported_requirements)
    ? tariff.supported_requirements
    : [];
  const supported = new Map(
    definitions
      .filter((definition) => typeof definition?.name === 'string')
      .map((definition) => [definition.name, definition]),
  );
  const result = [];
  for (const [name, value] of Object.entries(safeRequested)) {
    const definition = supported.get(name);
    if (!definition) continue;
    if (definition.type === 'boolean') {
      if (typeof value === 'boolean') result.push([name, value]);
      continue;
    }
    if (definition.type === 'select') {
      const selected = selectDefinition(definition, value);
      if (selected !== undefined) result.push([name, selected]);
    }
  }
  return Object.fromEntries(result);
}

function mapBusinessStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['scheduled', 'driving', 'waiting'].includes(value)) return 'assigned';
  if (value === 'transporting') return 'en_route';
  if (['complete', 'finished'].includes(value)) return 'delivered';
  if (['cancelled', 'failed'].includes(value)) return 'cancelled';
  if (
    [
      'cancelled_items_unresolved',
      'items_resolution_returned',
      'items_resolution_delivered',
    ].includes(value)
  )
    return 'en_route';
  return 'unassigned';
}

function isBusinessTerminalStatus(status) {
  return BUSINESS_TERMINAL_STATUSES.has(String(status || '').toLowerCase());
}

function isBusinessKnownStatus(status) {
  return BUSINESS_KNOWN_STATUSES.has(String(status || '').toLowerCase());
}

function normalizeBusinessOrderInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const statusCandidate = boundedString(info.status, 80).toLowerCase();
  const status = statusCandidate
    ? /^[a-z0-9_]{1,80}$/.test(statusCandidate)
      ? statusCandidate
      : 'unknown'
    : '';
  const performer = info.performer && typeof info.performer === 'object' ? info.performer : {};
  const vehicle =
    performer.vehicle && typeof performer.vehicle === 'object' ? performer.vehicle : {};
  const rules = info.cancel_rules && typeof info.cancel_rules === 'object' ? info.cancel_rules : {};
  const cancelState = ['free', 'paid', 'minimal'].includes(String(rules.state))
    ? String(rules.state)
    : null;
  return {
    externalOrderId: boundedString(info.id || info.order_id, 160) || null,
    userId: boundedString(info.user_id, 160) || null,
    providerStatus: status || null,
    statusLabel: BUSINESS_STATUS_LABELS[status] || 'Статус уточняется',
    internalStatus: mapBusinessStatus(status),
    terminal: isBusinessTerminalStatus(status),
    dueDate: boundedString(info.due_date, 80) || null,
    finishedDate: boundedString(info.finished_date, 80) || null,
    price: parseLocalizedPrice(info.cost),
    priceWithVat: parseLocalizedPrice(info.cost_with_vat),
    courier: {
      name: boundedString(performer.fullname, 200) || null,
      phone: boundedString(performer.phone, 40) || null,
      vehicle: {
        model: boundedString(vehicle.model, 120) || null,
        number: boundedString(vehicle.number, 40) || null,
        color: boundedString(vehicle.color, 80) || null,
      },
    },
    cancelRules: {
      canCancel: rules.can_cancel === true,
      state: cancelState,
      requiresPaymentConfirmation: cancelState === 'paid' || cancelState === 'minimal',
      title: boundedString(rules.title, 300) || null,
      message: boundedString(rules.message, 500) || null,
    },
  };
}

function normalizeBusinessOrderProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const location = progress?.vehicle?.location;
  let vehicleLocation = null;
  if (Array.isArray(location) && location.length >= 2) {
    try {
      vehicleLocation = buildGeopoint(location);
    } catch {
      vehicleLocation = null;
    }
  }
  const seconds = Number(progress.time_left_raw);
  const statusCandidate = boundedString(progress.status, 80).toLowerCase();
  const status = statusCandidate
    ? /^[a-z0-9_]{1,80}$/.test(statusCandidate)
      ? statusCandidate
      : 'unknown'
    : '';
  return {
    providerStatus: status || null,
    internalStatus: mapBusinessStatus(status),
    terminal: isBusinessTerminalStatus(status),
    timeLeftSeconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null,
    vehicleLocation,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertHeaderValue(value, label, maximum = 200) {
  const raw = String(value || '');
  const hasControlCharacter = [...raw].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!raw || raw.length > maximum || hasControlCharacter) {
    throw businessApiError(
      `Некорректное значение настройки ${label}`,
      503,
      'YANDEX_BUSINESS_CONFIGURATION',
    );
  }
  return raw;
}

async function businessApiRequest(
  path,
  {
    method = 'GET',
    body,
    query = {},
    config: input = getBusinessConfig(),
    idempotencyToken,
    includeClient = true,
    fetchImpl = fetch,
  } = {},
) {
  const config = normalizeBusinessApiConfig(input);
  if (!/^\/[a-z0-9/_-]+$/i.test(String(path || ''))) {
    throw businessApiError(
      'Некорректный путь Yandex Business API',
      500,
      'YANDEX_BUSINESS_INVALID_PATH',
    );
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const token = assertHeaderValue(config.token, 'API token', 8192);
  if (path === '/orders/create' && !uuidPattern.test(String(idempotencyToken || ''))) {
    throw businessApiError(
      'Для создания заказа нужен UUID-токен идемпотентности',
      422,
      'YANDEX_BUSINESS_IDEMPOTENCY_REQUIRED',
    );
  }

  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Accept-Language': 'ru',
    'X-Request-Language': 'ru',
  };
  if (includeClient) {
    headers['X-YaTaxi-Selected-Corp-Client-Id'] = assertHeaderValue(
      config.clientId,
      'client ID',
      160,
    );
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyToken) headers['X-Idempotency-Token'] = String(idempotencyToken);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const uncertain = path === '/orders/create';
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const responseText = await response.text();
    let payload = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        // Provider error bodies can echo route/contact data. They are never
        // copied into an exception that may be logged or stored in the DB.
        payload = {};
      }
    }
    if (!response.ok) {
      // Even a nominal provider "code" is untrusted and can contain echoed
      // contact/address data. The HTTP class is sufficient for retry policy.
      const providerCode = `YANDEX_BUSINESS_HTTP_${response.status}`;
      const providerRequestIdRaw =
        response.headers?.get?.('x-ya-request-id') ||
        response.headers?.get?.('x-request-id') ||
        response.headers?.get?.('x-ya-trace-id') ||
        response.headers?.get?.('trace-id') ||
        null;
      const providerRequestId = providerRequestIdRaw
        ? boundedString(providerRequestIdRaw, 160).replace(/[^A-Za-z0-9._:-]/g, '_') || null
        : null;
      const statusCode = [401, 403, 429].includes(response.status)
        ? 503
        : response.status >= 500
          ? 502
          : 422;
      throw businessApiError(
        `Yandex Business API отклонил запрос (HTTP ${response.status}, ${providerCode})${
          providerRequestId ? `, Request ID ${providerRequestId}` : ''
        }`,
        statusCode,
        providerCode,
        {
          providerStatus: response.status,
          ...(providerRequestId ? { providerRequestId } : {}),
          ...(uncertain && ![400, 403, 404, 406].includes(response.status)
            ? { uncertain: true }
            : {}),
        },
      );
    }
    return payload;
  } catch (error) {
    if (error?.isYandexBusinessApiError) throw error;
    if (error?.name === 'AbortError') {
      throw businessApiError(
        uncertain
          ? 'Yandex Business API не ответил вовремя; заказ мог быть создан, повторите запрос с тем же токеном идемпотентности'
          : 'Yandex Business API не ответил вовремя',
        504,
        'YANDEX_BUSINESS_TIMEOUT',
        uncertain ? { uncertain: true } : {},
      );
    }
    throw businessApiError(
      'Yandex Business API недоступен из-за ошибки соединения',
      502,
      'YANDEX_BUSINESS_NETWORK_ERROR',
      uncertain ? { uncertain: true } : {},
    );
  } finally {
    clearTimeout(timeout);
  }
}

const requiredQueryId = (value, code, label = 'ID заказа') => {
  const id = boundedString(value, 160);
  if (!id) throw businessApiError(`Не указан ${label}`, 422, code);
  return id;
};

function createBusinessApiClient(input = {}, dependencies = {}) {
  const config = normalizeBusinessApiConfig(input);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const request = (path, options) => businessApiRequest(path, { ...options, config, fetchImpl });

  return Object.freeze({
    listClients: () => request('/auth/list', { includeClient: false }),
    getZoneInfo: (point) => request('/zoneinfo', { query: buildZoneCoordinates(point) }),
    getRouteStats: (payload) => request('/orders/routestats', { method: 'POST', body: payload }),
    createOrder: (payload, options = {}) =>
      request('/orders/create', {
        method: 'POST',
        body: payload,
        idempotencyToken:
          typeof options === 'string' ? options : String(options.idempotencyToken || ''),
      }),
    getOrderProgress: (orderId) =>
      request('/orders/progress', {
        query: { order_id: requiredQueryId(orderId, 'YANDEX_BUSINESS_ORDER_ID_REQUIRED') },
      }),
    getOrderInfo: (orderId) =>
      request('/orders/info', {
        query: { order_id: requiredQueryId(orderId, 'YANDEX_BUSINESS_ORDER_ID_REQUIRED') },
      }),
    getActiveOrders: (userId = config.userId) =>
      request('/orders/active', {
        query: {
          user_id: requiredQueryId(userId, 'YANDEX_BUSINESS_USER_REQUIRED', 'ID сотрудника'),
        },
      }),
    cancelOrder: (orderId, state) => {
      const cancelState = String(state || '');
      if (!['free', 'paid', 'minimal'].includes(cancelState)) {
        throw businessApiError(
          'Сначала получите допустимое правило отмены заказа',
          422,
          'YANDEX_BUSINESS_CANCEL_STATE_REQUIRED',
        );
      }
      return request('/orders/cancel', {
        method: 'POST',
        query: { order_id: requiredQueryId(orderId, 'YANDEX_BUSINESS_ORDER_ID_REQUIRED') },
        body: { state: cancelState },
      });
    },
  });
}

module.exports = {
  BUSINESS_KNOWN_STATUSES,
  BUSINESS_STATUS_LABELS,
  BUSINESS_TERMINAL_STATUSES,
  DEFAULT_BUSINESS_API_BASE_URL,
  DEFAULT_DELIVERY_CLASSES,
  assertBusinessConfigured,
  buildGeopoint,
  buildBusinessCreatePayload,
  buildBusinessQuotePayload,
  buildBusinessRoute,
  buildOrderCreatePayload,
  buildOrderRoutePoint,
  buildRouteStatsPayload,
  buildZoneCoordinates,
  businessApiRequest,
  createBusinessApiClient,
  filterSupportedRequirements,
  getBusinessConfig,
  getBusinessApiConfigurationStatus,
  isBusinessKnownStatus,
  isBusinessTerminalStatus,
  mapBusinessStatus,
  normalizeBusinessInfo: normalizeBusinessOrderInfo,
  normalizeOAuthToken,
  normalizeBusinessOrderInfo,
  normalizeBusinessOrderProgress,
  parseLocalizedPrice,
  parsePreferredClasses,
  parseRequestedRequirements,
  pickAvailableDeliveryClass,
  selectBusinessQuote,
  selectAvailableServiceLevel,
};
