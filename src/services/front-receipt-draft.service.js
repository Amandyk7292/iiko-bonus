const { supabase } = require('../config/supabase');
const { validQuantity } = require('../utils/quantity.util');
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });
function receiptDraft(order) {
  if (
    !order ||
    order.status !== 'paid' ||
    order.refund_status ||
    !(
      ['preparing', 'ready'].includes(order.fulfillment_status) ||
      (order.fulfillment_status === 'completed' && order.pos_receipt_due)
    )
  )
    throw conflict('Примите оплаченный заказ перед переносом в кассовый чек');
  const items = (order.cart_items || []).map((item, index) => {
    const productId = String(item.iikoProductId || '');
    if (
      !/^[0-9a-f-]{36}$/i.test(productId) ||
      !validQuantity(Number(item.quantity)) ||
      item.productSizeId ||
      item.configuration ||
      item.modifiers?.length
    )
      throw conflict('Один из товаров требует сопоставления с кассой или настройки вариантов');
    const price = Number(item.price),
      quantity = Number(item.quantity);
    const lineTotal = Number(item.lineTotal ?? Math.round(price * quantity));
    if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(lineTotal) || lineTotal <= 0)
      throw conflict('Цена товара в онлайн-заказе требует сверки');
    return {
      key: String(item.lineKey || index),
      productId,
      name: item.name,
      quantity,
      price,
      lineTotal,
    };
  });
  if (
    !items.length ||
    Math.abs(items.reduce((sum, item) => sum + item.lineTotal, 0) - Number(order.subtotal)) > 0.001
  )
    throw conflict('Состав и сумма онлайн-заказа требуют сверки');
  return {
    id: order.id,
    number: Number(order.order_number),
    items,
    merchandiseTotal:
      Number(order.subtotal) - Number(order.discount_amount || 0) - Number(order.bonus_spent || 0),
    discount: Number(order.discount_amount || 0),
    bonusSpent: Number(order.bonus_spent || 0),
  };
}
async function getFrontReceiptDraft(branchId, number) {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('branch_id', branchId)
    .eq('order_number', number)
    .maybeSingle();
  if (error) throw error;
  return receiptDraft(data);
}
module.exports = { getFrontReceiptDraft, receiptDraft };
