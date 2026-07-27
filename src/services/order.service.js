const iikoApi = require('./iiko.service');
const menuService = require('./menu.service');
const { supabase } = require('../config/supabase');
const { getSettings } = require('./settings.service');
const { getBranchAvailability } = require('./inventory.service');
const {
  categoryNameKey,
  getHiddenCategoryVisibility,
  normalizeMenuOrderType,
  productSupportsFulfillmentType,
} = require('../utils/menu-visibility.util');
const { validateCartOptions } = require('./product-options.service');
const { resolveTargetedPromotion } = require('./commerce-marketing.service');

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const productPrice = (product) => Number(product?.sizePrices?.[0]?.price?.currentPrice || 0);

const preparationMinutes = (value, fallback = 15) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 240 ? parsed : fallback;
};

function calculateOrderTotal(items, catalog) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest('Корзина пуста');
  if (items.length > 50) throw badRequest('Слишком много позиций в корзине');

  const quantities = new Map();
  for (const item of items) {
    const id = String(item?.id || '').trim();
    const quantity = Number(item?.quantity);
    if (!id || id.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw badRequest('Некорректная позиция корзины');
    }
    const configuration =
      item?.configuration && typeof item.configuration === 'object' ? item.configuration : null;
    const modifiers = Array.isArray(item?.modifiers) ? item.modifiers : [];
    const selectionKey = JSON.stringify({ configuration, modifiers });
    const key = `${id}:${selectionKey}`;
    const previous = quantities.get(key);
    quantities.set(key, {
      id,
      quantity: Number(previous?.quantity || 0) + quantity,
      configuration,
      modifiers,
    });
    if (quantities.get(key).quantity > 99) {
      throw badRequest('Количество одной позиции не может превышать 99');
    }
  }

  const canonicalItems = [];
  let subtotal = 0;
  for (const { id, quantity, configuration, modifiers } of quantities.values()) {
    const product = catalog.get(id);
    if (!product) throw badRequest('Один из товаров больше недоступен. Обновите корзину.');
    if (!product.isAvailable) throw badRequest(`«${product.name}» сейчас недоступен`);
    if (Number.isInteger(product.availableQuantity) && quantity > product.availableQuantity) {
      throw badRequest(
        `Недостаточно товара «${product.name}». Доступно: ${Math.max(product.availableQuantity, 0)}`,
      );
    }
    const price = Number(product.price);
    if (!Number.isFinite(price) || price <= 0) throw badRequest('У товара некорректная цена');

    subtotal += price * quantity;
    canonicalItems.push({
      id,
      iikoProductId: product.iikoProductId || null,
      productSizeId: product.productSizeId || null,
      name: String(product.name || 'Товар').slice(0, 160),
      price,
      quantity,
      source: product.source || 'iiko',
      preparationMinutes: preparationMinutes(product.preparationMinutes),
      configuration,
      modifiers,
    });
  }

  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal > 10000000) {
    throw badRequest('Некорректная сумма заказа');
  }
  return { canonicalItems, subtotal };
}

function applyPromoCode(subtotal, code, configuredPromos = []) {
  const normalized = String(code || '')
    .trim()
    .toUpperCase();
  if (!normalized) return { promoCode: null, discount: 0, total: subtotal };

  const promo = configuredPromos.find(
    (item) =>
      item?.active !== false &&
      String(item?.code || '')
        .trim()
        .toUpperCase() === normalized,
  );
  if (!promo) throw badRequest('Промокод не найден или больше не действует');

  const minOrder = Number(promo.min_order ?? promo.minOrder ?? 0);
  if (Number.isFinite(minOrder) && subtotal < minOrder) {
    throw badRequest(`Промокод действует от суммы ${Math.ceil(minOrder)} ₸`);
  }

  const type = String(promo.type || (promo.discount_percent ? 'percent' : 'fixed'));
  const value = Number(promo.value ?? promo.discount_percent ?? promo.discount_amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) throw badRequest('Промокод настроен некорректно');

  const rawDiscount = type === 'percent' ? (subtotal * Math.min(value, 100)) / 100 : value;
  const discount = Math.min(subtotal - 1, Math.max(0, Math.round(rawDiscount)));
  return { promoCode: normalized, discount, total: subtotal - discount };
}

