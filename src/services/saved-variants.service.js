const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { priceOrder } = require('./order.service');
const { getProductOptions } = require('./product-options.service');

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const cleanSelection = (configuration, modifiers) => ({
  configuration: configuration && Object.keys(configuration).length ? configuration : null,
  modifiers: Array.isArray(modifiers) ? modifiers : [],
});
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  return value;
}
function selectionKey(productId, configuration, modifiers) {
  const sortedModifiers = (modifiers || [])
    .map((group) => ({
      ...group,
      optionIds: [...(group.optionIds || [])].sort(),
    }))
    .sort((left, right) => String(left.groupId).localeCompare(String(right.groupId)));
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        stableValue({
          productId,
          configuration: configuration || null,
          modifiers: sortedModifiers,
        }),
      ),
    )
    .digest('hex');
}
function hasSelection(selection) {
  const config = selection.configuration || {};
  return (
    ['weight', 'filling', 'design', 'inscription', 'referenceUrl'].some((key) =>
      Boolean(String(config[key] || '').trim()),
    ) ||
    Number(config.candles || 0) > 0 ||
    selection.modifiers.some(
      (group) => Array.isArray(group.optionIds) && group.optionIds.length > 0,
    )
  );
}

async function previewScheduledAt(
  productIds,
  { options = getProductOptions, now = Date.now() } = {},
) {
  const configurations = await options([...new Set(productIds)]);
  const hasBuilder = [...configurations.values()].some(
    (entry) => entry.configuration?.enabled && entry.configuration.productKind !== 'standard',
  );
  if (!hasBuilder) return null;
  const longest = Math.max(
    0,
    ...[...configurations.values()].map((entry) =>
      entry.configuration?.enabled && entry.configuration.productKind !== 'standard'
        ? Number(entry.configuration.minLeadHours || 0)
        : 0,
    ),
  );
  return new Date(now + (longest + 1) * 3600000).toISOString();
}
async function preview(
  items,
  branchId,
  orderType,
  { price = priceOrder, options = getProductOptions } = {},
) {
  const scheduledAt = await previewScheduledAt(
    items.map((item) => item.id),
    { options },
  );
  return price(items, null, { branchId, orderType, scheduledAt });
}
function normalize(row) {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    configuration: row.configuration,
    modifiers: row.modifiers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function listSavedVariants(customerId, productId = null, { db = supabase } = {}) {
  let query = db
    .from('customer_saved_variants')
    .select('*')
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false })
    .limit(30);
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalize);
}
async function saveVariant(
  customerId,
  payload,
  { db = supabase, price = priceOrder, options = getProductOptions } = {},
) {
  const selection = cleanSelection(payload.configuration, payload.modifiers);
  if (!hasSelection(selection)) throw fail('Выберите начинку или добавки для сохранения.');
  await preview(
    [{ id: payload.productId, quantity: 1, ...selection }],
    payload.branchId,
    payload.orderType,
    { price, options },
  );
  const key = selectionKey(payload.productId, selection.configuration, selection.modifiers);
  const existing = await listSavedVariants(customerId, null, { db });
  if (
    existing.length >= 20 &&
    !existing.some(
      (item) =>
        item.productId === payload.productId &&
        selectionKey(item.productId, item.configuration, item.modifiers) === key,
    )
  ) {
    throw fail('Можно сохранить не более 20 вариантов. Удалите один из старых.');
  }
  const { data, error } = await db
    .from('customer_saved_variants')
    .upsert(
      {
        customer_id: customerId,
        product_id: payload.productId,
        name: payload.name,
        configuration: selection.configuration || {},
        modifiers: selection.modifiers,
        selection_key: key,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,selection_key' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return normalize(data);
}
async function quoteSavedVariant(
  customerId,
  id,
  payload,
  { db = supabase, price = priceOrder, options = getProductOptions } = {},
) {
  const { data, error } = await db
    .from('customer_saved_variants')
    .select('*')
    .eq('id', id)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw fail('Сохранённый вариант не найден', 404);
  const selection = cleanSelection(data.configuration, data.modifiers);
  const quoted = await preview(
    [{ id: data.product_id, quantity: payload.quantity || 1, ...selection }],
    payload.branchId,
    payload.orderType,
    { price, options },
  );
  return {
    ...quoted.canonicalItems[0],
    configuration: selection.configuration,
    modifiers: selection.modifiers,
  };
}
async function deleteSavedVariant(customerId, id, { db = supabase } = {}) {
  const { error } = await db
    .from('customer_saved_variants')
    .delete()
    .eq('customer_id', customerId)
    .eq('id', id);
  if (error) throw error;
}
module.exports = {
  listSavedVariants,
  saveVariant,
  quoteSavedVariant,
  deleteSavedVariant,
  previewScheduledAt,
  selectionKey,
};
