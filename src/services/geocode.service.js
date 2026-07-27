const fetch = require('node-fetch');

const ASTANA_BOUNDS = Object.freeze({
  south: 50.85,
  west: 70.85,
  north: 51.35,
  east: 71.85,
});
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;
const cache = new Map();
let queue = Promise.resolve();
let nextRequestAt = 0;

const geocodeError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const insideAstanaBounds = (latitude, longitude) =>
  latitude >= ASTANA_BOUNDS.south &&
  latitude <= ASTANA_BOUNDS.north &&
  longitude >= ASTANA_BOUNDS.west &&
  longitude <= ASTANA_BOUNDS.east;

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

const normalizedAddress = (item) => ({
  displayName: String(item?.display_name || '').slice(0, 500),
  address: String(
    item?.address?.road ||
      item?.address?.pedestrian ||
      item?.address?.neighbourhood ||
      item?.display_name ||
      '',
  ).slice(0, 500),
  city: String(item?.address?.city || item?.address?.town || 'Астана').slice(0, 100),
  latitude: Number(item?.lat),
  longitude: Number(item?.lon),
});

async function searchAddresses(query, language = 'ru') {
  const cleanQuery = String(query || '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  if (cleanQuery.length < 3) throw geocodeError('Введите не менее 3 символов адреса');
  const normalizedLanguage = normalizeLanguage(language);
  const key = `search:${normalizedLanguage}:${cleanQuery.toLocaleLowerCase('ru-RU')}`;
  const cached = fromCache(key);
  if (cached) return cached;
  const data = await nominatim(
    'search',
    {
      q: `${cleanQuery}, Астана, Казахстан`,
      format: 'jsonv2',
      addressdetails: 1,
      limit: 5,
      bounded: 1,
      viewbox: `${ASTANA_BOUNDS.west},${ASTANA_BOUNDS.north},${ASTANA_BOUNDS.east},${ASTANA_BOUNDS.south}`,
    },
    normalizedLanguage,
  );
  const results = (Array.isArray(data) ? data : [])
    .map(normalizedAddress)
    .filter(
      (item) =>
        Number.isFinite(item.latitude) &&
        Number.isFinite(item.longitude) &&
        insideAstanaBounds(item.latitude, item.longitude),
    );
  saveCache(key, results);
  return results;
}

async function reverseAddress(latitudeValue, longitudeValue, language = 'ru') {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !insideAstanaBounds(latitude, longitude)
  ) {
    throw geocodeError('Координаты находятся за пределами Астаны');
  }
  const normalizedLanguage = normalizeLanguage(language);
  const key = `reverse:${normalizedLanguage}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
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
  const result = normalizedAddress(data);
  if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
    throw geocodeError('Адрес по координатам не найден', 404);
  }
  saveCache(key, result);
  return result;
}

module.exports = {
  ASTANA_BOUNDS,
  insideAstanaBounds,
  normalizeLanguage,
  reverseAddress,
  searchAddresses,
};
