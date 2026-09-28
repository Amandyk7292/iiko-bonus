const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');
const { cancelPaidOrder } = require('./customer-order.service');
const { cancelExternalDeliveryForOrder } = require('./external-delivery-lifecycle.service');

const COURIER_TIMEOUT_MS = 20 * 60_000;
let running = false;
async function processOrderWaiting({
  db = supabase,
  cancel = cancelPaidOrder,
  closeDelivery = (id) =>
    cancelExternalDeliveryForOrder(id, {
      cancel: (orderId) =>
        require('./yandex-delivery.service').cancelDelivery(orderId, { onlyUnassigned: true }),
    }),
  publish = realtime.publish,
  now = Date.now(),
} = {}) {
  if (running) return;
  running = true;
  try {
    const { data: notices, error: noticeError } = await db.rpc('claim_order_waiting_notices');
    if (noticeError) throw noticeError;
    for (const notice of notices || []) {
      publish(
        'order.attention',
        {
          orderId: notice.order_id,
          orderNumber: notice.order_number,
          stage: notice.stage,
          paymentStatus: 'paid',
        },
        {
          adminOnly: true,
          branchId: notice.branch_id,
          roles:
            notice.stage === 5
              ? ['owner', 'admin', 'branch_manager']
              : ['cashier', 'owner', 'admin', 'branch_manager'],
        },
      );
    }
    const { error: recoveryError } = await db
      .from('kaspi_orders')
      .update({
        refund_status: 'unknown',
        refund_error: 'Автоотмена без курьера ожидает подтверждения банка',
      })
      .eq('status', 'paid')
      .eq('refund_status', 'processing')
      .not('courier_timeout_at', 'is', null)
      .lt('courier_timeout_retry_at', new Date(now - 5 * 60_000).toISOString());
    if (recoveryError) throw recoveryError;
    const cutoff = new Date(now - COURIER_TIMEOUT_MS).toISOString();
    const { data: orders, error } = await db
      .from('kaspi_orders')
      .select('*')
      .eq('status', 'paid')
      .or('refund_status.is.null,refund_status.eq.failed,refund_status.eq.unknown')
      .or(
        `and(courier_search_started_at.lte.${cutoff},courier_assigned_at.is.null,courier_id.is.null,fulfillment_status.in.(accepted,preparing,ready)),courier_timeout_at.not.is.null`,
      )
      .or(
        `courier_timeout_retry_at.is.null,courier_timeout_retry_at.lte.${new Date(now).toISOString()}`,
      )
      .order('courier_search_started_at')
      .limit(50);
    if (error) throw error;
    const failures = [];
    for (let order of orders || []) {
      try {
        if (order.fulfillment_status !== 'cancelled') {
          const { data: claimed, error: claimError } = await db.rpc('claim_courier_timeout', {
            p_order: order.id,
            p_before: cutoff,
          });
          if (claimError) throw claimError;
          if (!claimed?.length) continue;
          order = claimed[0];
          await closeDelivery(order.id);
        }
        await cancel(order, 'Нет курьера', {
          allowedFulfillmentStatuses: [order.fulfillment_status],
          cancelBeforeRefund: true,
          reuseRefundRequestId: true,
          acceptPendingRefund: false,
          courierTimeout: true,
        });
      } catch (failure) {
        if (
          [
            'COURIER_TIMEOUT_NOT_UNASSIGNED',
            'PAYMENT_REFUND_CONFLICT',
            'CUSTOMER_ORDER_CANCELLATION_CLOSED',
          ].includes(failure.code)
        ) {
          const { error: releaseError } = await db
            .from('kaspi_orders')
            .update({ courier_timeout_at: null })
            .eq('id', order.id)
            .eq('courier_timeout_at', order.courier_timeout_at)
            .is('refund_status', null);
          if (releaseError) failures.push(releaseError);
          continue;
        }
        failures.push(failure);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Не все отмены без курьера подтверждены');
  } finally {
    running = false;
  }
}
module.exports = { processOrderWaiting, COURIER_TIMEOUT_MS };
