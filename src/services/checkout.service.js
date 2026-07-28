const ORDER_TYPES = new Set(['pickup', 'delivery', 'preorder']);

const checkoutError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const boundedText = (value, maxLength) =>
  String(value || '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const normalizeOrderType = (value) => {
  const normalized = String(value || 'pickup')
    .trim()
    .toLowerCase();
  if (!ORDER_TYPES.has(normalized)) throw checkoutError('Некорректный способ получения заказа');
  return normalized;
};

const parseDeliveryZone = (env = process.env) => {
  const source = String(env.DELIVERY_ZONE_POLYGON_JSON || '').trim();
  if (!source) return null;
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw checkoutError('Зона доставки настроена некорректно', 503);
  }
  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw checkoutError('Зона доставки настроена некорректно', 503);
  }
  const points = parsed.map((point) => {
    const latitude = finiteNumber(
      Array.isArray(point) ? point[0] : (point?.latitude ?? point?.lat),
    );
    const longitude = finiteNumber(
      Array.isArray(point) ? point[1] : (point?.longitude ?? point?.lng ?? point?.lon),
    );
    if (
      latitude === null ||
      longitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw checkoutError('Зона доставки настроена некорректно', 503);
    }
    return [latitude, longitude];
  });
  return points;
};

const isPointOnSegment = (latitude, longitude, first, second) => {
  const cross =
    (longitude - first[1]) * (second[0] - first[0]) -
    (latitude - first[0]) * (second[1] - first[1]);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    latitude >= Math.min(first[0], second[0]) - 1e-10 &&
    latitude <= Math.max(first[0], second[0]) + 1e-10 &&
    longitude >= Math.min(first[1], second[1]) - 1e-10 &&
    longitude <= Math.max(first[1], second[1]) + 1e-10
  );
};

function isPointInPolygon(latitude, longitude, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const first = polygon[index];
    const second = polygon[previous];
    if (isPointOnSegment(latitude, longitude, first, second)) return true;
    const intersects =
      first[1] > longitude !== second[1] > longitude &&
      latitude <
        ((second[0] - first[0]) * (longitude - first[1])) / (second[1] - first[1]) + first[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

const normalizeDeliveryAddress = (raw, env = process.env) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw checkoutError('Укажите адрес доставки');
  }
  const latitude = finiteNumber(raw.latitude ?? raw.lat);
  const longitude = finiteNumber(raw.longitude ?? raw.lng ?? raw.lon);
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw checkoutError('У адреса доставки некорректные координаты');
  }
  const configuredPolygon = parseDeliveryZone(env);
  if (configuredPolygon && !isPointInPolygon(latitude, longitude, configuredPolygon)) {
    throw checkoutError('Адрес находится вне зоны доставки');
  }

  const address = boundedText(raw.address ?? raw.formattedAddress ?? raw.label, 500);
  const city = boundedText(raw.city || 'Астана', 100);
  if (address.length < 3) throw checkoutError('Укажите полный адрес доставки');
  if (!city) throw checkoutError('Укажите город доставки');

  return {
    label: boundedText(raw.label ?? raw.title, 120) || null,
    city,
    address,
    latitude,
    longitude,
    entrance: boundedText(raw.entrance, 30) || null,
    floor: boundedText(raw.floor, 20) || null,
    apartment: boundedText(raw.apartment, 30) || null,
    house: boundedText(raw.house, 30) || null,
    comment: boundedText(raw.comment ?? raw.courierComment, 300) || null,
  };
};

const branchLabel = (point) => [point?.name, point?.address].filter(Boolean).join(', ');

