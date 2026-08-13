const { supabase } = require('../config/supabase');
const { effectiveFulfillmentType, isDeliveryFulfillment } = require('../utils/fulfillment.util');
const realtime = require('./realtime.service');
const { cancelPaidOrder, notifyOrderStatus } = require('./customer-order.service');
const { notifyDeliveryStatus } = require('./courier.service');
const { refreshOrderEta } = require('./eta.service');
const { releaseOrderReservations } = require('./inventory.service');
const {
  assertAutomobileCourierForHandoff,
  dispatchRequestUpdates,
  processDeliveryDispatch,
} = require('./delivery-orchestration.service');
const { runBackgroundTask } = require('../utils/background-task.util');
const { sessionHash } = require('./admin-session.service');

const KITCHEN_ORDER_FIELDS = [
  'id',
  'order_number',
  'branch_id',
  'branch_name',
  'cart_items',
  'comment',
  'substitution_preference',
  'fulfillment_type',
  'preorder_fulfillment_type',
  'fulfillment_status',
  'kitchen_status',
  'created_at',
  'promised_ready_at',
  'scheduled_at',
  'kitchen_started_at',
  'staff_acceptance_requested_at',
  'staff_accepted_at',
  'staff_accepted_by',
  'staff_accepted_installation_id',
  'kitchen_ready_at',
  'handed_to_courier_at',
  'preparation_minutes',
  'courier_id',
  'delivery_status',
  'courier_dispatch_status',
  'courier_dispatch_provider',
  'courier_dispatch_error',
  'customer_arrived_at',
].join(',');

const kitchenError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const TRANSITIONS = {
  queued: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['handed_over', 'cancelled'],
  handed_over: [],
  cancelled: [],
};

const maskedStaffDeviceLabel = (installationId) => {
  const normalized = String(installationId || '').trim();
  if (!normalized) return null;
  return `iPad ••••${normalized.slice(-4).toUpperCase()}`;
};

const normalize = (order) => ({
  id: String(order.id),
  number: Number(order.order_number || 0),
  branchId: order.branch_id,
  branch: order.branch_name || '',
  items: Array.isArray(order.cart_items) ? order.cart_items : [],
  comment: order.comment || null,
  substitutionPreference: order.substitution_preference || 'call_customer',
  fulfillmentType: effectiveFulfillmentType(order),
  fulfillmentStatus: order.fulfillment_status,
  kitchenStatus: order.kitchen_status || 'queued',
  createdAt: order.created_at,
  promisedReadyAt: order.promised_ready_at || order.scheduled_at || null,
  kitchenStartedAt: order.kitchen_started_at || null,
  acceptanceRequestedAt: order.staff_acceptance_requested_at || null,
  acceptedAt: order.staff_accepted_at || null,
  acceptedBy: order.staff_accepted_by || null,
  acceptedDeviceLabel: maskedStaffDeviceLabel(order.staff_accepted_installation_id),
  kitchenReadyAt: order.kitchen_ready_at || null,
  handedToCourierAt: order.handed_to_courier_at || null,
  preparationMinutes: order.preparation_minutes == null ? null : Number(order.preparation_minutes),
  courierId: order.courier_id || null,
  deliveryStatus: order.delivery_status,
  courierDispatchStatus: order.courier_dispatch_status || null,
  courierDispatchProvider: order.courier_dispatch_provider || null,
  courierDispatchError: order.courier_dispatch_error || null,
  customerArrivedAt: order.customer_arrived_at || null,
});

async function resolveAcceptanceAudit(admin, branchId, now) {
  const acceptedBy = String(admin?.sub || admin?.username || '')
    .trim()
    .slice(0, 160);
  const jti = String(admin?.jti || '').trim();
  if (!acceptedBy || !jti) {
    return {
      acceptedBy: acceptedBy || null,
      acceptedSessionHash: jti ? sessionHash(jti) : null,
      acceptedInstallationId: null,
    };
  }

  const acceptedSessionHash = sessionHash(jti);
  const heartbeatCutoff = new Date(Date.parse(now) - 90 * 1000).toISOString();
  const { data, error } = await supabase
    .from('staff_push_devices')
    .select('installation_id')
    .eq('session_jti_hash', acceptedSessionHash)
    .eq('branch_id', branchId)
    .eq('platform', 'ios')
    .eq('active', true)
    .is('revoked_at', null)
    .gte('last_seen_at', heartbeatCutoff)
    .limit(2);
  if (error) throw error;
  const devices = data || [];
  return {
    acceptedBy,
    acceptedSessionHash,
    // An exact installation is only attributable when this authenticated
    // session has one current iPad in the order branch. Ambiguity is retained
    // as null instead of guessing or trusting a client-supplied identifier.
    acceptedInstallationId:
      devices.length === 1 ? String(devices[0].installation_id || '') || null : null,
  };
}

