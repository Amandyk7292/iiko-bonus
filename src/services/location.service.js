const { supabase } = require('../config/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CITY_POINT_DISTANCE_KM = 150;
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
      'id,city_id,two_gis_id,name,city,address,latitude,longitude,hours,active,pickup_enabled,preorder_enabled,delivery_enabled,slot_minutes,pickup_slot_capacity,preorder_slot_capacity,delivery_slot_capacity,sort_order',
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
  if (payload.name !== undefined) {
    updates.name = requiredText(payload.name, 'Название филиала', { minimum: 2, maximum: 160 });
  }
  if (payload.address !== undefined) {
    updates.address = requiredText(payload.address, 'Адрес филиала', { minimum: 3, maximum: 300 });
  }
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
    .select('delivery_enabled,latitude,longitude')
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw locationError('Филиал не найден', 404);
  const effective = { ...current, ...updates };
  if (
    effective.delivery_enabled === true &&
    (effective.latitude == null ||
      effective.longitude == null ||
      !Number.isFinite(Number(effective.latitude)) ||
      !Number.isFinite(Number(effective.longitude)))
  ) {
    throw locationError('Для доставки укажите координаты филиала');
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
  getBulkaCities,
  getBulkaLocations,
  getCitiesWithPoints,
  createBulkaCity,
  createBulkaLocation,
  updateBulkaLocation,
  createCity,
  updateCity,
  deleteCity,
  createPoint,
  updatePoint,
  deletePoint,
};