const normalizeBranchZones = (point) => {
  const raw = Array.isArray(point?.deliveryZones)
    ? point.deliveryZones
    : Array.isArray(point?.delivery_zones)
      ? point.delivery_zones
      : [];
  const zones = raw
    .map((zone, index) => ({
      id: boundedText(zone?.id || `zone-${index + 1}`, 64),
      radiusKm: finiteNumber(zone?.radiusKm ?? zone?.radius_km),
      fee: finiteNumber(zone?.fee),
      minOrder: finiteNumber(zone?.minOrder ?? zone?.min_order),
      color: boundedText(zone?.color, 16) || null,
    }))
    .filter(
      (zone) =>
        zone.radiusKm !== null &&
        zone.radiusKm > 0 &&
        zone.fee !== null &&
        zone.fee >= 0 &&
        zone.minOrder !== null &&
        zone.minOrder >= 0,
    )
    .sort((first, second) => first.radiusKm - second.radiusKm);
  if (zones.length > 0) return zones;
  const radiusKm = finiteNumber(point?.deliveryRadiusKm ?? point?.delivery_radius_km);
  const fee = finiteNumber(point?.deliveryFee ?? point?.delivery_fee);
  const minOrder = finiteNumber(point?.deliveryMinOrder ?? point?.delivery_min_order);
  return radiusKm !== null &&
    radiusKm > 0 &&
    fee !== null &&
    fee >= 0 &&
    minOrder !== null &&
    minOrder >= 0
    ? [{ id: 'zone-1', radiusKm, fee, minOrder, color: null }]
    : [];
};

const flattenBranches = (cities) =>
  (Array.isArray(cities) ? cities : []).flatMap((city) =>
    (Array.isArray(city?.points) ? city.points : []).map((point) => ({
      ...point,
      cityName: city.name || '',
      label: branchLabel(point),
      latitude: finiteNumber(point.latitude),
      longitude: finiteNumber(point.longitude),
      active: point.active !== false,
      pickupEnabled: point.pickupEnabled ?? point.pickup_enabled ?? true,
      preorderEnabled: point.preorderEnabled ?? point.preorder_enabled ?? true,
      deliveryEnabled: point.deliveryEnabled ?? point.delivery_enabled ?? false,
      deliveryRadiusKm: finiteNumber(point.deliveryRadiusKm ?? point.delivery_radius_km),
      deliveryFee: finiteNumber(point.deliveryFee ?? point.delivery_fee),
      deliveryMinOrder: finiteNumber(point.deliveryMinOrder ?? point.delivery_min_order),
      deliveryZones: normalizeBranchZones(point),
      slotMinutes: finiteNumber(point.slotMinutes ?? point.slot_minutes) || 60,
      hours: point.hours && typeof point.hours === 'object' ? point.hours : {},
    })),
  );

const haversineDistance = (first, second) => {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const deliveryZoneForDistance = (point, distance) =>
  point.deliveryZones.find((zone) => distance <= zone.radiusKm) || null;

const withResolvedDeliveryZone = (point, zone, distance) => ({
  ...point,
  deliveryFee: zone.fee,
  deliveryMinOrder: zone.minOrder,
  resolvedDeliveryZone: { ...zone, distanceKm: Number(distance.toFixed(3)) },
});

const resolveBranch = (
  { branchId, branch, orderType, deliveryAddress, requiresPreorder = false },
  cities,
) => {
  const branches = flattenBranches(cities).filter((point) => point.active);
  if (branches.length === 0) throw checkoutError('Филиалы временно недоступны', 503);

  let selected;
  const normalizedBranchId = String(branchId || '').trim();
  if (normalizedBranchId) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        normalizedBranchId,
      )
    ) {
      throw checkoutError('Некорректный филиал');
    }
    selected = branches.find((point) => String(point.id) === normalizedBranchId);
  }
  const normalizedBranch = boundedText(branch, 160).toLocaleLowerCase('ru-RU');
  if (!selected && normalizedBranch) {
    selected = branches.find(
      (point) =>
        point.label.toLocaleLowerCase('ru-RU') === normalizedBranch ||
        String(point.name || '').toLocaleLowerCase('ru-RU') === normalizedBranch ||
        String(point.address || '').toLocaleLowerCase('ru-RU') === normalizedBranch,
    );
  }
  if (orderType === 'delivery') {
    const configured = branches.filter(
      (point) =>
        point.deliveryEnabled &&
        (!requiresPreorder || point.preorderEnabled) &&
        point.latitude !== null &&
        point.longitude !== null &&
        point.deliveryZones.length > 0,
    );
    if (configured.length === 0) {
      throw checkoutError('Доставка пока не настроена ни для одного филиала', 503);
    }
    if (selected) {
      if (!configured.includes(selected)) {
        throw checkoutError('Доставка из выбранного филиала сейчас недоступна');
      }
      const distance = haversineDistance(deliveryAddress, selected);
      const zone = deliveryZoneForDistance(selected, distance);
      if (!zone) {
        throw checkoutError('Адрес находится вне зоны доставки выбранного филиала');
      }
      selected = withResolvedDeliveryZone(selected, zone, distance);
    } else {
      selected = configured
        .map((point) => {
          const distance = haversineDistance(deliveryAddress, point);
          return { point, distance, zone: deliveryZoneForDistance(point, distance) };
        })
        .filter(({ zone }) => zone !== null)
        .sort((left, right) => left.distance - right.distance)[0]?.point;
      if (!selected) throw checkoutError('Адрес находится вне зоны доставки');
      const distance = haversineDistance(deliveryAddress, selected);
      selected = withResolvedDeliveryZone(
        selected,
        deliveryZoneForDistance(selected, distance),
        distance,
      );
    }
  } else if (selected) {
    const enabled =
      orderType === 'preorder' || requiresPreorder
        ? selected.preorderEnabled
        : selected.pickupEnabled;
    if (!enabled) {
      throw checkoutError(
        orderType === 'preorder' || requiresPreorder
          ? 'Предзаказ в выбранном филиале недоступен'
          : 'Самовывоз из выбранного филиала недоступен',
      );
    }
  }
  if (!selected) throw checkoutError('Выбранный филиал больше недоступен');
  return selected;
};

