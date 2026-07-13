const { supabase } = require('../config/supabase');
const { sendPushNotification } = require('./push.service');
const kaspiService = require('./kaspi.service');

const ORDER_FIELDS = [
  'id',
  'order_number',
  'status',
  'fulfillment_status',
  'amount',
  'subtotal',
  'discount_amount',
  'promo_code',
  'fulfillment_type',
  'branch_id',
  'branch_name',
  'scheduled_at',
  'pickup_time',
  'delivery_address',
  'delivery_fee',
  'comment',
  'cart_items',
  'earned_bonus',
  'bonus_awarded_at',
  'bonus_reversed_at',
  'cancellation_reason',
  'refund_status',
  'refund_amount',
  'refund_reference',
  'refund_requested_at',
  'refunded_at',
  'refund_error',
  'created_at',
  'updated_at',
].join(',');

const ORDER_STATUSES = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
const CLOSED_STATUSES = ['completed', 'cancelled'];
const STATUS_TRANSITIONS = {
  new: ['accepted', 'preparing', 'ready', 'completed', 'cancelled'],
  accepted: ['preparing', 'ready', 'completed', 'cancelled'],
  preparing: ['ready', 'completed', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const refundError = (statusCode, message, code) =>
  Object.assign(new Error(message), { statusCode, code });

const normalizeOrder = (order) => ({
  id: order.id,
  number: Number(order.order_number),
  paymentStatus:
    order.status === 'refunded' || order.refund_status === 'succeeded' ? 'refunded' : order.status,
  orderStatus: order.fulfillment_status === 'pending' ? 'new' : order.fulfillment_status,
  amount: Number(order.amount || 0),
  subtotal: Number(order.subtotal ?? order.amount ?? 0),
  discount: Number(order.discount_amount || 0),
  promoCode: order.promo_code || null,
  orderType: order.fulfillment_type || 'pickup',
  fulfillmentType: order.fulfillment_type || 'pickup',
  branchId: order.branch_id == null ? null : String(order.branch_id),
  branch: order.branch_name || '',
  scheduledAt: order.scheduled_at || order.pickup_time || null,
  pickupTime: order.scheduled_at || order.pickup_time || null,
  deliveryAddress:
    order.delivery_address && typeof order.delivery_address === 'object'
      ? order.delivery_address
      : null,
  deliveryFee: Number(order.delivery_fee || 0),
  comment: order.comment || null,
  items: Array.isArray(order.cart_items) ? order.cart_items : [],
  earnedBonus: Number(order.earned_bonus || 0),
  refundStatus: order.refund_status || null,
  refundAmount: order.refund_amount == null ? null : Number(order.refund_amount),
  refundedAt: order.refunded_at || null,
  cancellationReason: order.cancellation_reason || null,
  createdAt: order.created_at,
  updatedAt: order.updated_at,
  ...(order.customers
    ? {
        customer: {
          name: order.customers.name || '',
          phone: order.customers.phone || '',
        },
      }
    : {}),
});

async function listCustomerOrders(customerId, { scope = 'active', page = 1, pageSize = 30 } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, Number.parseInt(pageSize, 10) || 30));
  let query = supabase
    .from('kaspi_orders')
    .select(ORDER_FIELDS, { count: 'exact' })
    .eq('customer_id', customerId)
    .in('status', ['paid', 'refunded']);

  if (scope === 'completed') {
    query = query.in('fulfillment_status', CLOSED_STATUSES);
  } else {
    query = query.not('fulfillment_status', 'in', `(${CLOSED_STATUSES.join(',')})`);
  }

  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + safePageSize - 1);
  if (error) throw error;
  return {
    orders: (data || []).map(normalizeOrder),
    total: count || 0,
    page: safePage,
    pageSize: safePageSize,
  };
}

async function listAdminOrders({
  page = 1,
  pageSize = 50,
  search = '',
  paymentStatus,
  orderStatus,
} = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 50));
  const cleanSearch = String(search || '')
    .trim()
    .replace(/[^0-9A-Za-zА-Яа-яЁё+\- ]/g, '')
    .slice(0, 80);
  let query = supabase
    .from('kaspi_orders')
    .select(`${ORDER_FIELDS},customers(name,phone)`, { count: 'exact' });

  if (
    paymentStatus &&
    ['pending', 'paid', 'refunded', 'failed', 'expired'].includes(paymentStatus)
  ) {
    query = query.eq('status', paymentStatus);
  }
  if (orderStatus && [...ORDER_STATUSES, 'pending'].includes(orderStatus)) {
    query = query.eq('fulfillment_status', orderStatus);
  }
  if (cleanSearch) {
    const predicates = [
      `phone.ilike.%${cleanSearch}%`,
      `branch_name.ilike.%${cleanSearch}%`,
      `operation_id.ilike.%${cleanSearch}%`,
    ];
    if (/^\d+$/.test(cleanSearch)) predicates.push(`order_number.eq.${cleanSearch}`);
    query = query.or(predicates.join(','));
  }

  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + safePageSize - 1);
  if (error) throw error;
  return {
    orders: (data || []).map(normalizeOrder),
    total: count || 0,
    page: safePage,
    pageSize: safePageSize,
  };
}

