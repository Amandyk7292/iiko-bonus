const { supabase } = require('../config/supabase');
const { conflict, notFound, badRequest } = require('../utils/app-error.util');
const { createPartialRefund, getRefundOptions } = require('./partial-refund.service');
const { getBranchAvailability, listInventory } = require('./inventory.service');
const { sendPushToCustomer } = require('./push.service');
const realtime = require('./realtime.service');

const ACTIVE_STATUSES = ['pending', 'processing', 'contacting', 'awaiting_customer', 'approved'];

const normalize = (request) => ({
  id: String(request.id),
  orderId: String(request.order_id),
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
});

async function readOrder(orderId, customerId = null) {
  let query = supabase.from('kaspi_orders').select('*').eq('id', orderId);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('ORDER_NOT_FOUND', 'Заказ не найден');
  return data;
}

async function notifyCustomer(order, request) {
  if (!order.customer_id) return;
  const title = 'Нужно подтвердить замену';
  const body = `В заказе №${order.order_number} предлагаем заменить «${request.product_name}» на «${request.replacement_product_name}».`;
  const { data: notification, error } = await supabase
    .from('customer_notifications')
    .insert({
      customer_id: order.customer_id,
      title,
      body,
      type: 'order',
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        substitutionRequestId: request.id,
        messageKey: 'order_substitution_approval',
      },
    })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  await sendPushToCustomer(order.customer_id, title, body, {
    type: 'order_substitution',
    orderId: String(order.id),
    orderNumber: String(order.order_number),
    substitutionRequestId: String(request.id),
    notificationId: String(notification?.id || ''),
    deepLink: `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/orders?order=${encodeURIComponent(order.id)}`,
  });
}

function publish(order, request) {
  realtime.publish(
    'order.substitution_updated',
    {
      orderId: order.id,
      orderNumber: order.order_number,
      substitution: normalize(request),
    },
    { customerId: order.customer_id, includeAdmins: true, branchId: order.branch_id },
  );
}

async function getSubstitutionOptions(orderId) {
  const order = await readOrder(orderId);
  const [refund, inventoryResult, availability] = await Promise.all([
    getRefundOptions(orderId),
    listInventory({ branchId: order.branch_id }),
    getBranchAvailability(order.branch_id, { strict: true }),
  ]);
  const replacements = inventoryResult
    .map((item) => {
      const live = availability.get(String(item.product_id));
      return {
        productId: String(item.product_id),
        productName: item.product_name || live?.productName || String(item.product_id),
        availableQuantity:
          live?.availableQuantity ??
          (item.source_quantity == null ? null : Math.max(0, Number(item.source_quantity))),
        isAvailable:
          live?.isAvailable ??
          (item.manual_stop !== true &&
            (item.source_quantity == null || Number(item.source_quantity) > 0)),
      };
    })
    .filter((item) => item.isAvailable)
    .map(({ isAvailable: _isAvailable, ...item }) => item);
  return { ...refund, replacements };
}

