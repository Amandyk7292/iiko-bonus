const { supabase } = require('../config/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZONE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_ZONE_COLORS = ['#66BB6A', '#29B6F6', '#FFD54F', '#EC407A', '#7E57C2', '#FF8A65'];
const MAX_CITY_POINT_DISTANCE_KM = 150;
const DEFAULT_DELIVERY_ZONES = [
  { id: 'zone-1', radiusKm: 5, fee: 700, minOrder: 3000, color: DEFAULT_ZONE_COLORS[0] },
];

const locationError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const requiredText = (value, label, { minimum = 2, maximum = 160 } = {}) => {
  const text = String(value == null ? '' : value)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < minimum || text.length > maximum) {
    throw locationError(`${label}: от ${minimum} до ${maximum} символов`);
  }
  return text;
};

const coordinate = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw locationError(`Поле ${label} содержит некорректное значение`);
  }
  return Number(number.toFixed(7));
};

const booleanValue = (value, fallback, label) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw locationError(`Поле ${label} должно быть логическим`);
  return value;
};

const integerValue = (value, fallback, minimum, maximum, label) => {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw locationError(`Поле ${label} содержит некорректное значение`);
  }
  return number;
};

const distanceKm = (first, second) => {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second[0] - first[0]);
  const longitudeDelta = radians(second[1] - first[1]);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first[0])) * Math.cos(radians(second[0])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const clockMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
};

const validateHours = (hours) => {
  const allowedDays = new Set(['daily', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  const entries = Object.entries(hours);
  if (entries.length === 0 || entries.some(([day]) => !allowedDays.has(day))) {
    throw locationError('Расписание должно содержать daily или дни недели');
  }
  for (const [, schedule] of entries) {
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
      throw locationError('Некорректное расписание филиала');
    }
    if (schedule.closed === true) continue;
    const open = clockMinutes(schedule.open);
    const close = clockMinutes(schedule.close);
    if (open === null || close === null || open >= close) {
      throw locationError('Время работы должно иметь формат HH:mm');
    }
  }
};

const normalizeDeliveryZones = (value, row = {}) => {
  const source = Array.isArray(value) ? value : [];
  const zones = source
    .map((zone, index) => ({
      id: String(zone?.id || `zone-${index + 1}`).slice(0, 64),
      radiusKm: Number(zone?.radiusKm ?? zone?.radius_km),
      fee: Number(zone?.fee),
      minOrder: Number(zone?.minOrder ?? zone?.min_order),
      color: ZONE_COLOR_PATTERN.test(String(zone?.color || ''))
        ? String(zone.color).toUpperCase()
        : DEFAULT_ZONE_COLORS[index % DEFAULT_ZONE_COLORS.length],
    }))
    .filter(
      (zone) =>
        Number.isFinite(zone.radiusKm) &&
        zone.radiusKm > 0 &&
        Number.isFinite(zone.fee) &&
        zone.fee >= 0 &&
        Number.isFinite(zone.minOrder) &&
        zone.minOrder >= 0,
    )
    .sort((first, second) => first.radiusKm - second.radiusKm);
  if (zones.length > 0) return zones;

  const radius = Number(row.delivery_radius_km);
  const fee = Number(row.delivery_fee);
  const minOrder = Number(row.delivery_min_order);
  if (radius > 0 && fee >= 0 && minOrder >= 0) {
    return [{ id: 'zone-1', radiusKm: radius, fee, minOrder, color: DEFAULT_ZONE_COLORS[0] }];
  }
  return [];
};

const validateDeliveryZones = (value) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw locationError('Добавьте от 1 до 8 зон доставки');
  }
  const seenRadii = new Set();
  const zones = value.map((zone, index) => {
    if (!zone || typeof zone !== 'object' || Array.isArray(zone)) {
      throw locationError('Некорректная зона доставки');
    }
    const radiusKm = Number(zone.radiusKm ?? zone.radius_km);
    const fee = Number(zone.fee);
    const minOrder = Number(zone.minOrder ?? zone.min_order);
    const color = String(zone.color || DEFAULT_ZONE_COLORS[index % DEFAULT_ZONE_COLORS.length]);
    const radiusKey = radiusKm.toFixed(3);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
      throw locationError('Радиус зоны должен быть от 0.1 до 100 км');
    }
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 100000) {
      throw locationError('Стоимость доставки должна быть целым числом от 0 до 100000');
    }
    if (!Number.isSafeInteger(minOrder) || minOrder < 0 || minOrder > 10000000) {
      throw locationError('Минимальная сумма должна быть целым числом от 0 до 10000000');
    }
    if (!ZONE_COLOR_PATTERN.test(color)) throw locationError('Некорректный цвет зоны доставки');
    if (seenRadii.has(radiusKey)) throw locationError('Радиусы зон доставки не должны повторяться');
    seenRadii.add(radiusKey);
    return {
      id: String(zone.id || `zone-${index + 1}`)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64),
      radiusKm: Number(radiusKm.toFixed(2)),
      fee,
      minOrder,
      color: color.toUpperCase(),
    };
  });
  return zones.sort((first, second) => first.radiusKm - second.radiusKm);
};

