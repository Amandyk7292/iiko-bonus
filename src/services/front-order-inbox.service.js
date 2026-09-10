const { supabase } = require('../config/supabase');
const {
  updateAdminOrderStatus,
  cancelPaidOrder,
  normalizeOrder,
} = require('./customer-order.service');

async function pollFrontOrders(branchId, { terminalId }) {
  const { data, error } = await supabase.rpc('poll_front_order_inbox', {
    p_branch: branchId,
    p_terminal: terminalId,
  });
  if (error) throw error;
  return data;
}

async function listFrontOrders(branchId, { page = 1, peek = false, receipts = false } = {}) {
  let query = supabase
    .from('kaspi_orders')
    .select(
      peek
        ? 'id,order_number'
        : 'id,order_number,phone,cart_items,amount,subtotal,discount_amount,delivery_fee,fulfillment_type,preorder_fulfillment_type,fulfillment_status,pos_receipt_due,scheduled_at,comment,delivery_address,customers(name,phone)',
      { count: 'exact' },
    )
    .eq('branch_id', branchId)
    .eq('status', 'paid')
    .in('fulfillment_status', receipts && !peek ? ['preparing', 'ready', 'completed'] : ['new'])
    .is('refund_status', null)
    .order('created_at', { ascending: true });
  if (receipts && !peek) query = query.eq('pos_receipt_due', true);
  query = peek ? query.limit(1) : query.range((page - 1) * 25, page * 25 - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  return {
    total: count || 0,
    page,
    orders: (data || []).map((order) =>
      peek
        ? { id: order.id, number: order.order_number }
        : {
            id: order.id,
            number: Number(order.order_number),
            phone: order.phone || order.customers?.phone || '',
            customer: order.customers?.name || '',
            items: (order.cart_items || []).map((item) => ({
              name: String(item.name || item.productName || ''),
              quantity: Number(item.quantity || 0),
              unit: item.unit || 'шт.',
            })),
            orderType: order.fulfillment_type,
            preorderType: order.fulfillment_type === 'preorder' ? 'pickup' : null,
            scheduledAt: order.scheduled_at,
            amount: Number(order.amount),
            deliveryFee: Number(order.delivery_fee || 0),
            comment: order.comment || '',
            posReceiptDue: Boolean(order.pos_receipt_due),
          },
    ),
  };
}

async function decideFrontOrder(branchId, { orderId, action, terminalId }) {
  const { data: order, error } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw Object.assign(new Error('Заказ не найден в этом филиале'), { statusCode: 404 });
  if (
    action === 'accept' &&
    order.status === 'paid' &&
    ['preparing', 'ready'].includes(order.fulfillment_status)
  )
    return normalizeOrder(order);
  if (action === 'reject' && order.fulfillment_status === 'cancelled') return normalizeOrder(order);
  if (order.fulfillment_status !== 'new' || order.status !== 'paid')
    throw Object.assign(new Error('Заказ уже обработан. Обновите список.'), { statusCode: 409 });
  if (action === 'accept')
    return updateAdminOrderStatus(orderId, 'preparing', '', {
      branchIds: [branchId],
      admin: { sub: `iikofront:${terminalId}` },
    });
  if (action !== 'reject')
    throw Object.assign(new Error('Неизвестное действие'), { statusCode: 400 });
  // Only unaccepted orders can be rejected here. Do not cancel a courier that
  // another cashier might have just dispatched after accepting the same order.
  return cancelPaidOrder(order, 'Нет в наличии', {
    allowedFulfillmentStatuses: ['new'],
    cancelBeforeRefund: true,
    acceptPendingRefund: true,
  });
}

module.exports = { listFrontOrders, decideFrontOrder, pollFrontOrders };
