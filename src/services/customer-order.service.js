const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { sendPushToCustomer } = require('./push.service');
const kaspiService = require('./kaspi.service');
const { releaseOrderReservations } = require('./inventory.service');
const realtime = require('./realtime.service');
const { sendOrderLiveActivity } = require('./live-activity.service');
const { paymentReceiptUrl } = require('./payment-receipt.service');
const { paymentProviderName, refundPaymentForOrder } = require('./payment-gateway.service');
const { effectiveFulfillmentType, isDeliveryFulfillment } = require('../utils/fulfillment.util');
const { runBackgroundTask } = require('../utils/background-task.util');

const ORDER_FIELDS = [
  'id',
  'order_number',
  'status',
  'fulfillment_status',
  'payment_method',
  'provider_payment_system',
  'amount',
  'subtotal',
  'discount_amount',
  'promo_code',
  'fulfillment_type',
  'preorder_fulfillment_type',
  'branch_id',
  'branch_name',
  'scheduled_at',
  'pickup_time',
  'delivery_address',
  'delivery_fee',
  'comment',
  'substitution_preference',
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
  'last_error',
  'courier_id',
  'delivery_status',
  'estimated_delivery_at',
  'promised_ready_at',
  'eta_min_at',
  'eta_max_at',
  'eta_confidence',
  'eta_version',
  'eta_updated_at',
  'route_distance_km',
  'preparation_minutes',
  'courier_assigned_at',
  'out_for_delivery_at',
  'delivered_at',
  'delivery_pin',
  'delivery_confirmed_at',
  'tracking_code',
  'customer_arrived_at',
  'receipt_created_at',
  'created_at',
  'updated_at',
].join(',');

const ORDER_STATUSES = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
const CLOSED_STATUSES = ['completed', 'cancelled'];
const PAYMENT_ISSUES_FILTER =
  'status.in.(failed,expired),refund_status.in.(failed,unknown),last_error.not.is.null';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REFUND_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
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

const safeUnknownRefundRequestId = (order, now = Date.now()) => {
  if (order?.refund_status !== 'unknown') return null;
  const requestId = String(order?.refund_request_id || '');
  const requestedAt = Date.parse(String(order?.refund_requested_at || ''));
  const age = Number(now) - requestedAt;
  if (
    !UUID_PATTERN.test(requestId) ||
    !Number.isFinite(requestedAt) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age >= SAFE_REFUND_RETRY_WINDOW_MS
  ) {
    return null;
  }
  return requestId;
};

const latestExternalDelivery = (order) =>
  Array.isArray(order?.delivery_jobs)
    ? [...order.delivery_jobs].sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime(),
      )[0] || null
    : null;

const externalCourier = (job) => {
  if (!job?.courier_name && !job?.courier_car_model && !job?.courier_transport_type) return null;
  return {
    id: String(job.id || ''),
    name: job.courier_name || 'Курьер Яндекс.Доставки',
    phone: job.courier_phone || '',
    vehicle:
      [job.courier_car_color, job.courier_car_model, job.courier_car_number]
        .filter(Boolean)
        .join(' · ') ||
      job.courier_transport_type ||
      null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: job.updated_at || null,
  };
};

const orderReceiptUrl = (order) => {
  const relation = Array.isArray(order?.payment_receipts)
    ? order.payment_receipts[0]
    : order?.payment_receipts;
  if (!relation?.id) return null;
  try {
    return paymentReceiptUrl(relation.id, process.env, relation.language);
  } catch {
    return null;
  }
};

const normalizedOrderStatus = (order) => {
  if (order?.status === 'pending') return 'awaiting_payment';
  if (['failed', 'expired'].includes(order?.status)) return 'cancelled';
  return order?.fulfillment_status === 'pending' ? 'new' : order?.fulfillment_status;
};

