const { supabase } = require('../config/supabase');
const { finalizeConfirmedOrderRefund } = require('./customer-order.service');
const { reconcileFullRefundForOrder } = require('./payment-gateway.service');

async function markFullRefundDeclined(order, decision, db = supabase) {
  const message = String(decision?.message || 'Банк отклонил возврат').slice(0, 1000);
  let query = db
    .from('kaspi_orders')
    .update({
      refund_status: 'failed',
      refund_error: message,
      last_error: message,
    })
    .eq('id', order.id)
    .eq('status', 'paid')
    .eq('refund_status', 'unknown');
  if (order.refund_request_id) {
    query = query.eq('refund_request_id', order.refund_request_id);
  }
  if (order.refund_reference) {
    query = query.eq('refund_reference', order.refund_reference);
  }
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw error;
  return data || order;
}

async function reconcileUnknownFullRefundOrder(
  order,
  {
    resolve = reconcileFullRefundForOrder,
    complete = (current, decision) =>
      finalizeConfirmedOrderRefund(current, decision, {
        expectedRefundStatus: 'unknown',
        giftRefundPrepared: current.order_kind === 'gift_certificate',
      }),
    decline = markFullRefundDeclined,
  } = {},
) {
  let decision;
  try {
    decision = await resolve(order);
  } catch (error) {
    decision = {
      status: 'pending',
      reference: order.refund_reference || null,
      requestId: order.refund_request_id || null,
      message: error.message,
    };
  }
  if (decision?.status === 'confirmed') {
    return {
      status: 'confirmed',
      order: await complete(order, decision),
      decision,
    };
  }
  if (decision?.status === 'declined') {
    return {
      status: 'declined',
      order: await decline(order, decision),
      decision,
    };
  }
  return { status: 'pending', order, decision };
}

async function reconcileUnknownFullRefunds({
  limit = 25,
  db = supabase,
  resolve = reconcileFullRefundForOrder,
  complete,
  decline,
} = {}) {
  const batchLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const { data, error } = await db
    .from('kaspi_orders')
    .select('*')
    .eq('payment_method', 'forte_card')
    .eq('provider_payment_system', 'forte_widget')
    .eq('status', 'paid')
    .eq('refund_status', 'unknown')
    .not('refund_reference', 'is', null)
    .order('refund_requested_at', { ascending: true })
    .limit(batchLimit);
  if (error) throw error;

  let processed = 0;
  for (const order of data || []) {
    try {
      await reconcileUnknownFullRefundOrder(order, {
        resolve,
        ...(complete && { complete }),
        ...(decline && { decline }),
      });
      processed += 1;
    } catch (reconciliationError) {
      console.error(
        `Не удалось сверить полный возврат заказа ${order.order_number}:`,
        reconciliationError.message,
      );
    }
  }
  return processed;
}

module.exports = {
  markFullRefundDeclined,
  reconcileUnknownFullRefundOrder,
  reconcileUnknownFullRefunds,
};