async function listKitchenOrders({ branchId = null, branchIds = [], includeClosed = false } = {}) {
  let query = supabase
    .from('kaspi_orders')
    .select(KITCHEN_ORDER_FIELDS)
    .eq('status', 'paid')
    .order('promised_ready_at', { ascending: true, nullsFirst: false })
    .order('created_at');
  if (branchId) query = query.eq('branch_id', branchId);
  else if (Array.isArray(branchIds) && branchIds.length) query = query.in('branch_id', branchIds);
  if (!includeClosed) query = query.in('kitchen_status', ['queued', 'preparing', 'ready']);
  const { data, error } = await query.limit(300);
  if (error) throw error;
  return (data || []).map(normalize);
}

function runPostUpdateTasks(data, nextStatus) {
  runBackgroundTask(`Kitchen order ${data.id} post-update`, async () => {
    const notify =
      nextStatus === 'handed_over' && isDeliveryFulfillment(data)
        ? notifyDeliveryStatus
        : notifyOrderStatus;
    const etaPromise = refreshOrderEta(data);
    const sideEffectsPromise = Promise.allSettled([
      notify(data),
      ...(nextStatus === 'preparing' && isDeliveryFulfillment(data)
        ? [processDeliveryDispatch(data.id)]
        : []),
      ...(nextStatus === 'handed_over' ? [releaseOrderReservations(data.id)] : []),
    ]);
    const refreshed = await etaPromise.catch((error) => {
      console.error('Kitchen ETA refresh failed:', error.message);
      return data;
    });
    realtime.publish(
      'order.updated',
      {
        orderId: data.id,
        orderNumber: data.order_number,
        kitchenStatus: data.kitchen_status,
        orderStatus: data.fulfillment_status,
        deliveryStatus: data.delivery_status,
        etaMinAt: refreshed.eta_min_at || null,
        etaMaxAt: refreshed.eta_max_at || null,
        etaConfidence: refreshed.eta_confidence || null,
      },
      { customerId: data.customer_id, includeAdmins: true, branchId: data.branch_id },
    );
    const results = await sideEffectsPromise;
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Kitchen post-update side effect failed:', result.reason?.message);
      }
    }
  });
}