const normalizeOrder = (order, { includeDeliveryPin = false } = {}) => {
  const external = latestExternalDelivery(order);
  const ownCourier = order.couriers
    ? {
        id: String(order.couriers.id || order.courier_id || ''),
        name: order.couriers.name || '',
        phone: order.couriers.phone || '',
        vehicle: order.couriers.vehicle || null,
        latitude:
          order.couriers.current_latitude == null ? null : Number(order.couriers.current_latitude),
        longitude:
          order.couriers.current_longitude == null
            ? null
            : Number(order.couriers.current_longitude),
        locationUpdatedAt: order.couriers.location_updated_at || null,
      }
    : null;
  const substitutions = (order.order_substitution_requests || []).map((request) => ({
    id: String(request.id),
    orderId: String(order.id),
    lineKey: request.line_key,
    productId: request.product_id,
    productName: request.product_name,
    quantity: Number(request.quantity || 0),
    action: request.action,
    status: request.status,
    replacementProductId: request.replacement_product_id || null,
    replacementProductName: request.replacement_product_name || null,
    note: request.note || null,
    error: request.error || null,
    refundId: request.refund_id || null,
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    respondedAt: request.responded_at || null,
    completedAt: request.completed_at || null,
  }));
  const latestSubstitutionUpdate = substitutions.reduce(
    (latest, request) => (request.updatedAt > latest ? request.updatedAt : latest),
    '',
  );
  return {
    id: order.id,
    number: Number(order.order_number),
    paymentStatus:
      order.status === 'refunded' || order.refund_status === 'succeeded'
        ? 'refunded'
        : order.status,
    paymentProvider: order.payment_method === 'forte_card' ? 'forte' : 'kaspi',
    orderStatus: normalizedOrderStatus(order),
    amount: Number(order.amount || 0),
    subtotal: Number(order.subtotal ?? order.amount ?? 0),
    discount: Number(order.discount_amount || 0),
    promoCode: order.promo_code || null,
    orderType: order.fulfillment_type || 'pickup',
    fulfillmentType: order.fulfillment_type || 'pickup',
    preorderFulfillmentType: order.preorder_fulfillment_type || null,
    effectiveFulfillmentType: effectiveFulfillmentType(order),
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
    substitutionPreference: order.substitution_preference || 'call_customer',
    substitutions,
    items: Array.isArray(order.cart_items) ? order.cart_items : [],
    earnedBonus: Number(order.earned_bonus || 0),
    refundStatus: order.refund_status || null,
    refundAmount: order.refund_amount == null ? null : Number(order.refund_amount),
    refundedAt: order.refunded_at || null,
    refundError: order.refund_error || null,
    lastError: order.last_error || null,
    deliveryStatus: order.delivery_status || 'unassigned',
    deliveryConfirmedAt: order.delivery_confirmed_at || null,
    ...(includeDeliveryPin && order.delivery_pin ? { deliveryPin: order.delivery_pin } : {}),
    estimatedDeliveryAt: order.estimated_delivery_at || null,
    promisedReadyAt: order.promised_ready_at || null,
    etaMinAt: order.eta_min_at || null,
    etaMaxAt: order.eta_max_at || null,
    etaConfidence: order.eta_confidence || null,
    etaVersion: order.eta_version || null,
    etaUpdatedAt: order.eta_updated_at || null,
    routeDistanceKm: order.route_distance_km == null ? null : Number(order.route_distance_km),
    preparationMinutes:
      order.preparation_minutes == null ? null : Number(order.preparation_minutes),
    trackingCode: order.tracking_code || null,
    trackingUrl: external?.tracking_url || null,
    deliveryProvider: ownCourier ? 'bulka' : external?.provider || null,
    providerDeliveryStatus: external?.provider_status || null,
    providerDeliveryPrice:
      external?.provider_price == null ? null : Number(external.provider_price),
    customerArrivedAt: order.customer_arrived_at || null,
    courier: ownCourier || externalCourier(external),
    cancellationReason: order.cancellation_reason || null,
    receiptUrl: orderReceiptUrl(order),
    createdAt: order.created_at,
    updatedAt:
      latestSubstitutionUpdate > String(order.updated_at || '')
        ? latestSubstitutionUpdate
        : order.updated_at,
    ...(order.customers
      ? {
          customer: {
            name: order.customers.name || '',
            phone: order.customers.phone || '',
          },
        }
      : {}),
  };
};

