const { supabase } = require('../config/supabase');
const { cancelPaidOrder } = require('./customer-order.service');

const ACCEPTANCE_TIMEOUT_MS = 15 * 60 * 1000;
const TIMEOUT_REASON = 'Заказ не принят филиалом в течение 15 минут.';

async function cancelUnacceptedOrders({
  db = supabase,
  cancel = cancelPaidOrder,
  now = Date.now(),
  limit = 50,
} = {}) {
  const cutoff = new Date(now - ACCEPTANCE_TIMEOUT_MS).toISOString();
  // A process may stop after claiming a refund or after the bank accepted it.
  // Keep its original idempotency key and reconcile/retry that same operation.
  const { error: recoveryError } = await db
    .from('kaspi_orders')
    .update({ refund_status: 'unknown', refund_error: 'Автоотмена ожидает подтверждения банка' })
    .eq('status', 'paid')
    .eq('refund_status', 'processing')
    .not('acceptance_timeout_at', 'is', null)
    .lt('acceptance_timeout_retry_at', new Date(now - 5 * 60_000).toISOString());
  if (recoveryError) throw recoveryError;
  const { data, error } = await db
    .from('kaspi_orders')
    .select('*')
    .eq('status', 'paid')
    .or('refund_status.is.null,refund_status.eq.failed,refund_status.eq.unknown')
    .or(
      `and(fulfillment_status.eq.new,staff_acceptance_requested_at.lte.${cutoff}),acceptance_timeout_at.not.is.null`,
    )
    .or(
      `acceptance_timeout_retry_at.is.null,acceptance_timeout_retry_at.lte.${new Date(now).toISOString()}`,
    )
    .order('staff_acceptance_requested_at')
    .limit(limit);
  if (error) throw error;
  const results = [];
  const failures = [];
  for (const order of data || []) {
    try {
      await cancel(order, TIMEOUT_REASON, {
        allowedFulfillmentStatuses: order.acceptance_timeout_at ? ['cancelled'] : ['new'],
        cancelBeforeRefund: true,
        reuseRefundRequestId: true,
        acceptPendingRefund: false,
        unacceptedBefore: cutoff,
      });
      results.push(order.id);
    } catch (failure) {
      // Acceptance won the compare-and-set. Do not cancel its courier or retry
      // this order as if the refund had been claimed.
      if (['PAYMENT_REFUND_CONFLICT', 'CUSTOMER_ORDER_CANCELLATION_CLOSED'].includes(failure.code))
        continue;
      failures.push(failure);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Не все автоотмены подтверждены');
  return { cancelled: results.length };
}

module.exports = { cancelUnacceptedOrders, ACCEPTANCE_TIMEOUT_MS, TIMEOUT_REASON };