async function updateKitchenStatus(
  orderId,
  nextStatus,
  preparationMinutes = null,
  { branchIds = [], cancellationReason = '', iikoManualEntryConfirmed = false, admin = null } = {},
) {
  if (!Object.hasOwn(TRANSITIONS, nextStatus)) throw kitchenError('Некорректный статус кухни');
  const { data: current, error: readError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw kitchenError('Заказ не найден', 404);
  if (
    Array.isArray(branchIds) &&
    branchIds.length &&
    !branchIds.map(String).includes(String(current.branch_id || ''))
  ) {
    throw kitchenError('Заказ не найден', 404);
  }
  const from = current.kitchen_status || 'queued';
  if (from === nextStatus) return normalize(current);
  if (current.status !== 'paid') throw kitchenError('Заказ ещё не оплачен', 409);
  if (['processing', 'unknown'].includes(String(current.refund_status || ''))) {
    throw kitchenError('Нельзя менять кухонный статус, пока проверяется возврат', 409);
  }
  if (!(TRANSITIONS[from] || []).includes(nextStatus)) {
    throw kitchenError(`Нельзя изменить «${from}» на «${nextStatus}»`, 409);
  }
  if (from === 'queued' && nextStatus === 'preparing' && iikoManualEntryConfirmed !== true) {
    throw kitchenError('Подтвердите ручное внесение заказа в iikoFront', 409);
  }
  if (nextStatus === 'handed_over' && isDeliveryFulfillment(current)) {
    await assertAutomobileCourierForHandoff(current);
  }
  const now = new Date().toISOString();
  if (nextStatus === 'cancelled') {
    const reason =
      String(cancellationReason || '')
        .trim()
        .slice(0, 500) || 'Заказ отменён сотрудником точки: товар недоступен';
    await cancelPaidOrder(current, reason, {
      allowedFulfillmentStatuses: [String(current.fulfillment_status || 'new')],
      cancelBeforeRefund: true,
      reuseRefundRequestId: true,
    });
    const { data: cancelled, error: cancelledError } = await supabase
      .from('kaspi_orders')
      .update({ kitchen_status: 'cancelled', updated_at: now })
      .eq('id', orderId)
      .eq('kitchen_status', from)
      .eq('status', 'refunded')
      .eq('fulfillment_status', 'cancelled')
      .eq('refund_status', 'succeeded')
      .select('*')
      .maybeSingle();
    if (cancelledError) throw cancelledError;
    if (!cancelled) throw kitchenError('Заказ уже изменился. Обновите экран.', 409);
    return normalize(cancelled);
  }
  const updates = { kitchen_status: nextStatus, updated_at: now };
  if (preparationMinutes != null) {
    const duration = Number(preparationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      throw kitchenError('Время приготовления должно быть от 1 до 1440 минут');
    }
    updates.preparation_minutes = duration;
    updates.promised_ready_at = new Date(Date.now() + duration * 60000).toISOString();
  }
  if (nextStatus === 'preparing') {
    const acceptance = await resolveAcceptanceAudit(admin, current.branch_id, now);
    updates.kitchen_started_at = now;
    updates.fulfillment_status = 'preparing';
    updates.staff_accepted_at = now;
    updates.staff_accepted_by = acceptance.acceptedBy;
    updates.staff_accepted_session_jti_hash = acceptance.acceptedSessionHash;
    updates.staff_accepted_installation_id = acceptance.acceptedInstallationId;
    Object.assign(updates, dispatchRequestUpdates(current, now));
  }
  if (nextStatus === 'ready') {
    updates.kitchen_ready_at = now;
    updates.fulfillment_status = 'ready';
  }
  if (nextStatus === 'handed_over') {
    updates.handed_to_courier_at = now;
    if (isDeliveryFulfillment(current)) {
      updates.delivery_status = current.courier_id ? 'picked_up' : current.delivery_status;
    } else {
      updates.fulfillment_status = 'completed';
      updates.fulfilled_at = now;
    }
  }
  let updateQuery = supabase
    .from('kaspi_orders')
    .update(updates)
    .eq('id', orderId)
    .eq('kitchen_status', from)
    .eq('status', 'paid');
  updateQuery =
    current.fulfillment_status == null
      ? updateQuery.is('fulfillment_status', null)
      : updateQuery.eq('fulfillment_status', current.fulfillment_status);
  updateQuery = updateQuery.or('refund_status.is.null,refund_status.not.in.(processing,unknown)');
  const { data, error } = await updateQuery.select('*').maybeSingle();
  if (error) throw error;
  if (!data) {
    // A second tap (or a second iPad) may have raced the same acceptance.
    // Return the first immutable acknowledgement instead of overwriting its
    // actor/device or running courier/notification side effects twice.
    if (from === 'queued' && nextStatus === 'preparing') {
      const { data: accepted, error: acceptedError } = await supabase
        .from('kaspi_orders')
        .select(KITCHEN_ORDER_FIELDS)
        .eq('id', orderId)
        .eq('status', 'paid')
        .eq('kitchen_status', 'preparing')
        .maybeSingle();
      if (acceptedError) throw acceptedError;
      if (accepted?.staff_accepted_at) return normalize(accepted);
    }
    throw kitchenError('Заказ уже изменился. Обновите экран.', 409);
  }
  realtime.publish(
    'order.updated',
    {
      orderId: data.id,
      orderNumber: data.order_number,
      kitchenStatus: data.kitchen_status,
      orderStatus: data.fulfillment_status,
      deliveryStatus: data.delivery_status,
      etaMinAt: data.eta_min_at || null,
      etaMaxAt: data.eta_max_at || null,
      etaConfidence: data.eta_confidence || null,
    },
    { customerId: data.customer_id, includeAdmins: true, branchId: data.branch_id },
  );
  runPostUpdateTasks(data, nextStatus);
  return normalize(data);
}

module.exports = { TRANSITIONS, listKitchenOrders, updateKitchenStatus };