const DELIVERY_JOB_FIELDS =
  'delivery_jobs(id,provider,provider_status,internal_status,provider_price,currency,tracking_url,courier_name,courier_phone,courier_transport_type,courier_car_model,courier_car_number,courier_car_color,eta_minutes,created_at,updated_at)';
const SUBSTITUTION_FIELDS =
  'order_substitution_requests(id,line_key,product_id,product_name,quantity,action,status,replacement_product_id,replacement_product_name,note,error,refund_id,created_at,updated_at,responded_at,completed_at)';

async function listCustomerOrders(customerId, { scope = 'active', page = 1, pageSize = 30 } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, Number.parseInt(pageSize, 10) || 30));
  let query = supabase
    .from('kaspi_orders')
    .select(
      `${ORDER_FIELDS},payment_receipts(id,language),couriers(id,name,phone,vehicle,current_latitude,current_longitude,location_updated_at),${DELIVERY_JOB_FIELDS},${SUBSTITUTION_FIELDS}`,
      { count: 'exact' },
    )
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
    orders: (data || []).map((order) => normalizeOrder(order, { includeDeliveryPin: true })),
    total: count || 0,
    page: safePage,
    pageSize: safePageSize,
  };
}

function canMarkCustomerArrived(order) {
  if (!order || order.status !== 'paid') return false;
  if (isDeliveryFulfillment(order)) return false;
  if (!['pickup', 'preorder'].includes(order.fulfillment_type || 'pickup')) return false;
  const status = order.fulfillment_status === 'pending' ? 'new' : order.fulfillment_status;
  return status === 'ready';
}

function canCustomerCancelOrder(order) {
  if (!order || order.status !== 'paid') return false;
  const status = order.fulfillment_status === 'pending' ? 'new' : order.fulfillment_status;
  return status === 'new' && !order.refund_status;
}

async function markCustomerArrived(customerId, orderId) {
  const { data: current, error: readError } = await supabase
    .from('kaspi_orders')
    .select('*,payment_receipts(id,language)')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw httpError(404, 'Заказ не найден');
  if (current.customer_arrived_at) return normalizeOrder(current);
  if (!canMarkCustomerArrived(current)) {
    throw httpError(409, 'Сообщить о прибытии можно, когда заказ готов к самовывозу');
  }

  const arrivedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update({ customer_arrived_at: arrivedAt })
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .is('customer_arrived_at', null)
    .select('*,payment_receipts(id,language)')
    .maybeSingle();
  if (error) throw error;

  const updated = data || { ...current, customer_arrived_at: arrivedAt };
  const event = {
    orderId: updated.id,
    orderNumber: updated.order_number,
    orderStatus: updated.fulfillment_status,
    customerArrivedAt: updated.customer_arrived_at,
    branchId: updated.branch_id,
  };
  realtime.publish('order.customer_arrived', event, {
    customerId,
    includeAdmins: true,
    branchId: updated.branch_id,
  });
  return normalizeOrder(updated);
}

