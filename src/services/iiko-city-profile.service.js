const { supabase } = require('../config/supabase');
const defaultIikoApi = require('./iiko.service');

const { IikoAPI } = defaultIikoApi;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASTANA_CITY_NAMES = new Set(['астана', 'astana', 'нур-султан', 'нур султан', 'nur-sultan']);

const normalizeCityName = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

const isAstana = (cityName) => ASTANA_CITY_NAMES.has(normalizeCityName(cityName));

let astanaClient = null;
let astanaClientSignature = '';

const astanaConfiguration = () => ({
  profileKey: 'astana',
  apiLogin: String(process.env.IIKO_ASTANA_API_LOGIN || '').trim(),
  // App identity belongs to the Bulka integration and can authenticate API
  // keys from both city accounts. City-specific values remain an override.
  appId: String(process.env.IIKO_ASTANA_APP_ID || process.env.IIKO_APP_ID || '').trim(),
  clientSecret: String(
    process.env.IIKO_ASTANA_CLIENT_SECRET || process.env.IIKO_CLIENT_SECRET || '',
  ).trim(),
  // Organization, External Menu and price category belong to a concrete iiko
  // account. Never inherit these IDs from the default city profile.
  organizationId: String(process.env.IIKO_ASTANA_ORGANIZATION_ID || '').trim(),
  externalMenuId: String(process.env.IIKO_ASTANA_EXTERNAL_MENU_ID || '').trim(),
  externalMenuName: String(process.env.IIKO_ASTANA_EXTERNAL_MENU_NAME || '').trim(),
  priceCategoryId: String(process.env.IIKO_ASTANA_PRICE_CATEGORY_ID || '').trim(),
  priceCategoryName: String(process.env.IIKO_ASTANA_PRICE_CATEGORY_NAME || '').trim(),
  terminalGroupId: String(process.env.IIKO_ASTANA_TERMINAL_GROUP_ID || '').trim(),
  terminalGroupsJson: String(process.env.IIKO_ASTANA_TERMINAL_GROUPS_JSON || '{}').trim(),
  paymentTypeId: String(process.env.IIKO_ASTANA_PAYMENT_TYPE_ID || '').trim(),
  deliveryAddressFormat: String(
    process.env.IIKO_ASTANA_ADDRESS_FORMAT || process.env.IIKO_ADDRESS_FORMAT || 'city',
  ).trim(),
});

const astanaProfileConfigured = () => Boolean(astanaConfiguration().apiLogin);

const getAstanaClient = () => {
  const configuration = astanaConfiguration();
  if (!configuration.apiLogin) return null;

  const signature = JSON.stringify(configuration);
  if (!astanaClient || signature !== astanaClientSignature) {
    astanaClient = new IikoAPI(configuration);
    astanaClientSignature = signature;
  }
  return astanaClient;
};

const getIikoClientForCity = (cityName) =>
  (isAstana(cityName) && getAstanaClient()) || defaultIikoApi;

async function getIikoClientForBranch(branchId) {
  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedBranchId) return defaultIikoApi;
  if (!UUID_PATTERN.test(normalizedBranchId)) {
    throw Object.assign(new Error('Некорректный филиал'), { statusCode: 400 });
  }

  const { data, error } = await supabase
    .from('bulka_locations')
    .select('id,city,active')
    .eq('id', normalizedBranchId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.active === false) {
    throw Object.assign(new Error('Филиал больше недоступен'), { statusCode: 404 });
  }
  return getIikoClientForCity(data.city);
}

const profileStatus = () => ({
  default: {
    key: 'default',
    configured: Boolean(defaultIikoApi.apiLogin),
  },
  astana: {
    key: 'astana',
    city: 'Астана',
    configured: astanaProfileConfigured(),
    organizationConfigured: Boolean(process.env.IIKO_ASTANA_ORGANIZATION_ID),
    externalMenuConfigured: Boolean(
      process.env.IIKO_ASTANA_EXTERNAL_MENU_ID || process.env.IIKO_ASTANA_EXTERNAL_MENU_NAME,
    ),
    priceCategoryConfigured: Boolean(
      process.env.IIKO_ASTANA_PRICE_CATEGORY_ID || process.env.IIKO_ASTANA_PRICE_CATEGORY_NAME,
    ),
    deliveryConfigured: Boolean(
      process.env.IIKO_ASTANA_TERMINAL_GROUP_ID && process.env.IIKO_ASTANA_PAYMENT_TYPE_ID,
    ),
  },
});

const invalidateAllIikoCaches = () => {
  defaultIikoApi.invalidateMenuCache();
  getAstanaClient()?.invalidateMenuCache();
};

module.exports = {
  astanaProfileConfigured,
  getIikoClientForBranch,
  getIikoClientForCity,
  invalidateAllIikoCaches,
  isAstana,
  normalizeCityName,
  profileStatus,
};
