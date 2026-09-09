const { categoryNameKey, getHiddenCategoryVisibility } = require('../utils/menu-visibility.util');
const menuService = require('./menu.service');
const { getIikoClientForBranch } = require('./iiko-city-profile.service');
const { getBranchAvailability } = require('./inventory.service');
const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');
const { branchCatalogSource } = require('./branch-catalog-source.service');

function cashierBranch(admin) {
  const branches = [...new Set(admin?.branchIds || [])];
  if (admin?.role !== 'cashier' || branches.length !== 1) {
    throw Object.assign(new Error('Каталог доступен кассиру назначенной точки'), {
      statusCode: 403,
    });
  }
  return branches[0];
}

function visibleCashierProducts({ rawMenu, overrides, categories, custom, stopIds, inventory }) {
  const settings = new Map(overrides.map((p) => [p.iiko_product_id, p]));
  const hidden = getHiddenCategoryVisibility(
    rawMenu.groups || [],
    new Map(categories.map((c) => [c.iiko_category_id, c])),
  );
  const hiddenGroups = hidden.ids;
  const hiddenNames = hidden.names;
  const raw = rawMenu.products || [];
  const typedMenu = raw.some((p) => ['Dish', 'Good'].includes(p.type));
  const result = [];
  for (const p of raw) {
    const o = settings.get(p.id) || {};
    if (
      o.is_hidden ||
      hiddenGroups.has(p.parentGroup) ||
      p.isDeleted ||
      (typedMenu && !['Dish', 'Good'].includes(p.type))
    )
      continue;
    const price = Number(o.custom_price || p.sizePrices?.[0]?.price?.currentPrice || p.price || 0);
    if (price <= 0) continue;
    result.push({
      id: p.id,
      name: o.custom_name || p.name,
      price,
      imageUrl: o.custom_image_url || p.imageLinks?.[0] || '',
      isIikoProduct: true,
      category: (rawMenu.groups || []).find((g) => g.id === p.parentGroup)?.name || '',
      blockedBy: o.is_stop_listed ? 'admin' : stopIds.has(p.iikoProductId || p.id) ? 'iiko' : null,
    });
  }
  for (const p of custom) {
    const o = settings.get(p.id) || {};
    if (
      o.is_hidden ||
      hiddenGroups.has(p.category_id) ||
      hiddenNames.has(categoryNameKey(p.category_name)) ||
      Number(p.price) <= 0
    )
      continue;
    result.push({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      imageUrl: p.image_url || '',
      isIikoProduct: false,
      category: p.category_name || '',
      blockedBy: !p.is_available || o.is_stop_listed ? 'admin' : stopIds.has(p.id) ? 'iiko' : null,
    });
  }
  return result.map((p) => {
    const stock = inventory.get(String(p.id));
    return {
      ...p,
      sourceQuantity: stock?.sourceQuantity ?? null,
      availableQuantity: stock?.availableQuantity ?? null,
      reserved: stock?.reserved ?? 0,
      manualStop: stock?.manualStop === true,
      revision: stock?.revision ?? 0,
      stockSource: !p.isIikoProduct || stock?.source === 'admin' ? 'manual' : 'iiko',
      frontQuantity: stock?.frontQuantity ?? null,
    };
  });
}

async function loadCashierCatalog(admin) {
  const branchId = cashierBranch(admin);
  const iiko = await getIikoClientForBranch(branchId);
  const scope = { strict: true, profileKey: iiko.profileKey };
  const [{ rawMenu, stopIds }, overrides, categories, custom, inventory] = await Promise.all([
    branchCatalogSource(iiko, branchId),
    menuService.getProductOverrides(scope),
    menuService.getCategoryOverrides(scope),
    menuService.getCustomProducts(scope),
    getBranchAvailability(branchId, { strict: true, online: false }),
  ]);
  const { data: branch, error } = await supabase
    .from('bulka_locations')
    .select('id,name,address,city,active')
    .eq('id', branchId)
    .maybeSingle();
  if (error) throw error;
  if (!branch || !branch.active)
    throw Object.assign(new Error('Филиал больше недоступен'), { statusCode: 403 });
  return {
    branchId,
    branch,
    frontSync: inventory.frontSync,
    products: visibleCashierProducts({
      rawMenu,
      overrides,
      categories,
      custom,
      inventory,
      stopIds,
    }),
  };
}

async function updateCashierProduct(admin, productId, payload) {
  // Re-check administrator restrictions on every mutation, including stale tabs.
  const catalog = await loadCashierCatalog(admin);
  const product = catalog.products.find((p) => p.id === productId);
  if (payload.useIiko && (!product?.isIikoProduct || !catalog.frontSync?.connected)) {
    throw Object.assign(new Error('Нет свежих остатков iikoFront'), { statusCode: 409 });
  }
  if (!product || product.blockedBy)
    throw Object.assign(new Error('Товар отключён администратором или в iiko'), {
      statusCode: 403,
    });
  const { expectedRevision, ...changes } = payload;
  const { data, error } = await supabase.rpc('update_cashier_inventory', {
    p_branch_id: catalog.branchId,
    p_product_id: product.id,
    p_product_name: product.name,
    p_expected_revision: expectedRevision,
    p_changes: changes,
  });
  if (error)
    throw Object.assign(
      new Error(
        error.code === '40001'
          ? 'Остаток уже изменился. Проверьте новые данные и повторите сохранение.'
          : 'Не удалось сохранить остаток',
      ),
      { statusCode: error.code === '40001' ? 409 : 503 },
    );
  realtime.publish(
    'menu.updated',
    { inventory: true, branchId: catalog.branchId, productId },
    { adminOnly: true, branchId: catalog.branchId },
  );
  const { notifyAvailableStock } = require('./stock-subscription.service');
  const { runBackgroundTask } = require('../utils/background-task.util');
  runBackgroundTask('Cashier stock notification', () =>
    notifyAvailableStock(catalog.branchId, [productId]),
  );
  return data;
}

module.exports = {
  cashierBranch,
  visibleCashierProducts,
  loadCashierCatalog,
  updateCashierProduct,
};
