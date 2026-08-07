const { supabase } = require('../config/supabase');
const { runBackgroundTask } = require('../utils/background-task.util');
const { getIikoClientForBranch } = require('./iiko-city-profile.service');
const { deterministicUuid, iikoOrderInfo } = require('./iiko.service');

const MAX_SYNC_ATTEMPTS = 10;
const IIKO_ACCEPTED_STATUSES = new Set([
  'WaitCooking',
  'ReadyForCooking',
  'CookingStarted',
  'CookingCompleted',
  'Waiting',
  'OnWay',
  'Delivered',
  'Closed',
]);
const IIKO_READY_STATUSES = new Set([
  'CookingCompleted',
  'Waiting',
  'OnWay',
  'Delivered',
  'Closed',
]);

const retryAt = (attempts) => {
  const seconds = Math.min(30 * 60, 30 * 2 ** Math.max(0, Number(attempts || 1) - 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
};

const stableIikoOrderId = (order) => deterministicUuid(`bulka:${order?.id || order?.operation_id}`);

const readOrder = async (orderId) => {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('*,customers(name,phone),bulka_locations(id,name,city,address,latitude,longitude)')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Заказ не найден'), { statusCode: 404 });
  return data;
};

async function enqueueIikoOrderSync(order, { processImmediately = true } = {}) {
  if (process.env.IIKO_ORDER_EXPORT_ENABLED !== 'true') {
    return { skipped: true, reason: 'disabled' };
  }
  if (!order?.id || order.status !== 'paid') {
    return { skipped: true, reason: 'not_paid' };
  }
  if (order.iiko_sync_status === 'succeeded') {
    return { skipped: true, reason: 'already_synced' };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update({
      iiko_order_id: order.iiko_order_id || stableIikoOrderId(order),
      iiko_sync_status: 'pending',
      iiko_sync_next_attempt_at: now,
      iiko_sync_error: null,
    })
    .eq('id', order.id)
    .eq('status', 'paid')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { skipped: true, reason: 'state_changed' };
  if (processImmediately) {
    runBackgroundTask(`iiko order ${order.id} export`, () => processIikoOrderSync(order.id));
  }
  return { queued: true, orderId: order.id };
}

async function recoverExistingIikoOrder(client, stableId) {
  try {
    const orders = await client.getDeliveryOrdersByIds([stableId]);
    return orders.find((candidate) => String(candidate?.id) === stableId) || null;
  } catch {
    return null;
  }
}

async function processIikoOrderSync(orderId, { client: injectedClient } = {}) {
  const current = await readOrder(orderId);
  if (current.iiko_sync_status === 'succeeded' && current.iiko_order_id) {
    return { skipped: true, reason: 'already_synced' };
  }
  if (current.status !== 'paid' || current.fulfillment_status === 'cancelled') {
    return { skipped: true, reason: 'not_syncable' };
  }
  const attempts = Number(current.iiko_sync_attempts || 0) + 1;
  const stableId = current.iiko_order_id || stableIikoOrderId(current);
  let claim = supabase
    .from('kaspi_orders')
    .update({
      iiko_order_id: stableId,
      iiko_sync_status: 'processing',
      iiko_sync_attempts: attempts,
      iiko_sync_attempted_at: new Date().toISOString(),
      iiko_sync_error: null,
    })
    .eq('id', orderId);
  claim =
    current.iiko_sync_status == null
      ? claim.is('iiko_sync_status', null)
      : claim.eq('iiko_sync_status', current.iiko_sync_status);
  const { data: claimed, error: claimError } = await claim.select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { skipped: true, reason: 'already_processing' };

  const client = injectedClient || (await getIikoClientForBranch(current.branch_id));
  try {
    let result;
    try {
      result = await client.createDeliveryOrder(current);
    } catch (createError) {
      const existing = await recoverExistingIikoOrder(client, stableId);
      if (!existing) throw createError;
      result = { orderInfo: existing, recovered: true };
    }
    const info = iikoOrderInfo(result);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('kaspi_orders')
      .update({
        iiko_order_id: String(info?.id || stableId),
        iiko_pos_order_id: info?.posId || null,
        iiko_sync_status: 'succeeded',
        iiko_sync_next_attempt_at: null,
        iiko_synced_at: now,
        iiko_status_synced_at: now,
        iiko_delivery_status: info?.order?.status || null,
        iiko_sync_error: null,
      })
      .eq('id', orderId)
      .eq('iiko_sync_status', 'processing');
    if (error) throw error;
    return { synced: true, orderId, iikoOrderId: info?.id || stableId, result };
  } catch (error) {
    const exhausted = attempts >= MAX_SYNC_ATTEMPTS;
    await supabase
      .from('kaspi_orders')
      .update({
        iiko_sync_status: exhausted ? 'failed' : 'retrying',
        iiko_sync_next_attempt_at: exhausted ? null : retryAt(attempts),
        iiko_sync_error: String(error?.message || 'Не удалось отправить заказ в iiko').slice(
          0,
          2000,
        ),
      })
      .eq('id', orderId)
      .eq('iiko_sync_status', 'processing');
    throw error;
  }
}

async function recoverStaleSyncClaims() {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id')
    .eq('iiko_sync_status', 'processing')
    .lt('iiko_sync_attempted_at', staleBefore)
    .limit(100);
  if (error) throw error;
  for (const order of data || []) {
    await supabase
      .from('kaspi_orders')
      .update({
        iiko_sync_status: 'retrying',
        iiko_sync_next_attempt_at: new Date().toISOString(),
        iiko_sync_error: 'Предыдущая попытка прервалась и будет безопасно повторена',
      })
      .eq('id', order.id)
      .eq('iiko_sync_status', 'processing');
  }
  return data?.length || 0;
}

async function processIikoOrderSyncQueue(limit = 20) {
  if (process.env.IIKO_ORDER_EXPORT_ENABLED !== 'true') return 0;
  await recoverStaleSyncClaims();
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id')
    .in('iiko_sync_status', ['pending', 'retrying'])
    .lte('iiko_sync_next_attempt_at', new Date().toISOString())
    .order('iiko_sync_next_attempt_at')
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)));
  if (error) throw error;
  for (const order of data || []) {
    await processIikoOrderSync(order.id).catch((syncError) =>
      console.warn(`Повторная отправка заказа ${order.id} в iiko:`, syncError.message),
    );
  }
  return data?.length || 0;
}

