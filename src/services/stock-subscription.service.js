const { supabase } = require('../config/supabase');
const { sendPushToCustomer } = require('./push.service');

const stockError = (message, statusCode = 400, code = 'STOCK_SUBSCRIPTION_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

const normalizeSubscription = (row) => ({
  id: String(row.id),
  productId: String(row.product_id),
  productName: row.product_name || null,
  branchId: String(row.branch_id),
  status: row.status,
  createdAt: row.created_at,
  notifiedAt: row.notified_at || null,
});

async function currentAvailability(branchId, productId) {
  const now = new Date().toISOString();
  const [inventoryResult, reservationsResult] = await Promise.all([
    supabase
      .from('branch_product_inventory')
      .select('product_id,product_name,source_quantity,manual_stop')
      .eq('branch_id', branchId)
      .eq('product_id', productId)
      .maybeSingle(),
    supabase
      .from('inventory_reservations')
      .select('quantity,status,expires_at')
      .eq('branch_id', branchId)
      .eq('product_id', productId)
      .in('status', ['active', 'committed']),
  ]);
  if (inventoryResult.error) throw inventoryResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  const inventory = inventoryResult.data;
  if (!inventory) return { tracked: false, available: true, productName: null };
  const reserved = (reservationsResult.data || []).reduce((total, reservation) => {
    if (reservation.status === 'active' && String(reservation.expires_at) <= now) return total;
    return total + Math.max(0, Number(reservation.quantity) || 0);
  }, 0);
  const quantity =
    inventory.source_quantity == null ? null : Math.max(0, Number(inventory.source_quantity) || 0);
  return {
    tracked: true,
    available:
      inventory.manual_stop !== true && (quantity == null || Math.max(0, quantity - reserved) > 0),
    productName: inventory.product_name || null,
  };
}

async function listStockSubscriptions(customerId) {
  const { data, error } = await supabase
    .from('customer_stock_subscriptions')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', ['active', 'notified'])
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map(normalizeSubscription);
}

async function stockSubscriptionStatus(customerId, productId, branchId) {
  const { data, error } = await supabase
    .from('customer_stock_subscriptions')
    .select('*')
    .eq('customer_id', customerId)
    .eq('product_id', productId)
    .eq('branch_id', branchId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return {
    subscribed: Boolean(data),
    subscription: data ? normalizeSubscription(data) : null,
  };
}

async function subscribeToStock(customerId, { productId, branchId }) {
  const [{ data: branch, error: branchError }, availability] = await Promise.all([
    supabase
      .from('bulka_locations')
      .select('id,active')
      .eq('id', branchId)
      .eq('active', true)
      .maybeSingle(),
    currentAvailability(branchId, productId),
  ]);
  if (branchError) throw branchError;
  if (!branch) throw stockError('Филиал не найден', 404, 'STOCK_BRANCH_NOT_FOUND');
  if (!availability.tracked || availability.available) {
    throw stockError('Товар уже доступен для заказа', 409, 'PRODUCT_ALREADY_AVAILABLE');
  }
  const row = {
    customer_id: customerId,
    product_id: productId,
    branch_id: branchId,
    product_name: availability.productName,
    status: 'active',
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('customer_stock_subscriptions')
    .insert(row)
    .select('*')
    .single();
  if (error?.code === '23505') {
    const existing = await stockSubscriptionStatus(customerId, productId, branchId);
    return existing.subscription;
  }
  if (error) throw error;
  return normalizeSubscription(data);
}

async function cancelStockSubscription(customerId, subscriptionId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('customer_stock_subscriptions')
    .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
    .eq('id', subscriptionId)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw stockError('Подписка не найдена', 404, 'STOCK_SUBSCRIPTION_NOT_FOUND');
  }
}

async function notifyAvailableStock(branchId, productIds = []) {
  const normalizedIds = [...new Set(productIds.map(String).filter(Boolean))].slice(0, 500);
  if (!branchId || normalizedIds.length === 0) return 0;
  const { data, error } = await supabase
    .from('customer_stock_subscriptions')
    .select('*')
    .eq('branch_id', branchId)
    .in('product_id', normalizedIds)
    .eq('status', 'active')
    .limit(2000);
  if (error) throw error;
  let notified = 0;
  const availabilityCache = new Map();
  for (const subscription of data || []) {
    let availability = availabilityCache.get(subscription.product_id);
    if (!availability) {
      availability = await currentAvailability(branchId, subscription.product_id);
      availabilityCache.set(subscription.product_id, availability);
    }
    if (!availability.available) continue;
    const { data: claimed, error: claimError } = await supabase.rpc(
      'claim_stock_subscription_notification',
      {
        p_subscription_id: subscription.id,
      },
    );
    if (claimError) throw claimError;
    if (claimed?.status !== 'notified') continue;
    await sendPushToCustomer(claimed.customerId, claimed.title, claimed.body, {
      type: 'product_back_in_stock',
      productId: String(claimed.productId),
      branchId: String(claimed.branchId),
      notificationId: String(claimed.notificationId || ''),
      deepLink: `/catalog/product/${encodeURIComponent(
        claimed.productId,
      )}?branch=${encodeURIComponent(claimed.branchId)}`,
    }).catch((pushError) => console.error('Back-in-stock push failed:', pushError.message));
    notified += 1;
  }
  return notified;
}

module.exports = {
  cancelStockSubscription,
  currentAvailability,
  listStockSubscriptions,
  notifyAvailableStock,
  stockSubscriptionStatus,
  subscribeToStock,
};
