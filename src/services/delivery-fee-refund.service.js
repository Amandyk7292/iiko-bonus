const { supabase } = require('../config/supabase');
const { createPartialRefund } = require('./partial-refund.service');

const invalid = (message) =>
  Object.assign(new Error(message), {
    statusCode: 409,
    code: 'DELIVERY_FEE_REFUND_CONFLICT',
  });

function calculateDeliveryFeeRefund(order, refunded) {
  const fee = Number(order.delivery_fee || 0);
  if (!Number.isSafeInteger(fee) || fee < 0) throw invalid('Некорректная стоимость доставки');
  if (!fee || (refunded.quantities.get('__delivery_fee__') || 0) >= 1)
    return { amount: 0, records: [], skip: true };
  if (fee > Number(order.amount || 0) - Number(order.partially_refunded_amount || 0))
    throw invalid('Стоимость доставки требует сверки с возвратами заказа');
  return {
    amount: fee,
    records: [
      {
        line_key: '__delivery_fee__',
        product_id: 'delivery_fee',
        product_name: 'Доставка',
        quantity: 1,
        original_quantity: 1,
        unit_amount: fee,
        refund_amount: fee,
      },
    ],
  };
}

async function refundDeliveryReplacementFee(
  orderId,
  resolutionId,
  { db = supabase, refund = createPartialRefund } = {},
) {
  const { data: order, error } = await db
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (
    !order ||
    order.status !== 'paid' ||
    order.delivery_resolution?.id !== resolutionId ||
    order.delivery_resolution?.status !== 'pickup_accepting'
  )
    throw invalid('Замена доставки не подтверждена кассиром');
  // The resolution UUID is reused by every retry, including uncertain bank responses.
  // Only this trusted server path provides a fee calculator; HTTP payloads cannot.
  return refund(
    orderId,
    {
      idempotencyKey: resolutionId,
      reason: 'Возврат доставки при замене на самовывоз',
    },
    'delivery-replacement',
    (fresh, _items, refunded) => {
      if (
        fresh.delivery_resolution?.id !== resolutionId ||
        fresh.delivery_resolution?.status !== 'pickup_accepting'
      )
        throw invalid('Решение по доставке изменилось');
      return calculateDeliveryFeeRefund(fresh, refunded);
    },
  );
}

module.exports = { calculateDeliveryFeeRefund, refundDeliveryReplacementFee };
