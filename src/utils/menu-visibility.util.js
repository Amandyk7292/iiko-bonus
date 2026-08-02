const categoryNameKey = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ru-RU');

const MENU_FULFILLMENT_TYPES = Object.freeze(['pickup', 'delivery', 'preorder']);

const normalizeMenuOrderType = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return MENU_FULFILLMENT_TYPES.includes(normalized) ? normalized : null;
};

const fulfillmentTypesForProduct = (product) => {
  const configured = product?.fulfillment_types ?? product?.fulfillmentTypes;
  if (!Array.isArray(configured)) return [...MENU_FULFILLMENT_TYPES];
  return [...new Set(configured.map(normalizeMenuOrderType).filter((value) => value !== null))];
};

const productSupportsFulfillmentType = (product, orderType) => {
  const normalized = normalizeMenuOrderType(orderType);
  return normalized !== null && fulfillmentTypesForProduct(product).includes(normalized);
};

const categoryNameKeys = (category, override = {}) =>
  new Set(
    [category?.name, override.custom_name, ...Object.values(override.name_translations || {})]
      .map(categoryNameKey)
      .filter(Boolean),
  );

const getHiddenCategoryVisibility = (categories, overridesById) => {
  const ids = new Set();
  const names = new Set();
  for (const category of categories) {
    const override = overridesById.get(category.id);
    if (!override?.is_hidden) continue;
    for (const name of categoryNameKeys(category, override)) names.add(name);
  }

  // iiko may return duplicate category IDs with the same visible name. Hiding
  // one of them must hide all duplicates, otherwise the category appears to
  // turn itself back on in both the admin filter and customer catalog.
  for (const category of categories) {
    const override = overridesById.get(category.id);
    if ([...categoryNameKeys(category, override)].some((name) => names.has(name))) {
      ids.add(category.id);
    }
  }
  return { ids, names };
};

const filterProductsByVisibleCategories = (categories, products) => {
  const visibleCategoryIds = new Set(categories.map((category) => category.id));
  return products.filter((product) => visibleCategoryIds.has(product.categoryId));
};

module.exports = {
  MENU_FULFILLMENT_TYPES,
  categoryNameKey,
  filterProductsByVisibleCategories,
  fulfillmentTypesForProduct,
  getHiddenCategoryVisibility,
  normalizeMenuOrderType,
  productSupportsFulfillmentType,
};
