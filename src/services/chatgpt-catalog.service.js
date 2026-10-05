const { normalizeMenuOrderType } = require('../utils/menu-visibility.util');

const catalogError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode, expose: true });
const text = (value, maximum = 300) =>
  String(value ?? '')
    .trim()
    .slice(0, maximum);
const number = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const stringList = (value, maximum = 30) =>
  (Array.isArray(value) ? value : []).slice(0, maximum).map((item) => text(item, 160));
const searchKey = (value) => text(value, 2000).normalize('NFKC').toLocaleLowerCase('ru-RU');
const languageCode = (value) => {
  const code = text(value).split(',')[0].split('-')[0].toLowerCase();
  return ['ru', 'kk', 'en'].includes(code) ? code : 'ru';
};

// Widgets load images only from Bulka. The existing image endpoint accepts
// storage object paths, never arbitrary external URLs or private buckets.
function publicImageUrl(value, baseUrl = process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz') {
  if (!value) return null;
  try {
    const base = new URL(baseUrl);
    const source = new URL(String(value), base);
    if (source.protocol !== 'https:' || source.username || source.password) return null;
    if (source.origin === base.origin) {
      if (source.pathname === '/api/public/image') {
        const objectPath = source.searchParams.get('path') || '';
        if (!/^(?:menu_images|stories)\/[A-Za-z0-9_./ -]+$/.test(objectPath)) return null;
        source.search = new URLSearchParams({ path: objectPath, edge: '384', mode: 'photo' });
      }
      return source.href;
    }
    const storage = new URL(process.env.SUPABASE_URL);
    if (source.origin !== storage.origin) return null;
    const prefix = '/storage/v1/object/public/';
    if (!source.pathname.startsWith(prefix)) return null;
    const objectPath = decodeURIComponent(source.pathname.slice(prefix.length));
    if (
      objectPath.length > 500 ||
      !/^(?:menu_images|stories)\/[A-Za-z0-9_./ -]+$/.test(objectPath) ||
      objectPath.split('/').some((part) => !part || part === '.' || part === '..')
    )
      return null;
    const proxy = new URL('/api/public/image', base);
    proxy.search = new URLSearchParams({ path: objectPath, edge: '384', mode: 'photo' });
    return proxy.href;
  } catch (_) {
    return null;
  }
}

