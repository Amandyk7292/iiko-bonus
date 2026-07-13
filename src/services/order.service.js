const iikoApi = require('./iiko.service');
const menuService = require('./menu.service');
const { getSettings } = require('./settings.service');

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const productPrice = (product) => Number(product?.sizePrices?.[0]?.price?.currentPrice || 0);

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
    quantities.set(id, (quantities.get(id) || 0) + quantity);
    if (quantities.get(id) > 99) throw badRequest('Количество одной позиции не может превышать 99');
  }

  const canonicalItems = [];
  let subtotal = 0;
  for (const [id, quantity] of quantities) {
    const product = catalog.get(id);
    if (!product) throw badRequest('Один из товаров больше недоступен. Обновите корзину.');
    if (!product.isAvailable) throw badRequest(`«${product.name}» сейчас недоступен`);
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

async function loadOrderCatalog() {
  const rawMenu = await iikoApi.getMenu();
  const [stopIds, productOverrides, categoryOverrides, customProducts] = await Promise.all([
    iikoApi.getStopListProductIds().catch(() => new Set()),
    menuService.getProductOverrides(),
    menuService.getCategoryOverrides(),
    menuService.getCustomProducts(),
  ]);
  const productOverrideMap = new Map(productOverrides.map((item) => [item.iiko_product_id, item]));
  const hiddenCategories = new Set(
    categoryOverrides.filter((item) => item.is_hidden).map((item) => item.iiko_category_id),
  );
  const catalog = new Map();

  for (const product of rawMenu.products || []) {
    const override = productOverrideMap.get(product.id);
    if (override?.is_hidden || hiddenCategories.has(product.parentGroup)) continue;
    const price =
      Number(override?.custom_price) > 0 ? Number(override.custom_price) : productPrice(product);
    if (!price) continue;
    catalog.set(String(product.id), {
      iikoProductId: String(product.id),
      productSizeId: product.sizePrices?.[0]?.sizeId || null,
      name: override?.custom_name || product.name,
      price,
      isAvailable: !stopIds.has(product.id) && !override?.is_stop_listed,
      source: 'iiko',
    });
  }

  for (const product of customProducts) {
    catalog.set(String(product.id), {
      iikoProductId: null,
      name: product.name,
      price: Number(product.price),
      isAvailable: product.is_available !== false,
      source: 'custom',
    });
  }
  return catalog;
}

async function priceOrder(items, promoCode) {
  const [catalog, settings] = await Promise.all([loadOrderCatalog(), getSettings()]);
  const priced = calculateOrderTotal(items, catalog);
  return { ...priced, ...applyPromoCode(priced.subtotal, promoCode, settings.bonus_promocodes) };
}

module.exports = { applyPromoCode, calculateOrderTotal, loadOrderCatalog, priceOrder };
