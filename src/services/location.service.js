const { supabase } = require('../config/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZONE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_ZONE_COLORS = ['#66BB6A', '#29B6F6', '#FFD54F', '#EC407A', '#7E57C2', '#FF8A65'];

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
  sortOrder: Number(row.sort_order || 0),
});

async function getBulkaLocations({ includeInactive = false } = {}) {
  let query = supabase
    .from('bulka_locations')
    .select(
      'id,two_gis_id,name,city,address,latitude,longitude,hours,active,pickup_enabled,preorder_enabled,delivery_enabled,delivery_radius_km,delivery_fee,delivery_min_order,delivery_zones,sort_order',
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