async function loadOrderCatalog({ branchId = null, orderType = 'pickup' } = {}) {
  const normalizedOrderType = normalizeMenuOrderType(orderType);
  if (!normalizedOrderType) throw badRequest('Некорректный способ получения заказа');
  const rawMenu = await iikoApi.getMenu({ strict: true });
  const [stopIds, productOverrides, categoryOverrides, customProducts] = await Promise.all([
    iikoApi.getStopListProductIds(undefined, { strict: true }),
    menuService.getProductOverrides({ strict: true }),
    menuService.getCategoryOverrides({ strict: true }),
    menuService.getCustomProducts({ strict: true }),
  ]);
  const productOverrideMap = new Map(productOverrides.map((item) => [item.iiko_product_id, item]));
  const categoryOverrideMap = new Map(
    categoryOverrides.map((item) => [item.iiko_category_id, item]),
  );
  const rawGroups = Array.isArray(rawMenu.groups) ? rawMenu.groups : [];
  const baseCategories = rawGroups
    .filter(
      (group) =>
        group.isIncludedInMenu ||
        (rawGroups.length > 0 && !rawGroups.some((item) => item.isIncludedInMenu)),
    )
    .map((group) => ({ id: group.id, name: group.name }));
  const hiddenCategories = getHiddenCategoryVisibility(baseCategories, categoryOverrideMap);
  let branchPreparationMinutes = 15;
  if (branchId) {
    const { data: branch, error: branchError } = await supabase
      .from('bulka_locations')
      .select('default_preparation_minutes')
      .eq('id', branchId)
      .eq('active', true)
      .maybeSingle();
    if (branchError) throw branchError;
    if (!branch) throw badRequest('Филиал больше недоступен');
    branchPreparationMinutes = preparationMinutes(branch.default_preparation_minutes);
  }
  const branchAvailability = branchId
    ? await getBranchAvailability(branchId, {
        sync: true,
        strict: true,
        products: rawMenu.products || [],
      })
    : new Map();
  const catalog = new Map();

  for (const product of rawMenu.products || []) {
    const override = productOverrideMap.get(product.id);
    if (override?.is_hidden || hiddenCategories.ids.has(product.parentGroup)) continue;
    if (!productSupportsFulfillmentType(override, normalizedOrderType)) continue;
    const price =
      Number(override?.custom_price) > 0 ? Number(override.custom_price) : productPrice(product);
    if (!price) continue;
    const inventory = branchAvailability.get(String(product.id));
    const globallyAvailable = !stopIds.has(product.id) && !override?.is_stop_listed;
    catalog.set(String(product.id), {
      iikoProductId: String(product.id),
      productSizeId: product.sizePrices?.[0]?.sizeId || null,
      name: override?.custom_name || product.name,
      price,
      isAvailable: globallyAvailable && (inventory?.isAvailable ?? true),
      availableQuantity: inventory?.availableQuantity ?? null,
      preparationMinutes: preparationMinutes(
        inventory?.preparationMinutes ?? override?.preparation_minutes,
        branchPreparationMinutes,
      ),
      source: 'iiko',
    });
  }

  for (const product of customProducts) {
    if (hiddenCategories.names.has(categoryNameKey(product.category_name))) continue;
    if (!productSupportsFulfillmentType(product, normalizedOrderType)) continue;
    const inventory = branchAvailability.get(String(product.id));
    catalog.set(String(product.id), {
      iikoProductId: null,
      name: product.name,
      price: Number(product.price),
      isAvailable: product.is_available !== false && (inventory?.isAvailable ?? true),
      availableQuantity: inventory?.availableQuantity ?? null,
      preparationMinutes: preparationMinutes(
        inventory?.preparationMinutes ?? product.preparation_minutes,
        branchPreparationMinutes,
      ),
      source: 'custom',
    });
  }
  return catalog;
}

async function priceOrder(
  items,
  promoCode,
  { deliveryFee = 0, branchId = null, customerId = null, orderType = 'pickup' } = {},
) {
  const [catalog, settings] = await Promise.all([
    loadOrderCatalog({ branchId, orderType }),
    getSettings(),
  ]);
  const basePriced = calculateOrderTotal(items, catalog);
  const priced = await validateCartOptions(basePriced.canonicalItems);
  const targetedPromotion = await resolveTargetedPromotion(priced.subtotal, promoCode, {
    customerId,
    branchId,
  });
  const promotion =
    targetedPromotion || applyPromoCode(priced.subtotal, promoCode, settings.bonus_promocodes);
  const normalizedDeliveryFee = Number(deliveryFee);
  if (
    !Number.isSafeInteger(normalizedDeliveryFee) ||
    normalizedDeliveryFee < 0 ||
    normalizedDeliveryFee > 100000
  ) {
    throw badRequest('Некорректная стоимость доставки');
  }
  const total = promotion.total + normalizedDeliveryFee;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 10000000) {
    throw badRequest('Некорректная сумма заказа');
  }
  return {
    ...priced,
    ...promotion,
    preparationMinutes: Math.max(
      1,
      ...priced.canonicalItems.map((item) => preparationMinutes(item.preparationMinutes)),
    ),
    deliveryFee: normalizedDeliveryFee,
    total,
  };
}

module.exports = { applyPromoCode, calculateOrderTotal, loadOrderCatalog, priceOrder };
