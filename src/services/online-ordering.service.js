const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const ONLINE_ORDERING_KEY = 'online_ordering';
const ONLINE_ORDERING_CACHE_TTL_MS = 5000;
const ONLINE_ORDERING_DISABLED_MESSAGE = 'Онлайн-заказы и оплата временно отключены.';
const DEFAULT_ONLINE_ORDERING_CONFIG = Object.freeze({ disabled: false });

let cachedConfig = null;
let cacheExpiresAt = 0;

const cloneConfig = (config) => ({ disabled: config?.disabled === true });

const configurationError = (message) =>
  Object.assign(new Error(message), {
    statusCode: 400,
    code: 'INVALID_ONLINE_ORDERING_CONFIG',
  });

function normalizeOnlineOrderingConfig(value, { strict = false } = {}) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_error) {
      if (strict) throw configurationError('Настройка онлайн-заказов содержит некорректный JSON');
      source = {};
    }
  }
  if (typeof source === 'boolean') source = { disabled: source };
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    if (strict) throw configurationError('Настройка онлайн-заказов должна быть объектом');
    source = {};
  }
  if (strict && typeof source.disabled !== 'boolean') {
    throw configurationError('Поле disabled должно быть логическим значением');
  }
  return { disabled: source.disabled === true };
}

function rememberConfig(config) {
  cachedConfig = cloneConfig(config);
  cacheExpiresAt = Date.now() + ONLINE_ORDERING_CACHE_TTL_MS;
  return cloneConfig(cachedConfig);
}

function handleReadFailure(error) {
  if (cachedConfig) {
    logger.warn(
      { err: error, event: 'online_ordering_refresh_failed' },
      'Using cached online ordering settings',
    );
    return cloneConfig(cachedConfig);
  }

  const isProduction =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.VERCEL);
  if (!isProduction) {
    logger.warn(
      { err: error, event: 'online_ordering_load_failed' },
      'Online ordering stays enabled outside production',
    );
    return cloneConfig(DEFAULT_ONLINE_ORDERING_CONFIG);
  }

  throw Object.assign(new Error('Настройка онлайн-заказов временно недоступна'), {
    statusCode: 503,
    code: 'ONLINE_ORDERING_CONFIG_UNAVAILABLE',
    cause: error,
  });
}

async function getOnlineOrderingConfig({ forceRefresh = false } = {}) {
  if (process.env.NODE_ENV === 'test' && !forceRefresh) {
    return cloneConfig(DEFAULT_ONLINE_ORDERING_CONFIG);
  }
  if (!forceRefresh && cachedConfig && Date.now() < cacheExpiresAt) {
    return cloneConfig(cachedConfig);
  }

  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', ONLINE_ORDERING_KEY)
      .maybeSingle();
    if (error) throw error;
    return rememberConfig(
      data ? normalizeOnlineOrderingConfig(data.value) : DEFAULT_ONLINE_ORDERING_CONFIG,
    );
  } catch (error) {
    return handleReadFailure(error);
  }
}

async function updateOnlineOrderingConfig(value) {
  const config = normalizeOnlineOrderingConfig(value, { strict: true });
  const { error } = await supabase.from('settings').upsert(
    {
      key: ONLINE_ORDERING_KEY,
      value: JSON.stringify(config),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) {
    throw Object.assign(new Error('Не удалось сохранить режим онлайн-заказов'), {
      statusCode: 500,
      code: 'ONLINE_ORDERING_SAVE_FAILED',
      cause: error,
    });
  }
  return rememberConfig(config);
}

function resetOnlineOrderingCache() {
  cachedConfig = null;
  cacheExpiresAt = 0;
}

module.exports = {
  DEFAULT_ONLINE_ORDERING_CONFIG,
  ONLINE_ORDERING_DISABLED_MESSAGE,
  ONLINE_ORDERING_KEY,
  getOnlineOrderingConfig,
  normalizeOnlineOrderingConfig,
  resetOnlineOrderingCache,
  updateOnlineOrderingConfig,
};