function publicBranch(branch) {
  const hours = {};
  for (const [day, schedule] of Object.entries(branch.hours || {})) {
    if (!['daily', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(day)) continue;
    if (schedule?.closed === true) hours[day] = { closed: true };
    else if (schedule && typeof schedule === 'object')
      hours[day] = { open: text(schedule.open, 5), close: text(schedule.close, 5) };
  }
  return {
    id: text(branch.id, 100),
    name: text(branch.name, 160),
    city: text(branch.city, 100),
    address: text(branch.address, 300),
    hours,
    pickupEnabled: branch.pickupEnabled !== false,
    deliveryEnabled: branch.deliveryEnabled === true,
    preorderEnabled: branch.preorderEnabled !== false,
  };
}

function publicProduct(product) {
  return {
    id: text(product.id, 100),
    name: text(product.name, 160),
    description: text(product.description, 3000),
    price: number(product.price),
    categoryId: text(product.categoryId, 160),
    imageUrl: publicImageUrl(product.imageUrl),
    isAvailable: product.isAvailable === true,
    inStopList: product.inStopList === true,
    onlineOrderable: product.onlineOrderable === true,
    availableQuantity: number(product.availableQuantity),
    inStockCount: number(product.inStockCount),
    quantityStep: number(product.quantityStep, 1),
    unit: text(product.unit || 'шт.', 30),
    preparationMinutes: number(product.preparationMinutes, 15),
    ingredients: text(product.ingredients, 3000),
    allergens: stringList(product.allergens),
    dietaryTags: stringList(product.dietaryTags),
    searchKeywords: stringList(product.searchKeywords),
    weightGrams: number(product.weightGrams),
    nutrition: {
      caloriesKcal: number(product.nutrition?.caloriesKcal),
      proteinGrams: number(product.nutrition?.proteinGrams),
      fatGrams: number(product.nutrition?.fatGrams),
      carbsGrams: number(product.nutrition?.carbsGrams),
    },
    storageConditions: (product.storageConditions || []).slice(0, 2).map((condition) => ({
      temperature: text(condition.temperature, 80),
      durationValue: number(condition.durationValue),
      durationUnit: text(condition.durationUnit, 10),
    })),
    fulfillmentTypes: stringList(product.fulfillmentTypes, 3).filter((type) =>
      ['pickup', 'delivery', 'preorder'].includes(type),
    ),
    badges: (product.badges || []).slice(0, 10).map((badge) => ({
      id: text(badge.id, 100),
      label: text(badge.label, 100),
      background: /^#[0-9a-f]{6}$/i.test(badge.background) ? badge.background : null,
      foreground: /^#[0-9a-f]{6}$/i.test(badge.foreground) ? badge.foreground : null,
    })),
  };
}

const translations = (value) => ({
  ru: text(value?.ru, 160),
  kk: text(value?.kk, 160),
  en: text(value?.en, 160),
});
const builderOption = (option) => ({
  id: text(option.id || option.code, 100),
  code: text(option.code || option.id, 100),
  title: translations(option.title),
  priceDelta: number(option.priceDelta ?? option.price_delta, 0),
});
function publicOptions(options) {
  const config = options?.configuration;
  return {
    configuration: config
      ? {
          productId: text(config.productId, 100),
          productKind: text(config.productKind, 30),
          enabled: config.enabled === true,
          allowInscription: config.allowInscription === true,
          inscriptionMaxLength: number(config.inscriptionMaxLength, 80),
          allowCandles: config.allowCandles === true,
          allowReferenceUpload: config.allowReferenceUpload === true,
          minLeadHours: number(config.minLeadHours, 0),
          maxAdvanceDays: number(config.maxAdvanceDays, 30),
          weightOptions: (config.weightOptions || []).slice(0, 50).map(builderOption),
          fillingOptions: (config.fillingOptions || []).slice(0, 50).map(builderOption),
          designOptions: (config.designOptions || []).slice(0, 50).map(builderOption),
        }
      : null,
    modifierGroups: (options?.modifierGroups || []).slice(0, 30).map((group) => ({
      id: text(group.id, 100),
      productId: text(group.productId, 100),
      code: text(group.code, 100),
      title: translations(group.title),
      selectionType: text(group.selectionType, 20),
      required: group.required === true,
      minSelected: number(group.minSelected, 0),
      maxSelected: number(group.maxSelected, 1),
      options: (group.options || []).slice(0, 100).map((option) => ({
        ...builderOption(option),
        isDefault: option.isDefault === true,
      })),
    })),
  };
}

function createChatgptCatalogService({
  loadMenu = (input) => require('./public-menu.service').loadPublicMenu(input),
  loadLocations = () => require('./location.service').getBulkaLocations(),
  loadOptionFlags = (ids) => require('./product-options.service').getProductOptionFlags(ids),
  loadOptions = (ids) => require('./product-options.service').getProductOptions(ids),
} = {}) {
  async function findBranches({ city = '', query = '' } = {}) {
    const locations = (await loadLocations()).filter((branch) => branch.active !== false);
    const cityKey = searchKey(city);
    const queryKey = searchKey(query);
    return {
      view: 'branches',
      cities: [...new Set(locations.map((branch) => text(branch.city, 100)).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, 'ru'),
      ),
      branches: locations
        .filter(
          (branch) =>
            !cityKey || [branch.city, branch.cityId].some((v) => searchKey(v) === cityKey),
        )
        .filter(
          (branch) =>
            !queryKey ||
            searchKey([branch.name, branch.city, branch.address].join(' ')).includes(queryKey),
        )
        .map(publicBranch),
    };
  }

  async function getFullMenu({ branchId, orderType = 'pickup', language = 'ru' } = {}) {
    const normalizedOrderType = normalizeMenuOrderType(orderType);
    if (!normalizedOrderType) throw catalogError('Некорректный тип заказа');
    const id = text(branchId, 100);
    if (!id) throw catalogError('Выберите точку Bulka');
    const locations = await loadLocations();
    const selected = locations.find(
      (branch) => String(branch.id) === id && branch.active !== false,
    );
    if (!selected) throw catalogError('Филиал больше недоступен', 404);
    const branch = publicBranch(selected);
    if (!branch[`${normalizedOrderType}Enabled`])
      throw catalogError('Выбранный тип заказа в этом филиале временно недоступен');
    const menu = await loadMenu({
      branchId: id,
      orderType: normalizedOrderType,
      language: languageCode(language),
    });
    return {
      branch,
      orderType: normalizedOrderType,
      currency: 'KZT',
      categories: menu.categories.map((category) => ({
        id: text(category.id, 160),
        name: text(category.name, 160),
        imageUrl: publicImageUrl(category.imageUrl),
      })),
      products: menu.products.map(publicProduct),
      revision: number(menu.revision, 0),
    };
  }

  async function getMenu({ query = '', categoryId = '', limit = 24, offset = 0, ...input } = {}) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 48 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 5000
    )
      throw catalogError('Некорректная страница меню');
    const menu = await getFullMenu(input);
    const queryKey = searchKey(query);
    const products = menu.products.filter(
      (product) =>
        (!categoryId || product.categoryId === categoryId) &&
        (!queryKey ||
          searchKey(
            [product.name, product.description, ...product.searchKeywords].join(' '),
          ).includes(queryKey)),
    );
    const page = products.slice(offset, offset + limit);
    const flags = await loadOptionFlags(page.map((product) => product.id));
    return {
      ...menu,
      view: 'menu',
      products: page.map((product) => ({ ...product, hasOptions: flags.get(product.id) === true })),
      query: text(query, 150),
      categoryId: text(categoryId, 160),
      limit,
      total: products.length,
      offset,
      hasMore: offset + page.length < products.length,
    };
  }

  async function getProductOptions({ productId, ...input } = {}) {
    const menu = await getFullMenu(input);
    const id = text(productId, 100);
    if (!menu.products.some((product) => product.id === id))
      throw catalogError('Этот товар больше недоступен в выбранном меню', 404);
    const optionMap = await loadOptions([id]);
    return {
      view: 'options',
      branch: menu.branch,
      orderType: menu.orderType,
      language: languageCode(input.language),
      productId: id,
      product: menu.products.find((product) => product.id === id),
      options: publicOptions(optionMap.get(id)),
    };
  }

  return { findBranches, getMenu, getProductOptions, getFullMenu };
}

module.exports = { ...createChatgptCatalogService(), createChatgptCatalogService, publicImageUrl };
