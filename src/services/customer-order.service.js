const { supabase } = require('../config/supabase');
const { sendPushNotification } = require('./push.service');

const ORDER_FIELDS = [
  'id',
  'order_number',
  'status',
  'fulfillment_status',
  'amount',
  'subtotal',
  'discount_amount',
  'promo_code',
  'branch_name',
  'pickup_time',
  'comment',
  'cart_items',
  'earned_bonus',
  'cancellation_reason',
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

const normalizeOrder = (order) => ({
  id: order.id,
  number: Number(order.order_number),
  paymentStatus: order.status,
  orderStatus: order.fulfillment_status === 'pending' ? 'new' : order.fulfillment_status,
  amount: Number(order.amount || 0),
  subtotal: Number(order.subtotal ?? order.amount ?? 0),
  discount: Number(order.discount_amount || 0),
  promoCode: order.promo_code || null,
  branch: order.branch_name || '',
  pickupTime: order.pickup_time || null,
  comment: order.comment || null,
  items: Array.isArray(order.cart_items) ? order.cart_items : [],
  earnedBonus: Number(order.earned_bonus || 0),
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
    .eq('status', 'paid');

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

  if (paymentStatus && ['pending', 'paid', 'failed', 'expired'].includes(paymentStatus)) {
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
    cancelled: [
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

async function updateAdminOrderStatus(id, nextStatus, cancellationReason = '') {
  if (!ORDER_STATUSES.includes(nextStatus)) throw httpError(400, 'Некорректный статус заказа');
  const { data: current, error: readError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw httpError(404, 'Заказ не найден');
  if (current.status !== 'paid') throw httpError(409, 'Статус неоплаченного заказа менять нельзя');

  const currentStatus =
    current.fulfillment_status === 'pending' ? 'new' : current.fulfillment_status;
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
  listAdminOrders,
  listCustomerOrders,
  updateAdminOrderStatus,
};
