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
  appId: String(process.env.IIKO_ASTANA_APP_ID || process.env.IIKO_APP_ID || '').trim(),
  clientSecret: String(
    process.env.IIKO_ASTANA_CLIENT_SECRET || process.env.IIKO_CLIENT_SECRET || '',
  ).trim(),
  organizationId: String(process.env.IIKO_ASTANA_ORGANIZATION_ID || '').trim(),
  externalMenuId: String(
    process.env.IIKO_ASTANA_EXTERNAL_MENU_ID || process.env.IIKO_EXTERNAL_MENU_ID || '',
  ).trim(),
  priceCategoryId: String(
    process.env.IIKO_ASTANA_PRICE_CATEGORY_ID || process.env.IIKO_PRICE_CATEGORY_ID || '',
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
