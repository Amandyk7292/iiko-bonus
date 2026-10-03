const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');

const canEditInventoryUnit = (admin) => ['owner', 'admin'].includes(admin?.role);
const unitError = (error) =>
  Object.assign(
    new Error(
      error.code === '55P03' || error.code === '40P01'
        ? 'Остаток обновляется. Повторите сохранение.'
        : error.message || 'Не удалось сохранить единицу товара',
    ),
    {
      statusCode:
        error.code === '22023'
          ? 400
          : ['P0001', '40001', '40P01', '55P03'].includes(error.code)
            ? 409
            : 503,
      code: 'PRODUCT_INVENTORY_UNIT_CONFLICT',
    },
  );

async function getProductInventoryUnit(admin, productId, { db = supabase } = {}) {
  const { data, error } = await db.rpc('get_product_inventory_unit', { p_product: productId });
  if (error) throw unitError(error);
  return { ...data, canEdit: canEditInventoryUnit(admin) };
}

async function setProductInventoryUnit(admin, productId, unit, { db = supabase } = {}) {
  if (!canEditInventoryUnit(admin)) {
    throw Object.assign(new Error('Единицу для всех филиалов меняет только администратор'), {
      statusCode: 403,
      code: 'PRODUCT_INVENTORY_UNIT_FORBIDDEN',
    });
  }
  const { data, error } = await db.rpc('set_product_inventory_unit', {
    p_product: productId,
    p_unit: unit,
    p_actor: String(admin.sub || admin.username || 'admin').slice(0, 160),
  });
  if (error) throw unitError(error);
  realtime.publish('menu.updated', { inventory: true, productId }, { broadcast: true });
  return { ...data, canEdit: true };
}

async function listProductInventoryUnits({ db = supabase, productIds = [] } = {}) {
  const ids = [...new Set(productIds.map(String))];
  const batches = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  const pages = await Promise.all(
    batches.map((batch) =>
      db.from('product_inventory_units').select('product_id,unit').in('product_id', batch),
    ),
  );
  const units = new Map();
  for (const { data, error } of pages) {
    if (error) throw unitError(error);
    for (const row of data || []) units.set(String(row.product_id), row.unit);
  }
  return units;
}

module.exports = {
  canEditInventoryUnit,
  getProductInventoryUnit,
  setProductInventoryUnit,
  listProductInventoryUnits,
};