const parseClock = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute !== 0)) {
    return null;
  }
  return hour * 60 + minute;
};

const branchHoursFor = (hours, localDate) => {
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][localDate.getUTCDay()];
  const schedule = hours?.[day] ?? hours?.daily;
  if (!schedule || typeof schedule !== 'object' || schedule.closed === true) return null;
  const open = parseClock(schedule.open);
  const close = parseClock(schedule.close);
  if (open === null || close === null || open >= close) return null;
  return { open, close };
};

const validateBranchHours = (instant, hours, offsetMinutes, slotMinutes = 60) => {
  const local = new Date(instant.getTime() + offsetMinutes * 60 * 1000);
  const schedule = branchHoursFor(hours, local);
  if (!schedule) throw checkoutError('Расписание выбранного филиала не настроено', 503);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const interval =
    Number.isInteger(slotMinutes) && slotMinutes >= 15 && slotMinutes <= 240 ? slotMinutes : 60;
  const firstSlot = Math.ceil(schedule.open / interval) * interval;
  if (
    minute < firstSlot ||
    minute + interval > schedule.close ||
    (minute - firstSlot) % interval !== 0
  ) {
    const clock = (value) =>
      `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    throw checkoutError(
      `Выберите доступное время с ${clock(firstSlot)} до ${clock(schedule.close)}`,
    );
  }
};

const normalizeSchedule = (
  raw,
  orderType,
  now = new Date(),
  env = process.env,
  branchHours = {},
  slotMinutes = 60,
) => {
  const value = boundedText(raw, 64);
  if (!value) {
    throw checkoutError(
      orderType === 'preorder'
        ? 'Выберите время предзаказа'
        : orderType === 'delivery'
          ? 'Выберите время доставки'
          : 'Выберите время самовывоза',
    );
  }
  const offsetMinutes = Number.parseInt(env.ORDER_TIMEZONE_OFFSET_MINUTES || '300', 10);
  const safeOffset =
    Number.isInteger(offsetMinutes) && Math.abs(offsetMinutes) <= 840 ? offsetMinutes : 300;
  const sign = safeOffset >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(safeOffset);
  const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`;
  const valueWithZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}${offset}`;
  const scheduledAt = new Date(valueWithZone);
  if (Number.isNaN(scheduledAt.getTime())) throw checkoutError('Некорректное время заказа');

  const configuredLead = Number.parseInt(
    orderType === 'preorder'
      ? env.PREORDER_MIN_LEAD_MINUTES || '120'
      : env.ORDER_MIN_LEAD_MINUTES || '10',
    10,
  );
  const minimumLead = Number.isInteger(configuredLead) && configuredLead >= 0 ? configuredLead : 10;
  const delta = scheduledAt.getTime() - now.getTime();
  if (delta < minimumLead * 60 * 1000 || delta > 60 * 24 * 60 * 60 * 1000) {
    throw checkoutError('Выберите доступное время заказа');
  }

  if (orderType !== 'preorder') {
    const localNow = new Date(now.getTime() + safeOffset * 60 * 1000);
    const localScheduled = new Date(scheduledAt.getTime() + safeOffset * 60 * 1000);
    const sameLocalDay =
      localNow.getUTCFullYear() === localScheduled.getUTCFullYear() &&
      localNow.getUTCMonth() === localScheduled.getUTCMonth() &&
      localNow.getUTCDate() === localScheduled.getUTCDate();
    if (!sameLocalDay) {
      throw checkoutError('Для самовывоза и доставки выберите время на сегодня');
    }
  }

  validateBranchHours(scheduledAt, branchHours, safeOffset, slotMinutes);
  return scheduledAt.toISOString();
};

const normalizeAdditionalPhone = (value) => {
  const raw = boundedText(value, 32);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const normalized =
    digits.length === 10
      ? `7${digits}`
      : digits.length === 11 && digits.startsWith('8')
        ? `7${digits.slice(1)}`
        : digits;
  if (!/^7\d{10}$/.test(normalized)) throw checkoutError('Некорректный дополнительный номер');
  return `+${normalized}`;
};

const SUBSTITUTION_PREFERENCES = new Set([
  'remove_refund',
  'call_customer',
  'replace_with_approval',
]);

const normalizeSubstitutionPreference = (value) => {
  const preference = String(value || 'call_customer')
    .trim()
    .toLowerCase();
  if (!SUBSTITUTION_PREFERENCES.has(preference)) {
    throw checkoutError('Некорректное правило замены отсутствующего товара');
  }
  return preference;
};

function validateCheckout(payload, cities, options = {}) {
  const env = options.env || process.env;
  const now = options.now instanceof Date ? options.now : new Date();
  const orderType = normalizeOrderType(payload?.orderType ?? payload?.fulfillmentType);
  const preorderFulfillmentType =
    orderType === 'preorder' &&
    String(payload?.preorderFulfillmentType || '')
      .trim()
      .toLowerCase() === 'delivery'
      ? 'delivery'
      : 'pickup';
  const isDelivery =
    orderType === 'delivery' ||
    (orderType === 'preorder' && preorderFulfillmentType === 'delivery');
  const deliveryAddress = isDelivery
    ? normalizeDeliveryAddress(payload?.deliveryAddress, env)
    : null;
  const branch = resolveBranch(
    {
      branchId: payload?.branchId,
      branch: payload?.branch,
      orderType: isDelivery ? 'delivery' : orderType,
      deliveryAddress,
      requiresPreorder: orderType === 'preorder',
    },
    cities,
  );
  const scheduledAt = normalizeSchedule(
    payload?.scheduledAt ?? payload?.pickupTime,
    orderType,
    now,
    env,
    branch.hours,
    branch.slotMinutes,
  );
  const deliveryFee = isDelivery ? branch.deliveryFee : 0;
  const minimumOrder = isDelivery ? branch.deliveryMinOrder : 0;

  return {
    orderType,
    preorderFulfillmentType: orderType === 'preorder' ? preorderFulfillmentType : null,
    branchId: String(branch.id),
    branch: boundedText(branch.label, 160),
    scheduledAt,
    pickupTime: scheduledAt,
    deliveryAddress,
    deliveryFee,
    deliveryMinimumOrder: Number(Number(minimumOrder).toFixed(2)),
    deliveryZone: branch.resolvedDeliveryZone || null,
    additionalPhone: normalizeAdditionalPhone(payload?.additionalPhone),
    comment: boundedText(payload?.comment, 500) || null,
    substitutionPreference: normalizeSubstitutionPreference(payload?.substitutionPreference),
  };
}

module.exports = {
  isPointInPolygon,
  normalizeDeliveryAddress,
  normalizeOrderType,
  normalizeSchedule,
  normalizeSubstitutionPreference,
  validateCheckout,
};