async function createSubstitution(orderId, payload, requestedBy) {
  const order = await readOrder(orderId);
  if (
    order.status !== 'paid' ||
    ['completed', 'cancelled'].includes(String(order.fulfillment_status || ''))
  ) {
    throw conflict(
      'ORDER_SUBSTITUTION_UNAVAILABLE',
      'Обработать отсутствующий товар можно только в активном оплаченном заказе',
    );
  }

  const options = await getSubstitutionOptions(orderId);
  const line = options.lines.find((item) => item.lineKey === payload.lineKey);
  if (!line) throw badRequest('ORDER_LINE_NOT_FOUND', 'Позиция заказа не найдена');
  if (payload.quantity > line.refundableQuantity) {
    throw conflict(
      'ORDER_LINE_QUANTITY_UNAVAILABLE',
      `Для «${line.name}» доступно: ${line.refundableQuantity}`,
    );
  }

  let replacement = null;
  if (payload.action === 'replace_with_approval') {
    replacement = options.replacements.find(
      (item) =>
        item.productId === payload.replacementProductId &&
        (item.availableQuantity == null || item.availableQuantity >= payload.quantity),
    );
    if (!replacement || replacement.productId === String(line.productId)) {
      throw conflict('REPLACEMENT_UNAVAILABLE', 'Выбранная замена недоступна в этом филиале');
    }
  }

  const initialStatus =
    payload.action === 'remove_refund'
      ? 'processing'
      : payload.action === 'call_customer'
        ? 'contacting'
        : 'awaiting_customer';
  const row = {
    order_id: order.id,
    customer_id: order.customer_id,
    line_key: line.lineKey,
    product_id: line.productId,
    product_name: line.name,
    quantity: payload.quantity,
    action: payload.action,
    status: initialStatus,
    replacement_product_id: replacement?.productId || null,
    replacement_product_name: replacement?.productName || null,
    note: payload.note || null,
    requested_by: String(requestedBy || 'admin').slice(0, 160),
  };
  const { data: inserted, error } = await supabase
    .from('order_substitution_requests')
    .insert(row)
    .select('*')
    .single();
  if (error?.code === '23505') {
    throw conflict(
      'ORDER_SUBSTITUTION_ALREADY_ACTIVE',
      'Эта позиция уже обрабатывается другим сотрудником',
    );
  }
  if (error) throw error;

  if (payload.action === 'remove_refund') {
    try {
      const refund = await createPartialRefund(
        order.id,
        {
          idempotencyKey: inserted.id,
          items: [{ lineKey: line.lineKey, quantity: payload.quantity }],
          reason: payload.note || `Товар «${line.name}» отсутствует`,
        },
        requestedBy,
      );
      const { data: completed, error: completionError } = await supabase
        .from('order_substitution_requests')
        .update({
          status: 'completed',
          refund_id: refund.id,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', inserted.id)
        .select('*')
        .single();
      if (completionError) throw completionError;
      publish(order, completed);
      return normalize(completed);
    } catch (failure) {
      await supabase
        .from('order_substitution_requests')
        .update({
          status: 'failed',
          error: String(failure.message || 'Возврат не выполнен').slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', inserted.id);
      throw failure;
    }
  }

  if (payload.action === 'replace_with_approval') {
    await notifyCustomer(order, inserted).catch((failure) =>
      console.error('Не удалось уведомить клиента о замене:', failure.message),
    );
  }
  publish(order, inserted);
  return normalize(inserted);
}

async function respondToSubstitution(customerId, orderId, requestId, approved) {
  const order = await readOrder(orderId, customerId);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('order_substitution_requests')
    .update({
      status: approved ? 'approved' : 'rejected',
      responded_at: now,
      updated_at: now,
      ...(!approved && { completed_at: now }),
    })
    .eq('id', requestId)
    .eq('order_id', order.id)
    .eq('customer_id', customerId)
    .eq('action', 'replace_with_approval')
    .eq('status', 'awaiting_customer')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw conflict(
      'SUBSTITUTION_RESPONSE_UNAVAILABLE',
      'Предложение уже обработано или больше недоступно',
    );
  }
  publish(order, data);
  return normalize(data);
}

async function completeSubstitution(orderId, requestId) {
  const order = await readOrder(orderId);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('order_substitution_requests')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', requestId)
    .eq('order_id', order.id)
    .in('status', ['contacting', 'approved'])
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw conflict(
      'SUBSTITUTION_COMPLETION_UNAVAILABLE',
      'Действие ещё не подтверждено клиентом или уже завершено',
    );
  }
  publish(order, data);
  return normalize(data);
}

module.exports = {
  ACTIVE_STATUSES,
  completeSubstitution,
  createSubstitution,
  getSubstitutionOptions,
  normalizeSubstitution: normalize,
  respondToSubstitution,
};
