const { supabase } = require('../config/supabase');
const {
  finalizeConfirmedOrderRefund,
  completeRefundFollowup,
} = require('./customer-order.service');
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
  followup = completeRefundFollowup,
  now = Date.now(),
} = {}) {
  const batchLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const { data, error } = await db
    .from('kaspi_orders')
    .select('*')
    .eq('payment_method', 'forte_card')
    .eq('provider_payment_system', 'forte_widget')
    .eq('status', 'paid')
    .or(
      `refund_status.eq.unknown,and(refund_status.eq.processing,refund_requested_at.lt.${new Date(now - 5 * 60_000).toISOString()})`,
    )
    .order('updated_at', { ascending: true })
    .limit(batchLimit);
  if (error) throw error;

  let processed = 0;
  for (let order of data || []) {
    try {
      // Partial refunds share the order status column but own a different
      // durable operation and reconciler. Never turn one into a full refund.
      const { data: partial, error: partialError } = await db
        .from('order_partial_refunds')
        .select('id')
        .eq('order_id', order.id)
        .in('status', ['processing', 'unknown'])
        .limit(1);
      if (partialError) throw partialError;
      if (partial?.length) continue;
      if (order.refund_status === 'processing') {
        let claim = db
          .from('kaspi_orders')
          .update({
            refund_status: 'unknown',
            refund_error: 'Операция возврата восстанавливается после прерывания',
          })
          .eq('id', order.id)
          .eq('status', 'paid')
          .eq('refund_status', 'processing')
          .eq('refund_requested_at', order.refund_requested_at);
        claim = order.refund_request_id
          ? claim.eq('refund_request_id', order.refund_request_id)
          : claim.is('refund_request_id', null);
        const { data: recovered, error: recoveryError } = await claim.select('*').maybeSingle();
        if (recoveryError) throw recoveryError;
        if (!recovered) continue;
        order = recovered;
      }
      const result = await reconcileUnknownFullRefundOrder(order, {
        resolve,
        ...(complete && { complete }),
        ...(decline && { decline }),
      });
      if (result.status === 'pending') {
        let defer = db
          .from('kaspi_orders')
          .update({
            ...(result.decision?.reference && { refund_reference: result.decision.reference }),
            refund_error: String(
              result.decision?.message || 'Возврат ожидает подтверждения банка',
            ).slice(0, 1000),
            updated_at: new Date(now).toISOString(),
          })
          .eq('id', order.id)
          .eq('refund_status', 'unknown');
        defer = order.refund_request_id
          ? defer.eq('refund_request_id', order.refund_request_id)
          : defer.is('refund_request_id', null);
        const { error: deferError } = await defer;
        if (deferError) throw deferError;
      }
      processed += 1;
    } catch (reconciliationError) {
      console.error(
        `Не удалось сверить полный возврат заказа ${order.order_number}:`,
        reconciliationError.message,
      );
    }
  }
  return (
    processed +
    (await reconcileConfirmedRefundFollowups({ limit: batchLimit, db, complete: followup }))
  );
}

async function reconcileConfirmedRefundFollowups({
  limit = 25,
  db = supabase,
  complete = completeRefundFollowup,
} = {}) {
  const { data, error } = await db
    .from('kaspi_orders')
    .select('*')
    .eq('status', 'refunded')
    .eq('refund_status', 'succeeded')
    .eq('refund_followup_pending', true)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  let processed = 0;
  for (const order of data || []) {
    try {
      await complete(order);
      processed += 1;
    } catch (followupError) {
      console.error(
        `Не удалось завершить подтверждённый возврат ${order.order_number}:`,
        followupError.message,
      );
    }
  }
  return processed;
}

module.exports = {
  markFullRefundDeclined,
  reconcileUnknownFullRefundOrder,
  reconcileUnknownFullRefunds,
  reconcileConfirmedRefundFollowups,
};
