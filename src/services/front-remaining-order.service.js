const { supabase } = require('../config/supabase');

// Never rewrite the payment ledger when rendering the remaining physical sale.
const remainingOrder = (order, receipt) => ({
  ...order,
  cart_items: receipt.cartItems ?? order.cart_items,
  amount: receipt.amount ?? order.amount,
  subtotal: receipt.subtotal ?? order.subtotal,
  discount_amount: receipt.discount ?? order.discount_amount,
  bonus_spent: receipt.bonusSpent ?? order.bonus_spent,
  delivery_fee: receipt.deliveryFee ?? order.delivery_fee,
  remaining_receipt_ready: receipt.ready === true,
  remaining_receipt_error: receipt.reason || null,
});

async function attachFrontRemainingOrders(orders) {
  const ids = orders
    .filter(
      (order) =>
        Number(order.partially_refunded_amount || 0) > 0 || order.refund_status === 'partial',
    )
    .map((order) => order.id);
  if (!ids.length) return orders;
  const { data, error } = await supabase.rpc('front_remaining_receipts', { p_orders: ids });
  if (error) throw error;
  const requested = new Set(ids);
  return orders.map((order) =>
    requested.has(order.id)
      ? remainingOrder(
          order,
          data?.[order.id] || {
            ready: false,
            reason: 'Оставшийся состав заказа ожидает сверки',
          },
        )
      : order,
  );
}

module.exports = { attachFrontRemainingOrders, remainingOrder };
