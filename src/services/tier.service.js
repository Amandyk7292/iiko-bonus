const { supabase } = require('../config/supabase');
const {
  buildLegacyTiers,
  getTierInfo,
  localizeTier,
  normalizeTier,
} = require('../utils/tier.util');

const CACHE_TTL_MS = 15000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const SUPPORTED_LANGUAGES = new Set(['ru', 'kk', 'kz', 'en']);

let activeTierCache = null;
let activeTierCacheExpiresAt = 0;

function createTierError(message, statusCode = 400, code = 'INVALID_TIER', details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function clearTierCache() {
  activeTierCache = null;
  activeTierCacheExpiresAt = 0;
}

function parseNumber(value, field, { min = 0, max = 999999999999.99, integer = false } = {}) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw createTierError(
      `${field} must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}`,
      400,
      'TIER_VALIDATION_ERROR',
      { field },
    );
  }
  return integer ? parsed : Number(parsed.toFixed(2));
}

function parseText(value, field, { min = 1, max = 240 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) {
    throw createTierError(
      `${field} must contain between ${min} and ${max} characters`,
      400,
      'TIER_VALIDATION_ERROR',
      { field },
    );
  }
  return text;
}

function readLocalized(payload, group, language) {
  const snakeGroup = group === 'names' ? 'name' : 'description';
  const camelLanguage = language === 'kk' ? 'Kk' : language[0].toUpperCase() + language.slice(1);
  return (
    payload?.[group]?.[language] ??
    (language === 'kk' ? payload?.[group]?.kz : undefined) ??
    payload?.[`${snakeGroup}_${language}`] ??
    (language === 'kk' ? payload?.[`${snakeGroup}_kz`] : undefined) ??
    payload?.[`${snakeGroup}${camelLanguage}`]
  );
}

function validateTierPayload(payload, { existing = null, partial = false } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createTierError('Tier payload must be an object', 400, 'TIER_VALIDATION_ERROR');
  }

  const base = existing ? normalizeTier(existing) : null;
  const rawCode = payload.code ?? base?.code;
  if (!partial || payload.code !== undefined) {
    const code = String(rawCode || '')
      .trim()
      .toLowerCase();
    if (!CODE_PATTERN.test(code)) {
      throw createTierError(
        'code must start with a letter and contain 2-32 lowercase letters, digits, _ or -',
        400,
        'TIER_VALIDATION_ERROR',
        { field: 'code' },
      );
    }
  }

  const names = {};
  const descriptions = {};
  for (const language of ['ru', 'kk', 'en']) {
    const nameValue = readLocalized(payload, 'names', language) ?? base?.names?.[language];
    if (!partial || readLocalized(payload, 'names', language) !== undefined || payload.names) {
      names[language] = parseText(nameValue, `names.${language}`, { max: 80 });
    } else if (base) {
      names[language] = base.names[language];
    }

    const descriptionInput = readLocalized(payload, 'descriptions', language);
    const descriptionValue = descriptionInput ?? base?.descriptions?.[language] ?? nameValue;
    if (!partial || descriptionInput !== undefined || payload.descriptions) {
      descriptions[language] = parseText(descriptionValue, `descriptions.${language}`, {
        max: 240,
      });
    } else if (base) {
      descriptions[language] = base.descriptions[language];
    }
  }

  const rawMinSpend = payload.minSpend ?? payload.min_spend ?? base?.minSpend;
  const rawCashback = payload.cashbackPercent ?? payload.cashback_percent ?? base?.cashbackPercent;
  const rawSortOrder = payload.sortOrder ?? payload.sort_order ?? base?.sortOrder;
  const rawIsActive = payload.isActive ?? payload.is_active ?? base?.isActive;

  const result = {};
  if (!partial || payload.code !== undefined) result.code = String(rawCode).trim().toLowerCase();
  if (!partial || payload.names !== undefined || Object.keys(names).length > 0)
    result.names = names;
  if (!partial || payload.descriptions !== undefined || Object.keys(descriptions).length > 0) {
    result.descriptions = descriptions;
  }
  if (!partial || payload.minSpend !== undefined || payload.min_spend !== undefined) {
    result.minSpend = parseNumber(rawMinSpend, 'minSpend');
  }
  if (!partial || payload.cashbackPercent !== undefined || payload.cashback_percent !== undefined) {
    result.cashbackPercent = parseNumber(rawCashback, 'cashbackPercent', { max: 100 });
  }
  if (!partial || payload.sortOrder !== undefined || payload.sort_order !== undefined) {
    result.sortOrder = parseNumber(rawSortOrder, 'sortOrder', {
      max: 1000000,
      integer: true,
    });
  }
  if (!partial || payload.isActive !== undefined || payload.is_active !== undefined) {
    if (typeof rawIsActive !== 'boolean') {
      throw createTierError('isActive must be a boolean', 400, 'TIER_VALIDATION_ERROR', {
        field: 'isActive',
      });
    }
    result.isActive = rawIsActive;
  }

  return result;
}

