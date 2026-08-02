const fetch = require('node-fetch');

const ASTANA_BOUNDS = Object.freeze({
  south: 50.85,
  west: 70.85,
  north: 51.35,
  east: 71.85,
});
const AKTAU_BOUNDS = Object.freeze({
  south: 43.5,
  west: 50.95,
  north: 43.82,
  east: 51.35,
});
const SUPPORTED_CITY_REGIONS = Object.freeze([
  Object.freeze({
    key: 'astana',
    name: 'Астана',
    aliases: Object.freeze(['астана', 'нур султан', 'нұр сұлтан', 'astana', 'nur sultan']),
    bounds: ASTANA_BOUNDS,
  }),
  Object.freeze({
    key: 'aktau',
    name: 'Актау',
    aliases: Object.freeze(['актау', 'ақтау', 'aktau', 'aqtau']),
    bounds: AKTAU_BOUNDS,
  }),
]);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;
const cache = new Map();
let queue = Promise.resolve();
let nextRequestAt = 0;

const geocodeError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const insideBounds = (latitude, longitude, bounds) =>
  Number.isFinite(Number(latitude)) &&
  Number.isFinite(Number(longitude)) &&
  Number(latitude) >= bounds.south &&
  Number(latitude) <= bounds.north &&
  Number(longitude) >= bounds.west &&
  Number(longitude) <= bounds.east;

const insideAstanaBounds = (latitude, longitude) =>
  insideBounds(latitude, longitude, ASTANA_BOUNDS);

const insideAktauBounds = (latitude, longitude) => insideBounds(latitude, longitude, AKTAU_BOUNDS);

const normalizeCityToken = (value) =>
  String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^a-zа-яёәіңғүұқөһ]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cityRegion = (value) => {
  const normalized = normalizeCityToken(value);
  if (!normalized) return null;
  return (
    SUPPORTED_CITY_REGIONS.find((region) =>
      region.aliases.some((alias) => normalized === normalizeCityToken(alias)),
    ) || null
  );
};

const cityRegionFromQuery = (value) => {
  const normalized = ` ${normalizeCityToken(value)} `;
  return (
    SUPPORTED_CITY_REGIONS.find((region) =>
      region.aliases.some((alias) => normalized.includes(` ${normalizeCityToken(alias)} `)),
    ) || null
  );
};

const cityRegionForCoordinates = (latitude, longitude) =>
  SUPPORTED_CITY_REGIONS.find((region) => insideBounds(latitude, longitude, region.bounds)) || null;

const insideSupportedCityBounds = (latitude, longitude) =>
  cityRegionForCoordinates(latitude, longitude) !== null;

const fromCache = (key) => {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
};

const saveCache = (key, value) => {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
};

const enqueue = (callback) => {
  const result = queue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    nextRequestAt = Date.now() + 1000;
    return callback();
  });
  queue = result.catch(() => undefined);
  return result;
};

const normalizeLanguage = (value) => {
  const requested = String(value || '').toLowerCase();
  if (requested.startsWith('kk')) return 'kk';
  if (requested.startsWith('en')) return 'en';
  return 'ru';
};

const nominatim = async (path, parameters, language) => {
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return enqueue(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': normalizeLanguage(language),
          'User-Agent': process.env.GEOCODER_USER_AGENT || 'BulkaBonus/1.0 (https://bulka.com.kz)',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw geocodeError('Сервис адресов временно недоступен', 502);
      return response.json();
    } catch (error) {
      if (error.statusCode) throw error;
      throw geocodeError('Сервис адресов не ответил вовремя', 504);
    } finally {
      clearTimeout(timeout);
    }
  });
};

const normalizedAddress = (item, fallbackCity = '') => ({
  displayName: String(item?.display_name || '').slice(0, 500),
  address: String(
    item?.address?.road ||
      item?.address?.pedestrian ||
      item?.address?.neighbourhood ||
      item?.display_name ||
      '',
  ).slice(0, 500),
  city: String(fallbackCity || item?.address?.city || item?.address?.town || '').slice(0, 100),
  latitude: Number(item?.lat),
  longitude: Number(item?.lon),
});