async function listAdminOrders({
  page = 1,
  pageSize = 50,
  search = '',
  paymentStatus,
  orderStatus,
  branchIds = [],
} = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 50));
  const cleanSearch = String(search || '')
    .trim()
    .replace(/[^0-9A-Za-zА-Яа-яЁё+\- ]/g, '')
    .slice(0, 80);
  let query = supabase
    .from('kaspi_orders')
    .select(
      `${ORDER_FIELDS},customers(name,phone),couriers(id,name,phone,vehicle,current_latitude,current_longitude,location_updated_at),${DELIVERY_JOB_FIELDS}`,
      { count: 'exact' },
    );

  if (paymentStatus === 'issues') {
    query = query.or(PAYMENT_ISSUES_FILTER);
  } else if (
    paymentStatus &&
    ['pending', 'paid', 'refunded', 'failed', 'expired'].includes(paymentStatus)
  ) {
    query = query.eq('status', paymentStatus);
  }
  if (orderStatus && [...ORDER_STATUSES, 'pending'].includes(orderStatus)) {
    query = query.eq('fulfillment_status', orderStatus);
  }
  const scopedBranchIds = Array.isArray(branchIds)
    ? [...new Set(branchIds.map(String).filter(Boolean))]
    : [];
  if (scopedBranchIds.length) query = query.in('branch_id', scopedBranchIds);
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
  const number = order.order_number;
  const refundAmount = Number(order.refund_amount || order.amount || 0).toLocaleString('ru-RU');
  const cancellationReason = String(order.cancellation_reason || '').trim();
  const cancellationReasonByLanguage = {
    ru: cancellationReason ? ` Причина: ${cancellationReason}.` : '',
    kk: cancellationReason ? ` Себебі: ${cancellationReason}.` : '',
    en: cancellationReason ? ` Reason: ${cancellationReason}.` : '',
  };
  const cancellationSuffix = order.cancellation_reason ? `: ${order.cancellation_reason}` : '.';
  const copiesByLanguage = {
    ru: {
      accepted: ['Заказ принят', `Заказ №${number} принят в работу.`],
      preparing: ['Заказ готовится', `Мы готовим заказ №${number}.`],
      ready: ['Заказ готов', `Заказ №${number} готов к выдаче.`],
      completed: ['Заказ выдан', `Заказ №${number} завершён. Спасибо!`],
      cancelled:
        order.status === 'refunded'
          ? [
              'Заказ отменён, возврат отправлен',
              order.payment_method === 'forte_card'
                ? `Возврат ${refundAmount} ₸ по заказу №${number} отправлен на карту. Срок зачисления зависит от банка карты.${cancellationReasonByLanguage.ru}`
                : `Возврат ${refundAmount} ₸ по заказу №${number} оформлен через Kaspi Pay.${cancellationReasonByLanguage.ru}`,
            ]
          : ['Заказ отменён', `Заказ №${number} отменён${cancellationSuffix}`],
    },
    kk: {
      accepted: ['Тапсырыс қабылданды', `№${number} тапсырыс жұмысқа қабылданды.`],
      preparing: ['Тапсырыс дайындалып жатыр', `№${number} тапсырысты дайындап жатырмыз.`],
      ready: ['Тапсырыс дайын', `№${number} тапсырыс алып кетуге дайын.`],
      completed: ['Тапсырыс табысталды', `№${number} тапсырыс аяқталды. Рақмет!`],
      cancelled:
        order.status === 'refunded'
          ? [
              'Тапсырыс тоқтатылды, қайтарым жіберілді',
              order.payment_method === 'forte_card'
                ? `№${number} тапсырыс бойынша ${refundAmount} ₸ картаға қайтаруға жіберілді. Түсу мерзімі картаны шығарған банкке байланысты.${cancellationReasonByLanguage.kk}`
                : `№${number} тапсырыс бойынша ${refundAmount} ₸ Kaspi Pay арқылы қайтарылды.${cancellationReasonByLanguage.kk}`,
            ]
          : ['Тапсырыс тоқтатылды', `№${number} тапсырыс тоқтатылды${cancellationSuffix}`],
    },
    en: {
      accepted: ['Order accepted', `Order #${number} has been accepted.`],
      preparing: ['Order is being prepared', `We are preparing order #${number}.`],
      ready: ['Order is ready', `Order #${number} is ready for pickup.`],
      completed: ['Order collected', `Order #${number} is complete. Thank you!`],
      cancelled:
        order.status === 'refunded'
          ? [
              'Order cancelled, refund submitted',
              order.payment_method === 'forte_card'
                ? `The ${refundAmount} ₸ refund for order #${number} was sent to the card. Posting time depends on the card issuer.${cancellationReasonByLanguage.en}`
                : `The ${refundAmount} ₸ refund for order #${number} was processed through Kaspi Pay.${cancellationReasonByLanguage.en}`,
            ]
          : ['Order cancelled', `Order #${number} was cancelled${cancellationSuffix}`],
    },
  };
  const localizedCopies = Object.fromEntries(
    Object.entries(copiesByLanguage).map(([language, copies]) => [
      language,
      copies[order.fulfillment_status],
    ]),
  );
  if (!localizedCopies.ru) return;
  const messageKey =
    order.fulfillment_status === 'cancelled' && order.status === 'refunded'
      ? 'order_refunded'
      : `order_${order.fulfillment_status}`;

  await sendOrderLiveActivity(order, {
    end: ['completed', 'cancelled'].includes(order.fulfillment_status),
  }).catch((error) => console.error('Не удалось обновить Live Activity:', error.message));

  const { data: customer } = await supabase
    .from('customers')
    .select('fcm_token,preferred_language')
    .eq('id', order.customer_id)
    .maybeSingle();
  const language = ['kk', 'en'].includes(String(customer?.preferred_language || '').toLowerCase())
    ? String(customer.preferred_language).toLowerCase()
    : 'ru';
  const copy = localizedCopies[language] || localizedCopies.ru;
  const i18n = {
    titles: Object.fromEntries(
      Object.entries(localizedCopies).map(([code, value]) => [code, value[0]]),
    ),
    bodies: Object.fromEntries(
      Object.entries(localizedCopies).map(([code, value]) => [code, value[1]]),
    ),
  };
  const { data: saved } = await supabase
    .from('customer_notifications')
    .insert({
      customer_id: order.customer_id,
      title: copy[0],
      body: copy[1],
      type: 'order',
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        messageKey,
        i18n,
      },
    })
    .select('id')
    .maybeSingle();
  if (order.customer_id) {
    await sendPushToCustomer(
      order.customer_id,
      copy[0],
      copy[1],
      {
        type: 'order',
        orderId: String(order.id),
        orderNumber: String(order.order_number),
        orderStatus: String(order.fulfillment_status || ''),
        fulfillmentType: effectiveFulfillmentType(order),
        orderEta: String(order.promised_ready_at || order.estimated_delivery_at || ''),
        deepLink: `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/orders?order=${encodeURIComponent(order.id)}`,
        notificationId: String(saved?.id || ''),
      },
      customer?.fcm_token,
    );
  }
}