const normalizeLocation = (row) => ({
  id: String(row.id),
  cityId: row.city_id ? String(row.city_id) : null,
  twoGisId: row.two_gis_id || null,
  name: row.name,
  address: row.address,
  city: row.city,
  latitude: row.latitude == null ? null : Number(row.latitude),
  longitude: row.longitude == null ? null : Number(row.longitude),
  hours: row.hours && typeof row.hours === 'object' ? row.hours : {},
  active: row.active !== false,
  pickupEnabled: row.pickup_enabled !== false,
  preorderEnabled: row.preorder_enabled !== false,
  deliveryEnabled: row.delivery_enabled === true,
  deliveryRadiusKm: row.delivery_radius_km == null ? null : Number(row.delivery_radius_km),
  deliveryFee: row.delivery_fee == null ? null : Number(row.delivery_fee),
  deliveryMinOrder: row.delivery_min_order == null ? null : Number(row.delivery_min_order),
  deliveryZones: normalizeDeliveryZones(row.delivery_zones, row),
  slotMinutes: Number(row.slot_minutes || 60),
  pickupSlotCapacity: Number(row.pickup_slot_capacity || 20),
  preorderSlotCapacity: Number(row.preorder_slot_capacity || 10),
  deliverySlotCapacity: Number(row.delivery_slot_capacity || 15),
  sortOrder: Number(row.sort_order || 0),
});

async function getBulkaLocations({ includeInactive = false } = {}) {
  let query = supabase
    .from('bulka_locations')
    .select(
      'id,city_id,two_gis_id,name,city,address,latitude,longitude,hours,active,pickup_enabled,preorder_enabled,delivery_enabled,delivery_radius_km,delivery_fee,delivery_min_order,delivery_zones,slot_minutes,pickup_slot_capacity,preorder_slot_capacity,delivery_slot_capacity,sort_order',
    );
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query.order('sort_order', { ascending: true }).order('name');
  if (error) {
    const serviceError = new Error('Филиалы временно недоступны');
    serviceError.statusCode = 503;
    serviceError.cause = error;
    throw serviceError;
  }
  return (data || []).map(normalizeLocation);
}

const normalizeBulkaCity = (row) => ({
  id: String(row.id),
  name: row.name,
  latitude: row.center_latitude == null ? null : Number(row.center_latitude),
  longitude: row.center_longitude == null ? null : Number(row.center_longitude),
  active: row.active !== false,
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
});

async function getBulkaCities({ includeInactive = false } = {}) {
  let query = supabase
    .from('bulka_cities')
    .select('id,name,center_latitude,center_longitude,active,created_at,updated_at');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query.order('name', { ascending: true });
  if (error) {
    const serviceError = locationError('Города временно недоступны', 503);
    serviceError.cause = error;
    throw serviceError;
  }
  return (data || []).map(normalizeBulkaCity);
}

