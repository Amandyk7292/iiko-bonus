const { supabase } = require('../config/supabase');
const { priceOrder } = require('./order.service');
const { normalizeMenuOrderType } = require('../utils/menu-visibility.util');

const appError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function listFavorites(customerId) {
  const { data, error } = await supabase
    .from('customer_favorites')
    .select('product_id,created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({ productId: row.product_id, createdAt: row.created_at }));
}

async function setFavorite(customerId, productId, favorite) {
  const id = String(productId || '').trim();
  if (!id || id.length > 100) throw appError('Товар не найден');
  if (favorite) {
    const { error } = await supabase
      .from('customer_favorites')
      .upsert(
        { customer_id: customerId, product_id: id },
        { onConflict: 'customer_id,product_id' },
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('customer_favorites')
      .delete()
      .eq('customer_id', customerId)
      .eq('product_id', id);
    if (error) throw error;
  }
  return favorite;
}

async function recordProductView(customerId, productId) {
  const id = String(productId || '').trim();
  if (!id || id.length > 100) throw appError('Товар не найден');
  const { data: current, error: readError } = await supabase
    .from('customer_recent_products')
    .select('view_count')
    .eq('customer_id', customerId)
    .eq('product_id', id)
    .maybeSingle();
  if (readError) throw readError;
  const { error } = await supabase.from('customer_recent_products').upsert(
    {
      customer_id: customerId,
      product_id: id,
      view_count: Math.min(100000, Number(current?.view_count || 0) + 1),
      viewed_at: new Date().toISOString(),
    },
    { onConflict: 'customer_id,product_id' },
  );
  if (error) throw error;
  return true;
}

async function listRecent(customerId, limit = 20) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const { data, error } = await supabase
    .from('customer_recent_products')
    .select('product_id,view_count,viewed_at')
    .eq('customer_id', customerId)
    .order('viewed_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data || []).map((row) => ({
    productId: row.product_id,
    viewCount: Number(row.view_count || 0),
    viewedAt: row.viewed_at,
  }));
}