async function markRefundFailure(order, error) {
  const uncertain = error?.refundUncertain === true;
  const message = String(error?.message || 'Возврат не выполнен').slice(0, 1000);
  await supabase
    .from('kaspi_orders')
    .update({
      refund_status: uncertain ? 'unknown' : 'failed',
      refund_error: message,
      last_error: message,
      ...(error?.refundReference && {
        refund_reference: String(error.refundReference).slice(0, 160),
      }),
    })
    .eq('id', order.id)
    .eq('refund_status', 'processing');
}

async function cancelPaidOrder(
  current,
  cancellationReason,
  {
    allowedFulfillmentStatuses = [],
    cancelBeforeRefund = false,
    reuseRefundRequestId = false,
  } = {},
) {
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
  const allowedStatuses = Array.isArray(allowedFulfillmentStatuses)
    ? allowedFulfillmentStatuses.map(String).filter(Boolean)
    : [];
  if (allowedStatuses.length && !allowedStatuses.includes(String(current.fulfillment_status))) {
    throw refundError(
      409,
      'Отменить заказ самостоятельно можно только до принятия в работу',
      'CUSTOMER_ORDER_CANCELLATION_CLOSED',
    );
  }
  const reason = String(cancellationReason || '')
    .trim()
    .slice(0, 500);
  if (!reason) {
    throw refundError(
      400,
      'Укажите причину отмены — клиент увидит её вместе с сообщением о возврате',
      'CANCELLATION_REASON_REQUIRED',
    );
  }
  if (current.refund_status === 'processing') {
    throw refundError(409, 'Возврат по заказу уже выполняется', 'PAYMENT_REFUND_PROCESSING');
  }
  const existingRefundRequestId = /^[0-9a-f-]{36}$/i.test(String(current.refund_request_id || ''))
    ? String(current.refund_request_id)
    : null;
  const retryRequestId =
    safeUnknownRefundRequestId(current) ||
    (reuseRefundRequestId && current.refund_status === 'failed' ? existingRefundRequestId : null);
  if (current.refund_status === 'unknown' && !retryRequestId) {
    throw refundError(
      409,
      `Безопасный срок повтора истёк. Проверьте возврат в ${paymentProviderName(current)} и свяжитесь с администратором.`,
      'PAYMENT_REFUND_UNKNOWN',
    );
  }
  if (current.refund_status && !['failed', 'partial', 'unknown'].includes(current.refund_status)) {
    throw refundError(
      409,
      'Текущее состояние возврата не позволяет повтор',
      'PAYMENT_REFUND_CONFLICT',
    );
  }

  const requestedAt = new Date().toISOString();
  const refundRequestId = retryRequestId || crypto.randomUUID();
  let claim = supabase
    .from('kaspi_orders')
    .update({
      refund_status: 'processing',
      refund_requested_at: retryRequestId ? current.refund_requested_at : requestedAt,
      refund_error: null,
      cancellation_reason: reason || null,
      ...(cancelBeforeRefund && { fulfillment_status: 'cancelled', fulfilled_at: null }),
      last_error: null,
      refund_request_id: refundRequestId,
    })
    .eq('id', current.id)
    .eq('status', 'paid');
  if (allowedStatuses.length) claim = claim.in('fulfillment_status', allowedStatuses);
  claim = current.refund_status
    ? claim.eq('refund_status', current.refund_status)
    : claim.is('refund_status', null);
  const { data: claimed, error: claimError } = await claim.select('*').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw refundError(
      409,
      'Состояние заказа изменилось. Обновите список перед возвратом.',
      'PAYMENT_REFUND_CONFLICT',
    );
  }

  if (cancelBeforeRefund) {
    await releaseOrderReservations(claimed.id).catch((error) =>
      console.error('Не удалось освободить резерв отменённого заказа:', error.message),
    );
    realtime.publish(
      'order.updated',
      {
        orderId: claimed.id,
        orderNumber: claimed.order_number,
        paymentStatus: claimed.status,
        orderStatus: claimed.fulfillment_status,
        refundStatus: claimed.refund_status,
      },
      {
        customerId: claimed.customer_id,
        includeAdmins: true,
        branchId: claimed.branch_id,
      },
    );
  }

  let refund;
  let giftRefundPrepared = false;
  try {
    if (claimed.order_kind === 'gift_certificate') {
      const { prepareGiftCertificateRefund } = require('./gift-certificate-purchase.service');
      await prepareGiftCertificateRefund(claimed);
      giftRefundPrepared = true;
    }
    const remainingRefund = Number(claimed.amount) - Number(claimed.partially_refunded_amount || 0);
    if (!Number.isFinite(remainingRefund) || remainingRefund <= 0) {
      throw refundError(409, 'Заказ уже полностью возвращён', 'PAYMENT_REFUND_CONFLICT');
    }
    refund = await refundPaymentForOrder(claimed, remainingRefund, {
      reason,
      idempotencyKey: claimed.refund_request_id || refundRequestId,
    });
  } catch (error) {
    await markRefundFailure(claimed, error).catch((saveError) =>
      console.error('Не удалось сохранить ошибку возврата:', saveError.message),
    );
    if (giftRefundPrepared && error?.refundUncertain !== true) {
      const { rollbackGiftCertificateRefund } = require('./gift-certificate-purchase.service');
      await rollbackGiftCertificateRefund(claimed).catch((rollbackError) =>
        console.error(
          'Не удалось восстановить сертификат после отклонённого возврата:',
          rollbackError.message,
        ),
      );
    }
    throw refundError(
      error.statusCode || 502,
      error.message || `${paymentProviderName(claimed)} не подтвердил возврат`,
      error.code || 'PAYMENT_REFUND_FAILED',
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
      partially_refunded_amount: Number(claimed.amount),
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
      `${paymentProviderName(claimed)} подтвердил возврат, но заказ не обновился. Обратитесь к администратору.`,
      'PAYMENT_REFUND_DB_CONFLICT',
    );
  }

  if (giftRefundPrepared) {
    const { finalizeGiftCertificateRefund } = require('./gift-certificate-purchase.service');
    await finalizeGiftCertificateRefund(refunded).catch(async (giftError) => {
      console.error('Не удалось завершить деактивацию сертификата:', giftError.message);
      await supabase
        .from('kaspi_orders')
        .update({
          last_error: `Возврат выполнен, сертификат ожидает сверки: ${String(
            giftError.message || '',
          ).slice(0, 800)}`,
        })
        .eq('id', refunded.id);
    });
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
  await releaseOrderReservations(finalOrder.id).catch((error) =>
    console.error('Не удалось освободить резерв отменённого заказа:', error.message),
  );
  realtime.publish(
    'order.updated',
    {
      orderId: finalOrder.id,
      orderNumber: finalOrder.order_number,
      paymentStatus: finalOrder.status,
      orderStatus: finalOrder.fulfillment_status,
    },
    {
      customerId: finalOrder.customer_id,
      includeAdmins: true,
      branchId: finalOrder.branch_id,
    },
  );
  return normalizeOrder(finalOrder);
}