const iikoStatusFromInfo = (info) => String(info?.order?.status || info?.status || '').trim();

async function applyIikoDeliveryStatus(
  order,
  status,
  { updateKitchenStatus: injectedUpdate } = {},
) {
  if (!order?.id || !status) return { skipped: true };
  const updateKitchenStatus = injectedUpdate || require('./kitchen.service').updateKitchenStatus;
  let kitchenStatus = String(order.kitchen_status || 'queued');
  if (kitchenStatus === 'queued' && IIKO_ACCEPTED_STATUSES.has(status)) {
    await updateKitchenStatus(order.id, 'preparing');
    kitchenStatus = 'preparing';
  }
  if (kitchenStatus === 'preparing' && IIKO_READY_STATUSES.has(status)) {
    await updateKitchenStatus(order.id, 'ready');
    kitchenStatus = 'ready';
  }
  return { kitchenStatus };
}

async function syncIikoDeliveryStatuses(limit = 50) {
  if (process.env.IIKO_ORDER_EXPORT_ENABLED !== 'true') return 0;
  const { data: orders, error } = await supabase
    .from('kaspi_orders')
    .select(
      'id,branch_id,iiko_order_id,iiko_pos_order_id,iiko_delivery_status,iiko_status_synced_at,kitchen_status,fulfillment_status',
    )
    .eq('status', 'paid')
    .eq('iiko_sync_status', 'succeeded')
    .in('kitchen_status', ['queued', 'preparing', 'ready'])
    .order('iiko_status_synced_at', { ascending: true, nullsFirst: true })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)));
  if (error) throw error;

  const groups = new Map();
  for (const order of orders || []) {
    const key = String(order.branch_id || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  let synchronized = 0;
  for (const [branchId, branchOrders] of groups) {
    const client = await getIikoClientForBranch(branchId);
    const ids = branchOrders.map((order) => order.iiko_order_id).filter(Boolean);
    const statuses = await client.getDeliveryOrdersByIds(ids);
    const byId = new Map(statuses.map((info) => [String(info?.id || ''), info]));
    for (const order of branchOrders) {
      const info = byId.get(String(order.iiko_order_id));
      const status = iikoStatusFromInfo(info);
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('kaspi_orders')
        .update({
          iiko_status_synced_at: now,
          ...(status ? { iiko_delivery_status: status } : {}),
          ...(info?.posId ? { iiko_pos_order_id: info.posId } : {}),
        })
        .eq('id', order.id);
      if (updateError) throw updateError;
      if (status && status !== order.iiko_delivery_status) {
        await applyIikoDeliveryStatus(order, status).catch((statusError) =>
          console.warn(
            `Не удалось применить статус iiko ${status} к заказу ${order.id}:`,
            statusError.message,
          ),
        );
      }
      synchronized += 1;
    }
  }
  return synchronized;
}

module.exports = {
  IIKO_ACCEPTED_STATUSES,
  IIKO_READY_STATUSES,
  applyIikoDeliveryStatus,
  enqueueIikoOrderSync,
  iikoStatusFromInfo,
  processIikoOrderSync,
  processIikoOrderSyncQueue,
  stableIikoOrderId,
  syncIikoDeliveryStatuses,
};