async function createBulkaCity(payload = {}) {
  const name = requiredText(payload.name, 'Название города', { minimum: 2, maximum: 100 });
  const centerLatitude = coordinate(payload.latitude, 'latitude', -90, 90);
  const centerLongitude = coordinate(payload.longitude, 'longitude', -180, 180);
  const { data, error } = await supabase
    .from('bulka_cities')
    .insert({
      name,
      center_latitude: centerLatitude,
      center_longitude: centerLongitude,
      active: true,
    })
    .select('id,name,center_latitude,center_longitude,active,created_at,updated_at')
    .single();
  if (error?.code === '23505') throw locationError('Такой город уже существует', 409);
  if (error) throw error;
  return normalizeBulkaCity(data);
}

async function createBulkaLocation(payload = {}) {
  const cityId = String(payload.cityId || '').trim();
  if (!UUID_PATTERN.test(cityId)) throw locationError('Выберите город для филиала');

  const { data: city, error: cityError } = await supabase
    .from('bulka_cities')
    .select('id,name,center_latitude,center_longitude,active')
    .eq('id', cityId)
    .eq('active', true)
    .maybeSingle();
  if (cityError) throw cityError;
  if (!city) throw locationError('Город не найден', 404);

  const name = requiredText(payload.name, 'Название филиала', { minimum: 2, maximum: 160 });
  const address = requiredText(payload.address, 'Адрес филиала', { minimum: 3, maximum: 300 });
  const latitude = coordinate(payload.latitude, 'latitude', -90, 90);
  const longitude = coordinate(payload.longitude, 'longitude', -180, 180);
  if (
    city.center_latitude != null &&
    city.center_longitude != null &&
    Number.isFinite(Number(city.center_latitude)) &&
    Number.isFinite(Number(city.center_longitude)) &&
    distanceKm(
      [Number(city.center_latitude), Number(city.center_longitude)],
      [latitude, longitude],
    ) > MAX_CITY_POINT_DISTANCE_KM
  ) {
    throw locationError('Точка находится слишком далеко от выбранного города');
  }

  const hours = payload.hours ?? { daily: { open: '08:00', close: '21:00' } };
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) {
    throw locationError('Некорректное расписание филиала');
  }
  validateHours(hours);

  const deliveryZones = validateDeliveryZones(
    payload.deliveryZones === undefined ? DEFAULT_DELIVERY_ZONES : payload.deliveryZones,
  );
  const outerZone = deliveryZones[deliveryZones.length - 1];
  const row = {
    city_id: city.id,
    city: city.name,
    name,
    address,
    latitude,
    longitude,
    hours,
    active: booleanValue(payload.active, true, 'active'),
    pickup_enabled: booleanValue(payload.pickupEnabled, true, 'pickupEnabled'),
    preorder_enabled: booleanValue(payload.preorderEnabled, true, 'preorderEnabled'),
    delivery_enabled: booleanValue(payload.deliveryEnabled, false, 'deliveryEnabled'),
    delivery_zones: deliveryZones,
    delivery_radius_km: outerZone.radiusKm,
    delivery_fee: outerZone.fee,
    delivery_min_order: outerZone.minOrder,
    slot_minutes: integerValue(payload.slotMinutes, 60, 15, 240, 'slotMinutes'),
    pickup_slot_capacity: integerValue(
      payload.pickupSlotCapacity,
      20,
      1,
      500,
      'pickupSlotCapacity',
    ),
    preorder_slot_capacity: integerValue(
      payload.preorderSlotCapacity,
      10,
      1,
      500,
      'preorderSlotCapacity',
    ),
    delivery_slot_capacity: integerValue(
      payload.deliverySlotCapacity,
      15,
      1,
      500,
      'deliverySlotCapacity',
    ),
  };

  const { data, error } = await supabase.from('bulka_locations').insert(row).select().single();
  if (error) throw error;
  return normalizeLocation(data);
}

async function getCitiesWithPoints({ throwOnError = false } = {}) {
  try {
    const locations = await getBulkaLocations();
    const grouped = new Map();
    for (const location of locations) {
      if (!grouped.has(location.city)) {
        grouped.set(location.city, {
          id: location.city.toLocaleLowerCase('ru-RU'),
          name: location.city,
          i18n: {},
          points: [],
        });
      }
      grouped.get(location.city).points.push(location);
    }
    return [...grouped.values()];
  } catch (error) {
    console.error('Error loading Bulka locations:', error.cause?.message || error.message);
    if (throwOnError) throw error;
    return [];
  }
}