async function cancelCustomerOrder(customerId, orderId) {
  const { data: current, error } = await supabase
    .from('kaspi_orders')
    .select('*,payment_receipts(id,language)')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!current) throw httpError(404, 'Заказ не найден');
  if (
    current.fulfillment_status === 'cancelled' &&
    current.cancellation_reason === 'Отменено клиентом'
  ) {
    if (
      current.status === 'refunded' ||
      ['processing', 'unknown'].includes(current.refund_status)
    ) {
      return normalizeOrder(current);
    }
    if (current.refund_status === 'failed') {
      throw refundError(
        409,
        'Заказ отменён, но возврат требует проверки. Напишите в поддержку.',
        'PAYMENT_REFUND_FAILED',
      );
    }
  }
  if (!canCustomerCancelOrder(current)) {
    throw refundError(
      409,
      'Отменить заказ самостоятельно можно только до принятия в работу',
      'CUSTOMER_ORDER_CANCELLATION_CLOSED',
    );
  }
  return cancelPaidOrder(current, 'Отменено клиентом', {
    allowedFulfillmentStatuses: ['pending', 'new'],
    cancelBeforeRefund: true,
  });
}

async function updateAdminOrderStatus(
  id,
  nextStatus,
  cancellationReason = '',
  { branchIds = [] } = {},
) {
  if (!ORDER_STATUSES.includes(nextStatus)) throw httpError(400, 'Некорректный статус заказа');
  const { data: current, error: readError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw httpError(404, 'Заказ не найден');
  const scopedBranchIds = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  if (scopedBranchIds.length && !scopedBranchIds.includes(String(current.branch_id || ''))) {
    throw httpError(404, 'Заказ не найден');
  }

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
    throw httpError(
      409,
      `Нельзя изменить заказ, пока проверяется возврат через ${paymentProviderName(current)}`,
    );
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
  let updateQuery = supabase
    .from('kaspi_orders')
    .update(updates)
    .eq('id', id)
    .eq('fulfillment_status', current.fulfillment_status);
  updateQuery = updateQuery.or('refund_status.is.null,refund_status.not.in.(processing,unknown)');
  const { data, error } = await updateQuery.select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(409, 'Статус уже изменён. Обновите список.');
  realtime.publish(
    'order.updated',
    {
      orderId: data.id,
      orderNumber: data.order_number,
      paymentStatus: data.status,
      orderStatus: data.fulfillment_status,
    },
    { customerId: data.customer_id, includeAdmins: true, branchId: data.branch_id },
  );
  runBackgroundTask(`Order ${data.id} status side effects`, async () => {
    const results = await Promise.allSettled([
      notifyOrderStatus(data),
      ...(['completed', 'cancelled'].includes(nextStatus)
        ? [releaseOrderReservations(data.id)]
        : []),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Order status side effect failed:', result.reason?.message);
      }
    }
  });
  return normalizeOrder(data);
}

module.exports = {
  ORDER_STATUSES,
  normalizeOrder,
  listAdminOrders,
  listCustomerOrders,
  canMarkCustomerArrived,
  canCustomerCancelOrder,
  cancelPaidOrder,
  markCustomerArrived,
  cancelCustomerOrder,
  notifyOrderStatus,
  safeUnknownRefundRequestId,
  updateAdminOrderStatus,
};
