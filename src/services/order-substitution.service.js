const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { conflict, forbidden, notFound, badRequest } = require('../utils/app-error.util');
const {
  applyRefundAdjustments,
  createPartialRefund,
  getRefundOptions,
} = require('./partial-refund.service');
const { getBranchAvailability, listInventory } = require('./inventory.service');
const { loadOrderCatalog } = require('./order.service');
const { validateCartOptions } = require('./product-options.service');
const { paymentProviderName, refundPaymentForOrder } = require('./payment-gateway.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { sendPushToCustomer } = require('./push.service');
const realtime = require('./realtime.service');

const ACTIVE_STATUSES = ['pending', 'processing', 'contacting', 'awaiting_customer', 'approved'];
const FINANCIAL_COMPLETION_ROLES = new Set(['owner', 'admin', 'branch_manager']);

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
  originalUnitAmount:
    request.original_unit_amount == null ? null : Number(request.original_unit_amount),
  replacementUnitAmount:
    request.replacement_unit_amount == null ? null : Number(request.replacement_unit_amount),
  chargedUnitAmount:
    request.charged_unit_amount == null ? null : Number(request.charged_unit_amount),
  refundAmount: Number(request.refund_amount || 0),
  waivedAmount: Number(request.waived_amount || 0),
});

async function readOrder(orderId, customerId = null) {
  let query = supabase.from('kaspi_orders').select('*').eq('id', orderId);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('ORDER_NOT_FOUND', 'Заказ не найден');
  return data;
}

