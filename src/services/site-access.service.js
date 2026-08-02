const net = require('node:net');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const SITE_ACCESS_KEY = 'site_access';
const SITE_ACCESS_CACHE_TTL_MS = 5000;
const MAX_ALLOWED_IPS = 200;
const DEFAULT_SITE_ACCESS_CONFIG = Object.freeze({ enabled: false, allowedIps: [] });

let cachedConfig = null;
let cacheExpiresAt = 0;

const cloneConfig = (config) => ({
  enabled: config.enabled === true,
  allowedIps: [...(config.allowedIps || [])],
});

const configurationError = (message) =>
  Object.assign(new Error(message), {
    statusCode: 400,
    code: 'INVALID_SITE_ACCESS_CONFIG',
  });

function normalizeIpAddress(input) {
  let value = String(input || '').trim();
  if (!value) return null;

  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.includes(':') && value.includes('%')) value = value.split('%', 1)[0];

  const mappedDotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedDotted && net.isIP(mappedDotted[1]) === 4) value = mappedDotted[1];

  const version = net.isIP(value);
  if (version === 4) {
    return value
      .split('.')
      .map((part) => String(Number(part)))
      .join('.');
  }
  if (version !== 6) return null;

  let normalized;
  try {
    normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  } catch (_error) {
    return null;
  }

  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }

  return normalized;
}

function normalizeAllowedIps(value, { strict = false } = {}) {
  if (!Array.isArray(value)) {
    if (strict) throw configurationError('Список разрешённых IP должен быть массивом');
    return [];
  }
  if (value.length > MAX_ALLOWED_IPS) {
    throw configurationError(`Можно добавить не более ${MAX_ALLOWED_IPS} IP-адресов`);
  }

  const normalized = new Set();
  for (const rawIp of value) {
    const ip = typeof rawIp === 'string' ? normalizeIpAddress(rawIp) : null;
    if (!ip) {
      if (strict) {
        throw configurationError(`Некорректный IP-адрес: ${String(rawIp || '').slice(0, 80)}`);
      }
      continue;
    }
    normalized.add(ip);
  }
  return [...normalized];
}

function normalizeSiteAccessConfig(value, { strict = false } = {}) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_error) {
      if (strict) throw configurationError('Настройка доступа содержит некорректный JSON');
      source = {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    if (strict) throw configurationError('Настройка доступа должна быть объектом');
    source = {};
  }
  if (strict && typeof source.enabled !== 'boolean') {
    throw configurationError('Поле enabled должно быть логическим значением');
  }

  const config = {
    enabled: source.enabled === true,
    allowedIps: normalizeAllowedIps(source.allowedIps ?? source.allowed_ips ?? [], { strict }),
  };
  if (strict && config.enabled && config.allowedIps.length === 0) {
    throw configurationError('Добавьте хотя бы один IP-адрес перед включением ограничения');
  }
  return config;
}

function rememberConfig(config) {
  cachedConfig = cloneConfig(config);
  cacheExpiresAt = Date.now() + SITE_ACCESS_CACHE_TTL_MS;
  return cloneConfig(cachedConfig);
}

function handleReadFailure(error) {
  if (cachedConfig) {
    logger.warn(
      { err: error, event: 'site_access_refresh_failed' },
      'Using cached site access settings',
    );
    return cloneConfig(cachedConfig);
  }

  const isProduction =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.VERCEL);
  if (!isProduction) {
    logger.warn(
      { err: error, event: 'site_access_load_failed' },
      'Site access control stays disabled outside production',
    );
    return cloneConfig(DEFAULT_SITE_ACCESS_CONFIG);
  }

  throw Object.assign(new Error('Настройка доступа к сайту временно недоступна'), {
    statusCode: 503,
    code: 'SITE_ACCESS_CONFIG_UNAVAILABLE',
    cause: error,
  });
}

async function getSiteAccessConfig({ forceRefresh = false } = {}) {
  if (process.env.NODE_ENV === 'test' && !forceRefresh) {
    return cloneConfig(DEFAULT_SITE_ACCESS_CONFIG);
  }
  if (!forceRefresh && cachedConfig && Date.now() < cacheExpiresAt) {
    return cloneConfig(cachedConfig);
  }

  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', SITE_ACCESS_KEY)
      .maybeSingle();
    if (error) throw error;
    return rememberConfig(
      data ? normalizeSiteAccessConfig(data.value) : DEFAULT_SITE_ACCESS_CONFIG,
    );
  } catch (error) {
    return handleReadFailure(error);
  }
}

async function updateSiteAccessConfig(value) {
  const config = normalizeSiteAccessConfig(value, { strict: true });
  const storedValue = JSON.stringify({
    enabled: config.enabled,
    allowed_ips: config.allowedIps,
  });
  const { error } = await supabase.from('settings').upsert(
    {
      key: SITE_ACCESS_KEY,
      value: storedValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) {
    throw Object.assign(new Error('Не удалось сохранить список разрешённых IP'), {
      statusCode: 500,
      code: 'SITE_ACCESS_SAVE_FAILED',
      cause: error,
    });
  }
  return rememberConfig(config);
}

function isIpAllowed(ip, config) {
  const normalizedIp = normalizeIpAddress(ip);
  return Boolean(normalizedIp && config?.allowedIps?.includes(normalizedIp));
}

function resetSiteAccessCache() {
  cachedConfig = null;
  cacheExpiresAt = 0;
}

module.exports = {
  DEFAULT_SITE_ACCESS_CONFIG,
  MAX_ALLOWED_IPS,
  getSiteAccessConfig,
  isIpAllowed,
  normalizeIpAddress,
  normalizeSiteAccessConfig,
  resetSiteAccessCache,
  updateSiteAccessConfig,
};