async function recommendations(customerId, limit = 16) {
  const safeLimit = Math.min(40, Math.max(1, Number(limit) || 16));
  const [
    { data: recent, error: recentError },
    { data: favorites, error: favoriteError },
    { data: orders, error: orderError },
  ] = await Promise.all([
    supabase
      .from('customer_recent_products')
      .select('product_id,view_count,viewed_at')
      .eq('customer_id', customerId)
      .order('viewed_at', { ascending: false })
      .limit(50),
    supabase.from('customer_favorites').select('product_id').eq('customer_id', customerId),
    supabase
      .from('kaspi_orders')
      .select('cart_items,created_at')
      .eq('customer_id', customerId)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  if (recentError) throw recentError;
  if (favoriteError) throw favoriteError;
  if (orderError) throw orderError;
  const scores = new Map();
  const add = (id, score, reason) => {
    const key = String(id || '').trim();
    if (!key) return;
    const current = scores.get(key) || { productId: key, score: 0, reasons: new Set() };
    current.score += score;
    current.reasons.add(reason);
    scores.set(key, current);
  };
  for (const row of favorites || []) add(row.product_id, 50, 'favorite');
  for (const [index, row] of (recent || []).entries()) {
    add(
      row.product_id,
      Math.max(4, 24 - index) + Math.min(10, Number(row.view_count || 0)),
      'recent',
    );
  }
  for (const [orderIndex, order] of (orders || []).entries()) {
    for (const item of Array.isArray(order.cart_items) ? order.cart_items : []) {
      add(item.id || item.productId, Math.max(3, 18 - orderIndex), 'ordered');
    }
  }
  return [...scores.values()]
    .sort(
      (left, right) => right.score - left.score || left.productId.localeCompare(right.productId),
    )
    .slice(0, safeLimit)
    .map((entry) => ({ ...entry, reasons: [...entry.reasons] }));
}

async function reorder(customerId, orderId, branchId = null) {
  const { data: order, error } = await supabase
    .from('kaspi_orders')
    .select('id,cart_items,branch_id,fulfillment_type')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw appError('Заказ не найден', 404);
  const source = Array.isArray(order.cart_items) ? order.cart_items : [];
  if (!source.length) throw appError('В заказе нет доступных позиций', 409);
  const items = source.map((item) => ({
    id: String(item.id || item.productId || ''),
    quantity: Number(item.quantity || 1),
    configuration: item.configuration || null,
    modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
  }));
  const orderType = normalizeMenuOrderType(order.fulfillment_type) || 'pickup';
  const priced = await priceOrder(items, null, {
    branchId: branchId || order.branch_id || null,
    orderType,
  });
  return {
    items: priced.canonicalItems,
    subtotal: priced.subtotal,
    total: priced.total,
    orderType,
  };
}

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

const orderSignature = (items) =>
  JSON.stringify(
    (Array.isArray(items) ? items : [])
      .map((item) => ({
        id: String(item.id || item.productId || ''),
        quantity: Math.max(1, Number(item.quantity || 1)),
        configuration: stableValue(item.configuration || null),
        modifiers: stableValue(Array.isArray(item.modifiers) ? item.modifiers : []),
      }))
      .filter((item) => item.id)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );

async function usualOrder(customerId, branchId = null, orderType = 'pickup') {
  const normalizedOrderType = normalizeMenuOrderType(orderType);
  if (!normalizedOrderType) throw appError('Некорректный способ получения заказа');
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error } = await supabase
    .from('kaspi_orders')
    .select('id,order_number,cart_items,amount,branch_id,branch_name,fulfillment_type,created_at')
    .eq('customer_id', customerId)
    .eq('status', 'paid')
    .eq('fulfillment_type', normalizedOrderType)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const groups = new Map();
  for (const order of orders || []) {
    const signature = orderSignature(order.cart_items);
    if (signature === '[]') continue;
    const current = groups.get(signature) || { count: 0, latest: order };
    current.count += 1;
    if (String(order.created_at) > String(current.latest.created_at)) current.latest = order;
    groups.set(signature, current);
  }
  const selected = [...groups.values()].sort(
    (left, right) =>
      right.count - left.count ||
      String(right.latest.created_at).localeCompare(String(left.latest.created_at)),
  )[0];
  if (!selected) return null;
  const source = Array.isArray(selected.latest.cart_items) ? selected.latest.cart_items : [];
  const items = source.map((item) => ({
    id: String(item.id || item.productId || ''),
    quantity: Number(item.quantity || 1),
    configuration: item.configuration || null,
    modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
  }));
  const priced = await priceOrder(items, null, {
    branchId: branchId || selected.latest.branch_id || null,
    orderType: normalizedOrderType,
  });
  return {
    sourceOrderId: selected.latest.id,
    sourceOrderNumber: Number(selected.latest.order_number || 0),
    timesOrdered: selected.count,
    lastOrderedAt: selected.latest.created_at,
    branchId: branchId || selected.latest.branch_id || null,
    branch: selected.latest.branch_name || '',
    items: priced.canonicalItems,
    subtotal: priced.subtotal,
    total: priced.total,
    orderType: normalizedOrderType,
  };
}

async function saveCartSnapshot(customerId, payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 50) : [];
  if (!items.length) {
    const { error } = await supabase
      .from('customer_cart_snapshots')
      .delete()
      .eq('customer_id', customerId);
    if (error) throw error;
    return null;
  }
  const orderType = normalizeMenuOrderType(payload.orderType) || 'pickup';
  const priced = await priceOrder(items, null, {
    branchId: payload.branchId || null,
    orderType,
  });
  const { data, error } = await supabase
    .from('customer_cart_snapshots')
    .upsert(
      {
        customer_id: customerId,
        branch_id: payload.branchId || null,
        items: priced.canonicalItems,
        total: priced.total,
        updated_at: new Date().toISOString(),
        abandoned_notified_at: null,
        converted_order_id: null,
      },
      { onConflict: 'customer_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  listFavorites,
  listRecent,
  recommendations,
  recordProductView,
  reorder,
  saveCartSnapshot,
  setFavorite,
  usualOrder,
};