function toDatabaseTier(tier) {
  return {
    code: tier.code,
    name_ru: tier.names.ru,
    name_kk: tier.names.kk,
    name_en: tier.names.en,
    description_ru: tier.descriptions.ru,
    description_kk: tier.descriptions.kk,
    description_en: tier.descriptions.en,
    min_spend: tier.minSpend,
    cashback_percent: tier.cashbackPercent,
    sort_order: tier.sortOrder,
    is_active: tier.isActive,
  };
}

function toApiTier(row) {
  const tier = normalizeTier(row);
  return {
    id: tier.id,
    code: tier.code,
    names: tier.names,
    descriptions: tier.descriptions,
    minSpend: tier.minSpend,
    cashbackPercent: tier.cashbackPercent,
    sortOrder: tier.sortOrder,
    isActive: tier.isActive,
    createdAt: row?.created_at || row?.createdAt || null,
    updatedAt: row?.updated_at || row?.updatedAt || null,
  };
}

function normalizeLanguage(language) {
  const value = String(language || 'ru')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  if (!SUPPORTED_LANGUAGES.has(value)) {
    throw createTierError('language must be ru, kk or en', 400, 'UNSUPPORTED_LANGUAGE', {
      language: value,
    });
  }
  return value === 'kz' ? 'kk' : value;
}

function assertTierSet(tiers, { requireActiveBaseline = true } = {}) {
  const normalized = tiers.map(normalizeTier);
  const codeMap = new Map();
  const thresholdMap = new Map();

  for (const tier of normalized) {
    const codeKey = tier.code.toLowerCase();
    if (codeMap.has(codeKey)) {
      throw createTierError('A tier with this code already exists', 409, 'TIER_CODE_CONFLICT', {
        code: tier.code,
      });
    }
    codeMap.set(codeKey, tier.id);

    const thresholdKey = tier.minSpend.toFixed(2);
    if (thresholdMap.has(thresholdKey)) {
      throw createTierError(
        'Tier spending ranges conflict: minSpend must be unique',
        409,
        'TIER_RANGE_CONFLICT',
        { minSpend: tier.minSpend },
      );
    }
    thresholdMap.set(thresholdKey, tier.id);
  }

  if (requireActiveBaseline) {
    const active = normalized.filter((tier) => tier.isActive);
    if (active.length === 0) {
      throw createTierError(
        'At least one loyalty tier must remain active',
        409,
        'ACTIVE_TIER_REQUIRED',
      );
    }
    if (!active.some((tier) => tier.minSpend === 0)) {
      throw createTierError(
        'An active baseline tier with minSpend 0 is required',
        409,
        'TIER_BASELINE_REQUIRED',
      );
    }
  }
  return normalized;
}

function mapDatabaseError(error) {
  if (error?.code === '23505') {
    if (String(error.message || '').includes('min_spend')) {
      return createTierError(
        'Tier spending ranges conflict: minSpend must be unique',
        409,
        'TIER_RANGE_CONFLICT',
      );
    }
    return createTierError('A tier with this code already exists', 409, 'TIER_CODE_CONFLICT');
  }
  if (error?.code === '23514' || error?.code === '22P02') {
    return createTierError('Tier data violates database constraints', 400, 'TIER_VALIDATION_ERROR');
  }
  if (error?.code === 'P0001' && String(error.message || '').includes('every loyalty tier')) {
    return createTierError(
      'Tier order changed concurrently; reload and try again',
      409,
      'TIER_REORDER_CONFLICT',
    );
  }
  return createTierError('Could not persist loyalty tiers', 500, 'TIER_STORAGE_ERROR');
}

async function listLoyaltyTiers() {
  const { data, error } = await supabase
    .from('loyalty_tiers')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('min_spend', { ascending: true });
  if (error) throw mapDatabaseError(error);
  return (data || []).map(toApiTier);
}

async function getActiveLoyaltyTiers(fallbackSettings = {}, { forceRefresh = false } = {}) {
  if (!forceRefresh && activeTierCache && Date.now() < activeTierCacheExpiresAt) {
    return activeTierCache.map((tier) => ({ ...tier }));
  }

  const { data, error } = await supabase
    .from('loyalty_tiers')
    .select('*')
    .eq('is_active', true)
    .order('min_spend', { ascending: true })
    .order('sort_order', { ascending: true });

  const missingTable = error && ['42P01', 'PGRST205'].includes(error.code);
  if (missingTable) {
    console.warn('Loyalty tier migration is not applied; using legacy settings fallback.');
    return buildLegacyTiers(fallbackSettings);
  }
  if (error) throw mapDatabaseError(error);
  if (!Array.isArray(data) || data.length === 0) {
    throw createTierError('No active loyalty tiers are configured', 503, 'ACTIVE_TIER_REQUIRED');
  }

  activeTierCache = data.map(toApiTier);
  activeTierCacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return activeTierCache.map((tier) => ({ ...tier }));
}

