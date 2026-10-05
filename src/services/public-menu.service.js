const { supabase } = require('../config/supabase');
const { getIikoClientForCity } = require('./iiko-city-profile.service');
const {
  getBranchAvailability,
  refreshBranchInventoryInBackground,
} = require('./inventory.service');
const {
  categoryNameKey,
  effectiveProductCategory,
  filterProductsByVisibleCategories,
  fulfillmentTypesForProduct,
  getHiddenCategoryVisibility,
  normalizeMenuOrderType,
  productSupportsFulfillmentType,
} = require('../utils/menu-visibility.util');

const publicMenuError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode, publicMenuValidation: true });

// Shared with the customer app and ChatGPT. All published visibility, prices,
// quantities and stop lists pass through one authoritative menu loader.
async function loadPublicMenu({ branchId = '', orderType = 'pickup', language = 'ru' } = {}) {
  branchId = String(branchId || '').trim();
  orderType = normalizeMenuOrderType(orderType || 'pickup');
  if (!orderType) {
    throw publicMenuError('Некорректный тип заказа', 400);
  }
  if (
    branchId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)
  ) {
    throw publicMenuError('Некорректный филиал', 400);
  }
  const langHeader = String(language || 'ru');
  const lang = langHeader.split(',')[0].split('-')[0].toLowerCase();

  const { localizeCatalogField } = require('../utils/catalog-localization.util');
  const getLocalized = (override, fieldName, fallbackName) =>
    localizeCatalogField(override, fieldName, fallbackName, lang);

  const getStorageConditions = (product) =>
    (Array.isArray(product?.storage_conditions) ? product.storage_conditions : [])
      .slice(0, 2)
      .map((condition) => ({
        temperature: String(condition?.temperature || '').trim(),
        durationValue: Number(condition?.duration_value || 0),
        durationUnit: String(condition?.duration_unit || '').trim(),
      }))
      .filter(
        (condition) =>
          condition.temperature &&
          Number.isInteger(condition.durationValue) &&
          condition.durationValue > 0 &&
          ['hours', 'days', 'months'].includes(condition.durationUnit),
      );

  const { data: branchSettings, error: branchSettingsError } = branchId
    ? await supabase
        .from('bulka_locations')
        .select('city,default_preparation_minutes,pickup_enabled,delivery_enabled,preorder_enabled')
        .eq('id', branchId)
        .eq('active', true)
        .maybeSingle()
    : { data: null, error: null };
  if (branchSettingsError) throw branchSettingsError;
  if (branchId && !branchSettings) {
    throw publicMenuError('Филиал больше недоступен', 404);
  }

  const selectedIikoApi = getIikoClientForCity(branchSettings?.city);

  // Menu visibility, prices and stop-list state are order-critical. If one
  // source is unavailable, fail the request instead of publishing stale or
  // partially configured products.
  const menuService = require('../services/menu.service');
  const {
    branchCatalogSource,
    branchProductAvailable,
  } = require('../services/branch-catalog-source.service');
  const [
    { rawMenu, stopIds },
    productOverrides,
    categoryOverrides,
    customProducts,
    branchAvailability,
    productBadges,
  ] = await Promise.all([
    // Keep iiko authentication ordered while fetching independent database
    // sources concurrently with its remote menu request.
    branchCatalogSource(selectedIikoApi, branchId),
    menuService.getProductOverrides({
      strict: true,
      profileKey: selectedIikoApi.profileKey,
    }),
    menuService.getCategoryOverrides({
      strict: true,
      profileKey: selectedIikoApi.profileKey,
    }),
    menuService.getCustomProducts({
      strict: true,
      profileKey: selectedIikoApi.profileKey,
    }),
    branchId
      ? getBranchAvailability(branchId, { strict: true, preorder: orderType === 'preorder' })
      : Promise.resolve(new Map()),
    require('../services/product-badges.service').publicBadgeMap(undefined, lang),
  ]);
  const rawGroups = Array.isArray(rawMenu.groups) ? rawMenu.groups : [];
  const rawProducts = Array.isArray(rawMenu.products) ? rawMenu.products : [];

  const prodOverridesMap = new Map(productOverrides.map((o) => [o.iiko_product_id, o]));
  const catOverridesMap = new Map(categoryOverrides.map((o) => [o.iiko_category_id, o]));
  const branchSupportsOrderType =
    !branchSettings ||
    (orderType === 'pickup' && branchSettings.pickup_enabled !== false) ||
    (orderType === 'delivery' && branchSettings.delivery_enabled === true) ||
    (orderType === 'preorder' && branchSettings.preorder_enabled !== false);
  if (!branchSupportsOrderType) {
    throw publicMenuError('Выбранный тип заказа в этом филиале временно недоступен', 400);
  }
  const branchPreparationMinutes = Number(branchSettings?.default_preparation_minutes || 15);
  if (branchId) {
    refreshBranchInventoryInBackground(branchId, {
      products: rawProducts,
      iikoClient: selectedIikoApi,
    });
  }

  // Categories
  const baseCategories = rawGroups
    .filter(
      (g) =>
        g.isIncludedInMenu ||
        (rawGroups.length > 0 && !rawGroups.some((g2) => g2.isIncludedInMenu)),
    )
    .map((g) => ({
      id: g.id,
      name: g.name,
      order: g.order || 0,
    }));

  const { ids: hiddenCategoryIds, names: hiddenCategoryNames } = getHiddenCategoryVisibility(
    baseCategories,
    catOverridesMap,
  );

  // Применяем оверрайды к категориям
  const categories = [];
  for (const cat of baseCategories) {
    const override = catOverridesMap.get(cat.id);
    if (hiddenCategoryIds.has(cat.id)) continue;

    categories.push({
      id: cat.id,
      name: getLocalized(override, 'name', cat.name),
      order: override && override.sort_order ? override.sort_order : cat.order,
      imageUrl: (override && override.custom_image_url) || null,
    });
  }

  categories.sort((a, b) => a.order - b.order);

  // Products
  const baseProducts = rawProducts.filter(
    (p) =>
      p.type === 'Dish' ||
      p.type === 'Good' ||
      (rawProducts.length > 0 &&
        !rawProducts.some((p2) => p2.type === 'Dish' || p2.type === 'Good')),
  );

  const products = [];
  for (const p of baseProducts) {
    const override = prodOverridesMap.get(p.id);
    const categoryId = effectiveProductCategory(p, override, rawGroups);
    if (override && override.is_hidden) continue;
    if (!productSupportsFulfillmentType(override, orderType)) continue;
    // Пропускаем продукты из скрытых категорий
    if (hiddenCategoryIds.has(categoryId)) continue;

    let price = 0;
    if (p.sizePrices && p.sizePrices.length > 0) {
      price = Number(p.sizePrices[0]?.price?.currentPrice || 0);
    }

    // Скрываем товары с ценой 0 (служебные позиции iiko)
    if (!price || price <= 0) continue;

    let imageUrl = null;
    if (p.imageLinks && p.imageLinks.length > 0) {
      imageUrl = p.imageLinks[0];
    }

    const inventory = branchAvailability.get(String(p.id));
    const isStopped =
      Boolean(override && override.is_stop_listed) ||
      (orderType !== 'preorder' && stopIds.has(p.iikoProductId || p.id)) ||
      (branchId && !branchProductAvailable(branchAvailability, p.id));

    products.push({
      id: p.id,
      name: getLocalized(override, 'name', p.name),
      description: getLocalized(override, 'description', p.description || ''),
      price: override && override.custom_price > 0 ? override.custom_price : price,
      categoryId,
      imageUrl: (override && override.custom_image_url) || imageUrl,
      inStopList: isStopped,
      isAvailable: !isStopped,
      availableQuantity: inventory?.availableQuantity ?? null,
      inStockCount: inventory?.availableQuantity ?? null,
      quantityStep: inventory?.quantityStep ?? 1,
      unit: inventory?.unit ?? 'шт.',
      onlineOrderable: !isStopped,
      preparationMinutes: Number(
        inventory?.preparationMinutes || override?.preparation_minutes || branchPreparationMinutes,
      ),
      ingredients: getLocalized(override, 'ingredients', ''),
      allergens: Array.isArray(override?.allergens) ? override.allergens : [],
      badges: productBadges.get(String(p.id)) || [],
      dietaryTags: Array.isArray(override?.dietary_tags) ? override.dietary_tags : [],
      searchKeywords: Array.isArray(override?.search_keywords) ? override.search_keywords : [],
      weightGrams: override?.weight_grams == null ? null : Number(override.weight_grams),
      nutrition: {
        caloriesKcal: override?.calories_kcal == null ? null : Number(override.calories_kcal),
        proteinGrams: override?.protein_grams == null ? null : Number(override.protein_grams),
        fatGrams: override?.fat_grams == null ? null : Number(override.fat_grams),
        carbsGrams: override?.carbs_grams == null ? null : Number(override.carbs_grams),
      },
      storageConditions: getStorageConditions(override),
      sortOrder: (override && override.sort_order) || 0,
      fulfillmentTypes: fulfillmentTypesForProduct(override),
    });
  }

  // Добавляем кастомные товары (добавленные админом вручную)
  for (const cp of customProducts) {
    if (!productSupportsFulfillmentType(cp, orderType)) continue;
    // A custom product must not recreate a category that the administrator hid.
    if (hiddenCategoryNames.has(categoryNameKey(cp.category_name))) continue;
    // Ищем или создаём категорию для кастомного товара
    const categoryName = getLocalized(null, 'name', cp.category_name);
    let cat = categories.find((c) => c.name === categoryName);
    let catId;
    if (cat) {
      catId = cat.id;
    } else {
      catId = 'custom-cat-' + cp.category_name.toLowerCase().replace(/\s+/g, '-');
      categories.push({
        id: catId,
        name: categoryName,
        order: 999, // в конец
        imageUrl: null,
      });
    }

    const inventory = branchAvailability.get(String(cp.id));
    products.push({
      id: cp.id,
      name: getLocalized(cp, 'name', cp.name),
      description: getLocalized(cp, 'description', cp.description || ''),
      price: cp.price,
      categoryId: catId,
      imageUrl: cp.image_url,
      inStopList:
        !cp.is_available || (branchId && !branchProductAvailable(branchAvailability, cp.id)),
      isAvailable:
        cp.is_available && (!branchId || branchProductAvailable(branchAvailability, cp.id)),
      availableQuantity: inventory?.availableQuantity ?? null,
      inStockCount: inventory?.availableQuantity ?? null,
      quantityStep: inventory?.quantityStep ?? 1,
      unit: inventory?.unit ?? 'шт.',
      onlineOrderable:
        cp.is_available && (!branchId || branchProductAvailable(branchAvailability, cp.id)),
      preparationMinutes: Number(
        inventory?.preparationMinutes || cp.preparation_minutes || branchPreparationMinutes,
      ),
      ingredients: getLocalized(cp, 'ingredients', ''),
      allergens: Array.isArray(cp.allergens) ? cp.allergens : [],
      badges: productBadges.get(String(cp.id)) || [],
      dietaryTags: Array.isArray(cp.dietary_tags) ? cp.dietary_tags : [],
      searchKeywords: Array.isArray(cp.search_keywords) ? cp.search_keywords : [],
      weightGrams: cp.weight_grams == null ? null : Number(cp.weight_grams),
      nutrition: {
        caloriesKcal: cp.calories_kcal == null ? null : Number(cp.calories_kcal),
        proteinGrams: cp.protein_grams == null ? null : Number(cp.protein_grams),
        fatGrams: cp.fat_grams == null ? null : Number(cp.fat_grams),
        carbsGrams: cp.carbs_grams == null ? null : Number(cp.carbs_grams),
      },
      storageConditions: getStorageConditions(cp),
      sortOrder: cp.sort_order || 0,
      fulfillmentTypes: fulfillmentTypesForProduct(cp),
    });
  }

  // Final allowlist prevents orphaned products from leaking when iiko returns a
  // product for a category that is hidden or absent from the published menu.
  const publishedProducts = filterProductsByVisibleCategories(categories, products);
  const publishedCategoryIds = new Set(publishedProducts.map((product) => product.categoryId));
  const publishedCategories = categories.filter((category) =>
    publishedCategoryIds.has(category.id),
  );

  // Сортировка товаров (если нужен кастомный порядок)
  publishedProducts.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    success: true,
    categories: publishedCategories,
    products: publishedProducts,
    revision: Math.max(
      0,
      ...productOverrides.map((item) => Date.parse(item.updated_at) || 0),
      ...categoryOverrides.map((item) => Date.parse(item.updated_at) || 0),
      ...customProducts.map((item) => Date.parse(item.updated_at) || 0),
    ),
    branchId: branchId || null,
    orderType,
    iikoProfile: rawMenu.profileKey || 'default',
  };
}

module.exports = { loadPublicMenu };