async function notifyOrderStatus(order) {
  if (!order.customer_id) return;
  const copy = {
    accepted: ['Заказ принят', `Заказ №${order.order_number} принят в работу.`],
    preparing: ['Заказ готовится', `Мы готовим заказ №${order.order_number}.`],
    ready: ['Заказ готов', `Заказ №${order.order_number} готов к выдаче.`],
    completed: ['Заказ выдан', `Заказ №${order.order_number} завершён. Спасибо!`],
    cancelled:
      order.status === 'refunded'
        ? [
            'Заказ отменён, деньги возвращены',
            `Возврат ${Number(order.refund_amount || order.amount || 0).toLocaleString('ru-RU')} ₸ по заказу №${order.order_number} оформлен.`,
          ]
        : [
            'Заказ отменён',
            `Заказ №${order.order_number} отменён${order.cancellation_reason ? `: ${order.cancellation_reason}` : '.'}`,
          ],
  }[order.fulfillment_status];
  if (!copy) return;

  const { data: customer } = await supabase
    .from('customers')
    .select('fcm_token')
    .eq('id', order.customer_id)
    .maybeSingle();
  const { data: saved } = await supabase
    .from('customer_notifications')
    .insert({
      customer_id: order.customer_id,
      title: copy[0],
      body: copy[1],
      type: 'order',
      payload: { orderId: order.id, orderNumber: order.order_number },
    })
    .select('id')
    .maybeSingle();
  if (customer?.fcm_token) {
    await sendPushNotification(customer.fcm_token, copy[0], copy[1], {
      type: 'order',
      orderId: String(order.id),
      notificationId: String(saved?.id || ''),
    });
  }
}

async function markRefundFailure(order, error) {
  const uncertain = error?.refundUncertain === true;
  const message = String(error?.message || 'Возврат Kaspi не выполнен').slice(0, 1000);
  await supabase
    .from('kaspi_orders')
    .update({
      refund_status: uncertain ? 'unknown' : 'failed',
      refund_error: message,
      last_error: message,
    })
    .eq('id', order.id)
    .eq('refund_status', 'processing');
}