async function readSubstitution(orderId, requestId) {
  const { data, error } = await supabase
    .from('order_substitution_requests')
    .select('*')
    .eq('id', requestId)
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('SUBSTITUTION_NOT_FOUND', 'Запрос замены не найден');
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

const rpcRow = (value) => (Array.isArray(value) ? value[0] : value);

async function resolveReplacementForExecution(order, request) {
  const effectiveOrderType =
    order.fulfillment_type === 'preorder'
      ? order.preorder_fulfillment_type || 'pickup'
      : order.fulfillment_type || 'pickup';
  const [catalog, refundOptions] = await Promise.all([
    loadOrderCatalog({ branchId: order.branch_id, orderType: effectiveOrderType }),
    getRefundOptions(order.id),
  ]);
  const product = catalog.get(String(request.replacement_product_id || ''));
  const line = refundOptions.lines.find((item) => item.lineKey === request.line_key);
  if (!line) throw conflict('ORDER_LINE_CHANGED', 'Позиция заказа уже изменилась');
  if (
    !product ||
    product.isAvailable !== true ||
    (Number.isInteger(product.availableQuantity) &&
      product.availableQuantity < Number(request.quantity || 0))
  ) {
    throw conflict('REPLACEMENT_UNAVAILABLE', 'Выбранная замена больше недоступна');
  }

  let validated;
  try {
    validated = await validateCartOptions([
      {
        id: String(request.replacement_product_id),
        iikoProductId: product.iikoProductId || null,
        productSizeId: product.productSizeId || null,
        name: String(product.name || request.replacement_product_name || 'Товар').slice(0, 160),
        price: Number(product.price),
        quantity: Number(request.quantity),
        source: product.source || 'iiko',
        preparationMinutes: Number(product.preparationMinutes || 15),
        configuration: null,
        modifiers: [],
      },
    ]);
  } catch (_error) {
    throw conflict(
      'REPLACEMENT_CONFIGURATION_REQUIRED',
      `Для «${product.name || request.replacement_product_name}» нужно выбрать параметры. Выберите другую замену.`,
    );
  }
  const canonical = validated.canonicalItems[0];
  if (!canonical || !Number.isSafeInteger(Number(canonical.price)) || canonical.price <= 0) {
    throw conflict('REPLACEMENT_UNAVAILABLE', 'У выбранной замены некорректная цена');
  }
  if (Number(canonical.price) > Number(line.unitAmount)) {
    throw conflict(
      'REPLACEMENT_REQUIRES_ADDITIONAL_PAYMENT',
      `«${canonical.name}» дороже отсутствующего товара. Выберите замену той же цены или дешевле.`,
    );
  }
  return canonical;
}

async function prepareExecution(order, request, replacement) {
  const { data, error } = await supabase.rpc('prepare_order_substitution_execution', {
    p_order_id: order.id,
    p_request_id: request.id,
    p_replacement: replacement || null,
  });
  if (error) {
    const message = String(error.message || '');
    if (message.includes('replacement price exceeds original price')) {
      throw conflict(
        'REPLACEMENT_REQUIRES_ADDITIONAL_PAYMENT',
        'Замена стала дороже. Выберите товар той же цены или дешевле.',
      );
    }
    if (
      message.includes('replacement inventory') ||
      message.includes('replacement product changed')
    ) {
      throw conflict('REPLACEMENT_UNAVAILABLE', 'Выбранная замена больше недоступна');
    }
    throw error;
  }
  return rpcRow(data) || {};
}

async function abortExecution(orderId, requestId, error) {
  const message = String(error?.message || error || 'Не удалось выполнить действие').slice(0, 1000);
  const { error: abortError } = await supabase.rpc('abort_order_substitution_execution', {
    p_order_id: orderId,
    p_request_id: requestId,
    p_error: message,
  });
  if (abortError) {
    console.error('Не удалось отменить подготовленную замену:', abortError.message);
  }
}

async function readExecutionRefund(orderId, requestId) {
  const { data, error } = await supabase
    .from('order_partial_refunds')
    .select('id,status,amount,error')
    .eq('order_id', orderId)
    .eq('idempotency_key', requestId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createPriceDifferenceRefund(order, request, amount, requestedBy) {
  const normalizedAmount = Number(amount);
  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw conflict('SUBSTITUTION_REFUND_INVALID', 'Некорректная сумма возврата за замену');
  }
  const processorToken = crypto.randomUUID();
  const reason = `Разница стоимости замены «${request.product_name}» → «${request.replacement_product_name}»`;
  const { data: claimedData, error: claimError } = await supabase.rpc('claim_partial_refund', {
    p_order_id: order.id,
    p_idempotency_key: request.id,
    p_processor_token: processorToken,
    p_amount: normalizedAmount,
    p_reason: reason,
    p_requested_by: String(requestedBy || 'admin').slice(0, 160),
    p_items: [
      {
        line_key: `substitution:${request.id}`,
        product_id: String(request.product_id),
        product_name: `Разница стоимости: ${request.product_name}`,
        quantity: 1,
        original_quantity: 1,
        unit_amount: normalizedAmount,
        refund_amount: normalizedAmount,
      },
    ],
  });
  if (claimError) throw claimError;
  const claimed = rpcRow(claimedData);
  if (!claimed?.id) throw new Error('Не удалось зарегистрировать возврат разницы');

  await supabase
    .from('order_substitution_requests')
    .update({ refund_id: claimed.id, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('order_id', order.id)
    .eq('status', 'processing');

  if (claimed.status === 'succeeded') {
    await applyRefundAdjustments(claimed.id);
    return claimed;
  }
  if (claimed.status !== 'processing') {
    throw conflict(
      'SUBSTITUTION_REFUND_FAILED',
      claimed.error || 'Предыдущий возврат разницы завершился с ошибкой',
    );
  }
  if (String(claimed.processor_token || '') !== processorToken) {
    const error = conflict(
      'SUBSTITUTION_REFUND_IN_PROGRESS',
      'Возврат разницы уже выполняется. Дождитесь результата сверки.',
    );
    error.preserveSubstitutionExecution = true;
    throw error;
  }

  let gatewayRefund;
  try {
    gatewayRefund = await refundPaymentForOrder(order, normalizedAmount, {
      reason,
      idempotencyKey: claimed.id,
    });
  } catch (failure) {
    const failureMessage = String(
      failure.message || `${paymentProviderName(order)} не подтвердил возврат`,
    ).slice(0, 1000);
    if (failure.refundUncertain === true) {
      await supabase.rpc('mark_partial_refund_unknown', {
        p_refund_id: claimed.id,
        p_error: failureMessage,
        p_provider_reference: String(failure.refundReference || '').slice(0, 160) || null,
        p_provider_request_id: failure.requestId || claimed.id,
      });
    } else {
      await supabase.rpc('fail_partial_refund', {
        p_refund_id: claimed.id,
        p_error: failureMessage,
        p_result_unknown: false,
      });
    }
    if (failure.refundUncertain === true) failure.preserveSubstitutionExecution = true;
    throw failure;
  }

  const { error: completionError } = await supabase.rpc('complete_partial_refund', {
    p_refund_id: claimed.id,
    p_kaspi_reference: gatewayRefund.reference || null,
  });
  if (completionError) {
    await supabase.rpc('mark_partial_refund_unknown', {
      p_refund_id: claimed.id,
      p_error: `${paymentProviderName(order)} подтвердил возврат, но база не обновилась`,
      p_provider_reference: gatewayRefund.reference || null,
      p_provider_request_id: gatewayRefund.requestId || claimed.id,
    });
    completionError.preserveSubstitutionExecution = true;
    throw completionError;
  }
  try {
    await applyRefundAdjustments(claimed.id);
    if (order.customer_id) queueCustomerLoyaltySync(order.customer_id);
  } catch (adjustmentError) {
    console.error(
      'Возврат разницы выполнен, но финансовый перерасчёт ожидает сверки:',
      adjustmentError.message,
    );
  }
  return { ...claimed, status: 'succeeded', reference: gatewayRefund.reference || null };
}

async function finalizeExecution(order, request, refundId = null) {
  const { data, error } = await supabase.rpc('complete_order_substitution_execution', {
    p_order_id: order.id,
    p_request_id: request.id,
    p_refund_id: refundId,
  });
  if (error) {
    error.preserveSubstitutionExecution = Boolean(refundId);
    throw error;
  }
  return rpcRow(data) || {};
}

async function executeSubstitution(order, request, requestedBy = 'admin') {
  let prepared = null;
  try {
    const replacement =
      request.action === 'replace_with_approval'
        ? await resolveReplacementForExecution(order, request)
        : null;
    prepared = await prepareExecution(order, request, replacement);
    if (prepared.status === 'completed')
      return normalize(await readSubstitution(order.id, request.id));

    let refund = null;
    if (request.action === 'remove_refund') {
      refund = await createPartialRefund(
        order.id,
        {
          idempotencyKey: request.id,
          items: [{ lineKey: request.line_key, quantity: Number(request.quantity) }],
          reason: request.note || `Товар «${request.product_name}» отсутствует`,
        },
        requestedBy,
      );
    } else if (Number(prepared.refundAmount || 0) > 0) {
      refund = await createPriceDifferenceRefund(
        order,
        request,
        Number(prepared.refundAmount),
        requestedBy,
      );
    }

    await finalizeExecution(order, request, refund?.id || null);
    const completed = await readSubstitution(order.id, request.id);
    publish(order, completed);
    return normalize(completed);
  } catch (error) {
    let preserve = error.preserveSubstitutionExecution === true;
    if (prepared && !preserve) {
      try {
        const refund = await readExecutionRefund(order.id, request.id);
        preserve = ['processing', 'succeeded'].includes(String(refund?.status || ''));
      } catch (stateError) {
        preserve = true;
        console.error('Не удалось проверить состояние возврата замены:', stateError.message);
      }
    }
    if (preserve) {
      await supabase
        .from('order_substitution_requests')
        .update({
          error: String(error.message || 'Операция требует сверки').slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('order_id', order.id)
        .eq('status', 'processing');
    } else {
      await abortExecution(order.id, request.id, error);
    }
    throw error;
  }
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
    return executeSubstitution(order, inserted, requestedBy);
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

async function completeSubstitution(orderId, requestId, requestedBy = 'admin', { role } = {}) {
  const order = await readOrder(orderId);
  const request = await readSubstitution(order.id, requestId);
  if (request.action !== 'call_customer' && !FINANCIAL_COMPLETION_ROLES.has(String(role || ''))) {
    throw forbidden(
      'SUBSTITUTION_FINANCIAL_PERMISSION_REQUIRED',
      'Завершить замену или возврат может владелец, администратор или управляющий филиалом',
    );
  }
  if (
    request.action === 'replace_with_approval' &&
    ['approved', 'processing', 'completed'].includes(request.status)
  ) {
    return executeSubstitution(order, request, requestedBy);
  }
  if (request.action === 'remove_refund' && ['processing', 'completed'].includes(request.status)) {
    return executeSubstitution(order, request, requestedBy);
  }
  if (request.action !== 'call_customer' || request.status !== 'contacting') {
    throw conflict(
      'SUBSTITUTION_COMPLETION_UNAVAILABLE',
      'Действие ещё не подтверждено клиентом или уже завершено',
    );
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('order_substitution_requests')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', requestId)
    .eq('order_id', order.id)
    .eq('status', 'contacting')
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