async function createLoyaltyTier(payload) {
  const existing = await listLoyaltyTiers();
  const nextSortOrder = existing.reduce((max, tier) => Math.max(max, tier.sortOrder), -1) + 1;
  const candidate = validateTierPayload(
    {
      ...payload,
      sortOrder: payload?.sortOrder ?? payload?.sort_order ?? nextSortOrder,
      isActive: payload?.isActive ?? payload?.is_active ?? true,
    },
    { partial: false },
  );
  assertTierSet([...existing, candidate]);

  const { data, error } = await supabase
    .from('loyalty_tiers')
    .insert(toDatabaseTier(candidate))
    .select('*')
    .single();
  if (error) throw mapDatabaseError(error);
  clearTierCache();
  return toApiTier(data);
}

async function getTierById(id) {
  if (!UUID_PATTERN.test(String(id || ''))) {
    throw createTierError('Invalid tier id', 400, 'TIER_VALIDATION_ERROR', { field: 'id' });
  }
  const { data, error } = await supabase
    .from('loyalty_tiers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw createTierError('Loyalty tier not found', 404, 'TIER_NOT_FOUND');
  return toApiTier(data);
}

async function updateLoyaltyTier(id, payload) {
  const current = await getTierById(id);
  const supportedKeys = new Set([
    'code',
    'names',
    'descriptions',
    'name_ru',
    'name_kk',
    'name_kz',
    'name_en',
    'nameRu',
    'nameKk',
    'nameEn',
    'description_ru',
    'description_kk',
    'description_kz',
    'description_en',
    'descriptionRu',
    'descriptionKk',
    'descriptionEn',
    'minSpend',
    'min_spend',
    'cashbackPercent',
    'cashback_percent',
    'sortOrder',
    'sort_order',
    'isActive',
    'is_active',
  ]);
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !Object.keys(payload).some((key) => supportedKeys.has(key))
  ) {
    throw createTierError('No supported tier fields supplied', 400, 'TIER_VALIDATION_ERROR');
  }
  const changes = validateTierPayload(payload, { existing: current, partial: true });
  if (Object.keys(changes).length === 0) {
    throw createTierError('No supported tier fields supplied', 400, 'TIER_VALIDATION_ERROR');
  }
  const candidate = { ...current, ...changes };
  const all = await listLoyaltyTiers();
  assertTierSet(all.map((tier) => (tier.id === id ? candidate : tier)));

  const { data, error } = await supabase
    .from('loyalty_tiers')
    .update(toDatabaseTier(candidate))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw mapDatabaseError(error);
  clearTierCache();
  return toApiTier(data);
}

async function setLoyaltyTierActive(id, isActive) {
  if (typeof isActive !== 'boolean') {
    throw createTierError('isActive must be a boolean', 400, 'TIER_VALIDATION_ERROR', {
      field: 'isActive',
    });
  }
  return updateLoyaltyTier(id, { isActive });
}

async function deleteLoyaltyTier(id) {
  const current = await getTierById(id);
  const all = await listLoyaltyTiers();
  assertTierSet(all.filter((tier) => tier.id !== current.id));

  const { data, error } = await supabase
    .from('loyalty_tiers')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw createTierError('Loyalty tier not found', 404, 'TIER_NOT_FOUND');
  clearTierCache();
  return current;
}

async function reorderLoyaltyTiers(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !UUID_PATTERN.test(String(id)))) {
    throw createTierError(
      'ids must be a non-empty array of tier UUIDs',
      400,
      'TIER_VALIDATION_ERROR',
      { field: 'ids' },
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw createTierError('ids must not contain duplicates', 400, 'TIER_VALIDATION_ERROR', {
      field: 'ids',
    });
  }
  const all = await listLoyaltyTiers();
  const existingIds = new Set(all.map((tier) => tier.id));
  if (ids.length !== all.length || ids.some((id) => !existingIds.has(id))) {
    throw createTierError(
      'ids must contain every loyalty tier exactly once',
      409,
      'TIER_REORDER_CONFLICT',
    );
  }

  const { data, error } = await supabase.rpc('reorder_loyalty_tiers', { p_ids: ids });
  if (error) throw mapDatabaseError(error);
  clearTierCache();
  return (data || []).map(toApiTier).sort((left, right) => left.sortOrder - right.sortOrder);
}

async function getConfiguredTierInfo(totalSpent, fallbackSettings = {}) {
  const tiers = await getActiveLoyaltyTiers(fallbackSettings);
  return getTierInfo(totalSpent, tiers, fallbackSettings);
}

function toPublicTier(tier, language = 'ru') {
  const localized = localizeTier(tier, normalizeLanguage(language));
  return {
    id: localized.id,
    code: localized.code,
    name: localized.name,
    description: localized.description,
    names: localized.names,
    descriptions: localized.descriptions,
    minSpend: localized.minSpend,
    cashbackPercent: localized.cashbackPercent,
    sortOrder: localized.sortOrder,
  };
}

module.exports = {
  assertTierSet,
  clearTierCache,
  createLoyaltyTier,
  createTierError,
  deleteLoyaltyTier,
  getActiveLoyaltyTiers,
  getConfiguredTierInfo,
  listLoyaltyTiers,
  normalizeLanguage,
  reorderLoyaltyTiers,
  setLoyaltyTierActive,
  toApiTier,
  toDatabaseTier,
  toPublicTier,
  updateLoyaltyTier,
  validateTierPayload,
};