async function updateBulkaLocation(id, payload = {}) {
  if (!UUID_PATTERN.test(id)) throw locationError('Некорректный идентификатор филиала');
  const updates = {};
  for (const [apiKey, databaseKey] of Object.entries({
    active: 'active',
    pickupEnabled: 'pickup_enabled',
    preorderEnabled: 'preorder_enabled',
    deliveryEnabled: 'delivery_enabled',
  })) {
    if (payload[apiKey] !== undefined) {
      if (typeof payload[apiKey] !== 'boolean') {
        throw locationError(`Поле ${apiKey} должно быть логическим`);
      }
      updates[databaseKey] = payload[apiKey];
    }
  }
  for (const [apiKey, databaseKey, maximum, integerOnly] of [
    ['deliveryRadiusKm', 'delivery_radius_km', 100, false],
    ['deliveryFee', 'delivery_fee', 100000, true],
    ['deliveryMinOrder', 'delivery_min_order', 10000000, true],
    ['slotMinutes', 'slot_minutes', 240, true],
    ['pickupSlotCapacity', 'pickup_slot_capacity', 500, true],
    ['preorderSlotCapacity', 'preorder_slot_capacity', 500, true],
    ['deliverySlotCapacity', 'delivery_slot_capacity', 500, true],
  ]) {
    if (payload[apiKey] === undefined) continue;
    if (payload[apiKey] === null || payload[apiKey] === '') {
      if (apiKey === 'slotMinutes' || apiKey.endsWith('SlotCapacity')) {
        throw locationError(`Поле ${apiKey} обязательно`);
      }
      updates[databaseKey] = null;
      continue;
    }
    const number = Number(payload[apiKey]);
    if (
      !Number.isFinite(number) ||
      number < (apiKey.endsWith('SlotCapacity') ? 1 : apiKey === 'slotMinutes' ? 15 : 0) ||
      number > maximum ||
      (integerOnly && !Number.isSafeInteger(number))
    ) {
      throw locationError(`Поле ${apiKey} содержит некорректное значение`);
    }
    updates[databaseKey] = number;
  }
  for (const [apiKey, databaseKey, minimum, maximum] of [
    ['latitude', 'latitude', -90, 90],
    ['longitude', 'longitude', -180, 180],
  ]) {
    if (payload[apiKey] === undefined) continue;
    const number = Number(payload[apiKey]);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      throw locationError(`Поле ${apiKey} содержит некорректное значение`);
    }
    updates[databaseKey] = Number(number.toFixed(7));
  }
  if (payload.deliveryZones !== undefined) {
    const zones = validateDeliveryZones(payload.deliveryZones);
    const outer = zones[zones.length - 1];
    updates.delivery_zones = zones;
    // Keep old clients compatible while the server uses the full zone list.
    updates.delivery_radius_km = outer.radiusKm;
    updates.delivery_fee = outer.fee;
    updates.delivery_min_order = outer.minOrder;
  }
  if (payload.hours !== undefined) {
    if (!payload.hours || typeof payload.hours !== 'object' || Array.isArray(payload.hours)) {
      throw locationError('Некорректное расписание филиала');
    }
    validateHours(payload.hours);
    updates.hours = payload.hours;
  }
  if (Object.keys(updates).length === 0) {
    throw locationError('Нет настроек для обновления');
  }

  const { data: current, error: currentError } = await supabase
    .from('bulka_locations')
    .select(
      'delivery_enabled,delivery_radius_km,delivery_fee,delivery_min_order,delivery_zones,latitude,longitude',
    )
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw locationError('Филиал не найден', 404);
  const effective = { ...current, ...updates };
  const effectiveZones = normalizeDeliveryZones(effective.delivery_zones, effective);
  if (
    effective.delivery_enabled === true &&
    (!Number.isFinite(Number(effective.latitude)) ||
      !Number.isFinite(Number(effective.longitude)) ||
      effectiveZones.length === 0)
  ) {
    throw locationError('Для доставки задайте радиус больше 0, стоимость и минимальную сумму');
  }
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('bulka_locations')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw locationError('Филиал не найден', 404);
  return normalizeLocation(data);
}

