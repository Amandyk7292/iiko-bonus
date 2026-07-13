const { supabase } = require('../config/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const locationError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

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
  sortOrder: Number(row.sort_order || 0),
});

async function getBulkaLocations({ includeInactive = false } = {}) {
  let query = supabase
    .from('bulka_locations')
    .select(
      'id,two_gis_id,name,city,address,latitude,longitude,hours,active,pickup_enabled,preorder_enabled,delivery_enabled,delivery_radius_km,delivery_fee,delivery_min_order,sort_order',
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
  ]) {
    if (payload[apiKey] === undefined) continue;
    if (payload[apiKey] === null || payload[apiKey] === '') {
      updates[databaseKey] = null;
      continue;
    }
    const number = Number(payload[apiKey]);
    if (
      !Number.isFinite(number) ||
      number < 0 ||
      number > maximum ||
      (integerOnly && !Number.isSafeInteger(number))
    ) {
      throw locationError(`Поле ${apiKey} содержит некорректное значение`);
    }
    updates[databaseKey] = number;
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
      'delivery_enabled,delivery_radius_km,delivery_fee,delivery_min_order,latitude,longitude',
    )
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw locationError('Филиал не найден', 404);
  const effective = { ...current, ...updates };
  if (
    effective.delivery_enabled === true &&
    (!Number.isFinite(Number(effective.latitude)) ||
      !Number.isFinite(Number(effective.longitude)) ||
      !(Number(effective.delivery_radius_km) > 0) ||
      !(Number(effective.delivery_fee) >= 0) ||
      !(Number(effective.delivery_min_order) >= 0))
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
  getBulkaLocations,
  getCitiesWithPoints,
  updateBulkaLocation,
  createCity,
  updateCity,
  deleteCity,
  createPoint,
  updatePoint,
  deletePoint,
};