async function cancelPaidOrder(current, cancellationReason) {
  const currentStatus =
    current.fulfillment_status === 'pending' ? 'new' : current.fulfillment_status;
  if (current.status === 'refunded' && currentStatus === 'cancelled') {
    if (!current.bonus_reversed_at) {
      await kaspiService
        .reverseOrderLoyalty(current)
        .catch((error) =>
          console.error('Не удалось повторить сторнирование кэшбэка:', error.message),
        );
    }
    return normalizeOrder(current);
  }
  if (current.status !== 'paid') {
    throw httpError(409, 'Возврат доступен только для оплаченного заказа');
  }
  if (current.refund_status === 'processing') {
    throw refundError(409, 'Возврат по заказу уже выполняется', 'KASPI_REFUND_PROCESSING');
  }
  if (current.refund_status === 'unknown') {
    throw refundError(
      409,
      'Результат предыдущего возврата неизвестен. Проверьте операцию в Kaspi Pay.',
      'KASPI_REFUND_UNKNOWN',
    );
  }
  if (current.refund_status && current.refund_status !== 'failed') {
    throw refundError(
      409,
      'Текущее состояние возврата не позволяет повтор',
      'KASPI_REFUND_CONFLICT',
    );
  }

  const reason = String(cancellationReason || '')
    .trim()
    .slice(0, 500);
  const requestedAt = new Date().toISOString();
  let claim = supabase
    .from('kaspi_orders')
    .update({
      refund_status: 'processing',
      refund_requested_at: requestedAt,
      refund_error: null,
      cancellation_reason: reason || null,
      last_error: null,
    })
    .eq('id', current.id)
    .eq('status', 'paid');
  claim = current.refund_status
    ? claim.eq('refund_status', current.refund_status)
    : claim.is('refund_status', null);
  const { data: claimed, error: claimError } = await claim.select('*').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw refundError(
      409,
      'Состояние заказа изменилось. Обновите список перед возвратом.',
      'KASPI_REFUND_CONFLICT',
    );
  }

  let refund;
  try {
    refund = await kaspiService.refundPayment(claimed.operation_id, claimed.amount);
  } catch (error) {
    await markRefundFailure(claimed, error).catch((saveError) =>
      console.error('Не удалось сохранить ошибку возврата Kaspi:', saveError.message),
    );
    throw refundError(
      error.statusCode || 502,
      error.message || 'Kaspi не подтвердил возврат',
      error.code || 'KASPI_REFUND_FAILED',
    );
  }

  const refundedAt = new Date().toISOString();
  const { data: refunded, error: updateError } = await supabase
    .from('kaspi_orders')
    .update({
      status: 'refunded',
      fulfillment_status: 'cancelled',
      cancellation_reason: reason || null,
      fulfilled_at: null,
      refund_status: 'succeeded',
      refund_amount: Number(claimed.amount),
      refund_reference: refund.reference,
      refunded_at: refundedAt,
      refund_error: null,
      last_error: null,
    })
    .eq('id', claimed.id)
    .eq('refund_status', 'processing')
    .select('*')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!refunded) {
    throw refundError(
      500,
      'Kaspi подтвердил возврат, но заказ не обновился. Обратитесь к администратору.',
      'KASPI_REFUND_DB_CONFLICT',
    );
  }

  let finalOrder = refunded;
  try {
    finalOrder = await kaspiService.reverseOrderLoyalty(refunded);
  } catch (error) {
    console.error(`Не удалось сторнировать кэшбэк заказа ${refunded.order_number}:`, error.message);
    await supabase
      .from('kaspi_orders')
      .update({ last_error: String(error.message).slice(0, 1000) })
      .eq('id', refunded.id);
  }
  await notifyOrderStatus(finalOrder).catch((error) =>
    console.error('Не удалось отправить уведомление о заказе:', error.message),
  );
  return normalizeOrder(finalOrder);
}

async function updateAdminOrderStatus(id, nextStatus, cancellationReason = '') {
  if (!ORDER_STATUSES.includes(nextStatus)) throw httpError(400, 'Некорректный статус заказа');
  const { data: current, error: readError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw httpError(404, 'Заказ не найден');

  const currentStatus =
    current.fulfillment_status === 'pending' ? 'new' : current.fulfillment_status;
  if (nextStatus === 'cancelled' && currentStatus === 'cancelled') {
    if (current.status === 'paid') {
      return cancelPaidOrder(current, cancellationReason || current.cancellation_reason);
    }
    return normalizeOrder(current);
  }
  if (nextStatus === 'cancelled') {
    if (!(STATUS_TRANSITIONS[currentStatus] || []).includes(nextStatus)) {
      throw httpError(409, `Нельзя изменить статус «${currentStatus}» на «${nextStatus}»`);
    }
    return cancelPaidOrder(current, cancellationReason);
  }
  if (current.status !== 'paid') throw httpError(409, 'Статус неоплаченного заказа менять нельзя');
  if (['processing', 'unknown'].includes(current.refund_status)) {
    throw httpError(409, 'Нельзя изменить заказ, пока проверяется возврат Kaspi');
  }
  if (nextStatus === currentStatus) return normalizeOrder(current);
  if (!(STATUS_TRANSITIONS[currentStatus] || []).includes(nextStatus)) {
    throw httpError(409, `Нельзя изменить статус «${currentStatus}» на «${nextStatus}»`);
  }

  const reason = String(cancellationReason || '')
    .trim()
    .slice(0, 500);
  const updates = {
    fulfillment_status: nextStatus,
    cancellation_reason: nextStatus === 'cancelled' ? reason || null : null,
    fulfilled_at: nextStatus === 'completed' ? new Date().toISOString() : null,
    last_error: null,
  };
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update(updates)
    .eq('id', id)
    .eq('fulfillment_status', current.fulfillment_status)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(409, 'Статус уже изменён. Обновите список.');
  await notifyOrderStatus(data).catch((error) =>
    console.error('Не удалось отправить уведомление о заказе:', error.message),
  );
  return normalizeOrder(data);
}

module.exports = {
  ORDER_STATUSES,
  normalizeOrder,
  listAdminOrders,
  listCustomerOrders,
  updateAdminOrderStatus,
};