async function updateActiveLocationDeliveryZones(payload = {}, { locationIds = [] } = {}) {
  const zones = validateDeliveryZones(payload.deliveryZones);
  if (payload.enableDelivery !== undefined && typeof payload.enableDelivery !== 'boolean') {
    throw locationError('Поле enableDelivery должно быть логическим');
  }

  let activeLocationsQuery = supabase
    .from('bulka_locations')
    .select('id,name,latitude,longitude')
    .eq('active', true);
  const scopedLocationIds = Array.isArray(locationIds)
    ? [...new Set(locationIds.map(String).filter(Boolean))]
    : [];
  if (scopedLocationIds.length)
    activeLocationsQuery = activeLocationsQuery.in('id', scopedLocationIds);
  const { data: activeLocations, error: activeLocationsError } = await activeLocationsQuery;
  if (activeLocationsError) throw activeLocationsError;
  if (!activeLocations || activeLocations.length === 0) {
    throw locationError('Нет активных филиалов для обновления', 404);
  }

  if (payload.enableDelivery === true) {
    const missingCoordinates = activeLocations.filter(
      (location) =>
        location.latitude == null ||
        location.longitude == null ||
        !Number.isFinite(Number(location.latitude)) ||
        !Number.isFinite(Number(location.longitude)),
    );
    if (missingCoordinates.length > 0) {
      const names = missingCoordinates
        .slice(0, 3)
        .map((location) => location.name)
        .join(', ');
      throw locationError(
        `Сначала укажите координаты филиалов: ${names}${missingCoordinates.length > 3 ? '…' : ''}`,
      );
    }
  }

  const outer = zones[zones.length - 1];
  const updates = {
    delivery_zones: zones,
    delivery_radius_km: outer.radiusKm,
    delivery_fee: outer.fee,
    delivery_min_order: outer.minOrder,
    updated_at: new Date().toISOString(),
  };
  if (payload.enableDelivery === true) updates.delivery_enabled = true;

  // One SQL UPDATE keeps the bulk overwrite atomic: either every active branch is
  // updated, or PostgreSQL rejects the entire statement.
  let updateQuery = supabase.from('bulka_locations').update(updates).eq('active', true);
  if (scopedLocationIds.length) updateQuery = updateQuery.in('id', scopedLocationIds);
  const { data, error } = await updateQuery.select();
  if (error) throw error;

  return {
    locations: (data || []).map(normalizeLocation),
    updatedCount: data?.length || 0,
  };
}

async function createCity(name, i18n) {
  const { data, error } = await supabase.from('cities').insert([{ name, i18n }]).select().single();

  if (error) throw new Error(error.message);
  return data;
}

async function updateCity(id, name, i18n) {
  const { data, error } = await supabase
    .from('cities')
    .update({ name, i18n })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deleteCity(id) {
  const { error } = await supabase.from('cities').delete().eq('id', id);

  if (error) throw new Error(error.message);
}

async function createPoint(cityId, name, address, latitude, longitude, i18n) {
  const { data, error } = await supabase
    .from('points')
    .insert([{ city_id: cityId, name, address, latitude, longitude, i18n }])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function updatePoint(id, name, address, latitude, longitude, i18n) {
  const updates = { name, address };
  if (latitude !== undefined) updates.latitude = latitude;
  if (longitude !== undefined) updates.longitude = longitude;
  if (i18n !== undefined) updates.i18n = i18n;

  const { data, error } = await supabase
    .from('points')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deletePoint(id) {
  const { error } = await supabase.from('points').delete().eq('id', id);

  if (error) throw new Error(error.message);
}

module.exports = {
  normalizeDeliveryZones,
  getBulkaCities,
  getBulkaLocations,
  getCitiesWithPoints,
  createBulkaCity,
  createBulkaLocation,
  updateBulkaLocation,
  updateActiveLocationDeliveryZones,
  createCity,
  updateCity,
  deleteCity,
  createPoint,
  updatePoint,
  deletePoint,
};