async function searchAddresses(query, language = 'ru', requestedCity = '') {
  const cleanQuery = String(query || '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  if (cleanQuery.length < 3) throw geocodeError('Введите не менее 3 символов адреса');
  const normalizedLanguage = normalizeLanguage(language);
  const explicitRegion = requestedCity ? cityRegion(requestedCity) : null;
  if (requestedCity && !explicitRegion) {
    throw geocodeError('Доставка в выбранном городе пока недоступна');
  }
  const queryRegion = explicitRegion || cityRegionFromQuery(cleanQuery);
  const regions = queryRegion ? [queryRegion] : SUPPORTED_CITY_REGIONS;
  const regionKey = regions.map((region) => region.key).join(',');
  const key = `search:${normalizedLanguage}:${regionKey}:${cleanQuery.toLocaleLowerCase('ru-RU')}`;
  const cached = fromCache(key);
  if (cached) return cached;
  const results = [];
  const seen = new Set();
  for (const region of regions) {
    const data = await nominatim(
      'search',
      {
        q: `${cleanQuery}, ${region.name}, Казахстан`,
        format: 'jsonv2',
        addressdetails: 1,
        limit: 5,
        bounded: 1,
        viewbox: `${region.bounds.west},${region.bounds.north},${region.bounds.east},${region.bounds.south}`,
      },
      normalizedLanguage,
    );
    for (const item of Array.isArray(data) ? data : []) {
      const normalized = normalizedAddress(item, region.name);
      if (
        !Number.isFinite(normalized.latitude) ||
        !Number.isFinite(normalized.longitude) ||
        !insideBounds(normalized.latitude, normalized.longitude, region.bounds)
      ) {
        continue;
      }
      const coordinateKey = `${normalized.latitude.toFixed(6)}:${normalized.longitude.toFixed(6)}`;
      if (seen.has(coordinateKey)) continue;
      seen.add(coordinateKey);
      results.push(normalized);
      if (results.length >= 5) break;
    }
    if (results.length >= 5) break;
  }
  saveCache(key, results);
  return results;
}

async function reverseAddress(latitudeValue, longitudeValue, language = 'ru', requestedCity = '') {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  const region = cityRegionForCoordinates(latitude, longitude);
  if (!region) {
    throw geocodeError('Координаты находятся за пределами поддерживаемых городов');
  }
  const expectedRegion = requestedCity ? cityRegion(requestedCity) : null;
  if (requestedCity && !expectedRegion) {
    throw geocodeError('Доставка в выбранном городе пока недоступна');
  }
  if (expectedRegion && expectedRegion.key !== region.key) {
    throw geocodeError(`Выберите точку в городе ${expectedRegion.name}`);
  }
  const normalizedLanguage = normalizeLanguage(language);
  const key = `reverse:${normalizedLanguage}:${region.key}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
  const cached = fromCache(key);
  if (cached) return cached;
  const data = await nominatim(
    'reverse',
    {
      lat: latitude,
      lon: longitude,
      format: 'jsonv2',
      addressdetails: 1,
      zoom: 18,
    },
    normalizedLanguage,
  );
  const result = normalizedAddress(data, region.name);
  if (
    !Number.isFinite(result.latitude) ||
    !Number.isFinite(result.longitude) ||
    !insideBounds(result.latitude, result.longitude, region.bounds)
  ) {
    throw geocodeError('Адрес по координатам не найден', 404);
  }
  saveCache(key, result);
  return result;
}

module.exports = {
  AKTAU_BOUNDS,
  ASTANA_BOUNDS,
  SUPPORTED_CITY_REGIONS,
  cityRegion,
  cityRegionForCoordinates,
  insideAktauBounds,
  insideAstanaBounds,
  insideSupportedCityBounds,
  normalizeLanguage,
  reverseAddress,
  searchAddresses,
};
