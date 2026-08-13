const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');
const { sendPushToCustomer } = require('./push.service');
const { releaseOrderReservations } = require('./inventory.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const {
  paymentProviderName,
  reconcileRefundForOrder,
  refundPaymentForOrder,
} = require('./payment-gateway.service');
const { assertExternalDeliveryCancelled } = require('./external-delivery-lifecycle.service');

const refundError = (message, statusCode = 400, code = 'PARTIAL_REFUND_INVALID') =>
  Object.assign(new Error(message), { statusCode, code });

const lineKeyFor = (item, index) =>
  String(item?.lineKey || `${item?.id || item?.productId || 'item'}:${index}`);

const normalizedLines = (order) =>
  (Array.isArray(order.cart_items) ? order.cart_items : []).map((item, index) => ({
    lineKey: lineKeyFor(item, index),
    productId: String(item.id || item.productId || ''),
    name: String(item.name || 'Товар'),
    quantity: Math.max(0, Number(item.quantity || 0)),
    unitAmount: Math.max(0, Number(item.price || 0)),
    imageUrl: item.imageUrl || item.image_url || null,
    configuration: item.configuration || null,
    modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
  }));

async function readOrder(orderId) {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw refundError('Заказ не найден', 404, 'ORDER_NOT_FOUND');
  return data;
}

async function successfulRefundedQuantities(orderId) {
  const { data, error } = await supabase
    .from('order_partial_refunds')
    .select('id,status,order_partial_refund_items(line_key,quantity,refund_amount)')
    .eq('order_id', orderId)
    .eq('status', 'succeeded');
  if (error) throw error;
  const quantities = new Map();
  const amounts = new Map();
  for (const refund of data || []) {
    for (const item of refund.order_partial_refund_items || []) {
      const key = String(item.line_key);
      quantities.set(key, (quantities.get(key) || 0) + Number(item.quantity || 0));
      amounts.set(key, (amounts.get(key) || 0) + Number(item.refund_amount || 0));
    }
  }
  return { quantities, amounts };
}

async function getRefundOptions(orderId) {
  const order = await readOrder(orderId);
  if (order.order_kind === 'gift_certificate') {
    throw refundError(
      'Сертификат можно вернуть только целиком и только пока он не использован',
      409,
      'GIFT_CERTIFICATE_PARTIAL_REFUND_FORBIDDEN',
    );
  }
  const refunded = await successfulRefundedQuantities(order.id);
  const lines = normalizedLines(order).map((line) => ({
    ...line,
    refundedQuantity: refunded.quantities.get(line.lineKey) || 0,
    refundableQuantity: Math.max(0, line.quantity - (refunded.quantities.get(line.lineKey) || 0)),
    refundedAmount: refunded.amounts.get(line.lineKey) || 0,
  }));
  return {
    orderId: String(order.id),
    orderNumber: Number(order.order_number || 0),
    previewSupported: true,
    paidAmount: Number(order.amount || 0),
    alreadyRefunded: Number(order.partially_refunded_amount || order.refund_amount || 0),
    remainingAmount: Math.max(
      0,
      Number(order.amount || 0) -
        Number(order.partially_refunded_amount || order.refund_amount || 0),
    ),
    deliveryFee: Number(order.delivery_fee || 0),
    deliveryFeeRefunded: (refunded.quantities.get('__delivery_fee__') || 0) > 0,
    lines,
  };
}

function calculateRefund(order, requested, alreadyRefunded) {
  const lines = normalizedLines(order);
  const requestMap = new Map();
  for (const entry of Array.isArray(requested) ? requested : []) {
    const key = String(entry?.lineKey || '').trim();
    const quantity = Number(entry?.quantity);
    if (!key || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw refundError('Укажите корректное количество возвращаемых позиций');
    }
    requestMap.set(key, (requestMap.get(key) || 0) + quantity);
  }
  if (!requestMap.size) throw refundError('Выберите хотя бы одну позицию');

  const lineSubtotal = lines.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0);
  const subtotal = lineSubtotal > 0 ? lineSubtotal : Number(order.subtotal || 0);
  const discount = Math.max(0, Number(order.discount_amount || 0));
  const lineRawOffsets = new Map();
  let rawOffset = 0;
  for (const line of lines) {
    lineRawOffsets.set(line.lineKey, rawOffset);
    rawOffset += line.unitAmount * line.quantity;
  }
  const records = [];
  let refundAmount = 0;
  for (const [lineKey, quantity] of requestMap) {
    const line = lines.find((candidate) => candidate.lineKey === lineKey);
    if (!line) throw refundError('Одна из позиций заказа не найдена');
    const refundedQuantity = alreadyRefunded.quantities.get(lineKey) || 0;
    if (quantity > line.quantity - refundedQuantity) {
      throw refundError(
        `Для «${line.name}» доступно к возврату: ${Math.max(0, line.quantity - refundedQuantity)}`,
      );
    }
    const targetQuantity = refundedQuantity + quantity;
    const targetRaw = line.unitAmount * targetQuantity;
    const lineRawOffset = lineRawOffsets.get(lineKey) || 0;
    const targetDiscount =
      subtotal > 0
        ? Math.round((discount * (lineRawOffset + targetRaw)) / subtotal) -
          Math.round((discount * lineRawOffset) / subtotal)
        : 0;
    const targetRefundedAmount = Math.max(0, targetRaw - targetDiscount);
    const lineRefund = Math.max(
      0,
      targetRefundedAmount - Number(alreadyRefunded.amounts.get(lineKey) || 0),
    );
    if (!Number.isSafeInteger(lineRefund) || lineRefund <= 0) {
      throw refundError(`Для «${line.name}» рассчитана некорректная сумма`);
    }
    refundAmount += lineRefund;
    records.push({
      line_key: line.lineKey,
      product_id: line.productId,
      product_name: line.name.slice(0, 200),
      quantity,
      original_quantity: line.quantity,
      unit_amount: line.unitAmount,
      refund_amount: lineRefund,
    });
  }

  const refundsEveryRemainingItem = lines.every((line) => {
    const previouslyRefunded = alreadyRefunded.quantities.get(line.lineKey) || 0;
    const requestedNow = requestMap.get(line.lineKey) || 0;
    return previouslyRefunded + requestedNow >= line.quantity;
  });
  const deliveryFee = Math.max(0, Number(order.delivery_fee || 0));
  const deliveryAlreadyRefunded = (alreadyRefunded.quantities.get('__delivery_fee__') || 0) > 0;
  if (refundsEveryRemainingItem && deliveryFee > 0 && !deliveryAlreadyRefunded) {
    refundAmount += deliveryFee;
    records.push({
      line_key: '__delivery_fee__',
      product_id: 'delivery_fee',
      product_name: 'Доставка',
      quantity: 1,
      original_quantity: 1,
      unit_amount: deliveryFee,
      refund_amount: deliveryFee,
    });
  }

  const remaining = Number(order.amount || 0) - Number(order.partially_refunded_amount || 0);
  if (refundAmount > remaining && records.length) {
    let excess = refundAmount - remaining;
    for (let index = records.length - 1; index >= 0 && excess > 0; index -= 1) {
      const reduction = Math.min(excess, records[index].refund_amount);
      records[index].refund_amount -= reduction;
      excess -= reduction;
    }
    if (excess > 0) {
      throw refundError('Не удалось безопасно распределить сумму возврата', 409);
    }
    refundAmount = records.reduce((sum, record) => sum + record.refund_amount, 0);
  }
  const positiveRecords = records.filter((record) => record.refund_amount > 0);
  if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
    throw refundError('По заказу больше нечего возвращать', 409, 'NOTHING_TO_REFUND');
  }
  if (positiveRecords.reduce((sum, record) => sum + record.refund_amount, 0) !== refundAmount) {
    throw refundError('Не удалось безопасно рассчитать сумму возврата', 409);
  }
  return { amount: refundAmount, records: positiveRecords };
}

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function buildRefundPreview(order, calculated, financials = {}) {
  const alreadyRefunded = Number(order.partially_refunded_amount || order.refund_amount || 0);
  const totalAfter = Math.min(
    Number(order.amount || 0),
    alreadyRefunded + Number(calculated.amount || 0),
  );
  const eligiblePaid = Math.max(
    0,
    Number(order.subtotal ?? order.amount ?? 0) - Number(order.discount_amount || 0),
  );
  const ratio = eligiblePaid > 0 ? Math.min(1, totalAfter / eligiblePaid) : 0;
  const targetEarned =
    totalAfter >= Number(order.amount || 0)
      ? Number(order.earned_bonus || 0)
      : roundMoney(Number(order.earned_bonus || 0) * ratio);
  const targetSpent =
    totalAfter >= Number(order.amount || 0)
      ? Number(financials.originalSpent || 0)
      : roundMoney(Number(financials.originalSpent || 0) * ratio);
  return {
    amount: Number(calculated.amount),
    remainingAfter: Math.max(0, Number(order.amount || 0) - totalAfter),
    items: calculated.records.map((item) => ({
      lineKey: item.line_key,
      productId: item.product_id,
      name: item.product_name,
      quantity: item.quantity,
      amount: item.refund_amount,
    })),
    adjustment: {
      spentBonusRestored: Math.max(
        0,
        roundMoney(targetSpent - Number(financials.priorSpentRestored || 0)),
      ),
      earnedBonusReversed: Math.max(
        0,
        roundMoney(targetEarned - Number(financials.priorEarnedReversed || 0)),
      ),
    },
    currency: 'KZT',
  };
}

async function previewPartialRefund(orderId, payload = {}) {
  const order = await readOrder(orderId);
  if (order.order_kind === 'gift_certificate') {
    throw refundError(
      'Сертификат можно вернуть только целиком и только пока он не использован',
      409,
      'GIFT_CERTIFICATE_PARTIAL_REFUND_FORBIDDEN',
    );
  }
  if (order.status !== 'paid') {
    throw refundError('Возврат доступен только для оплаченного заказа', 409);
  }
  if (['processing', 'unknown'].includes(order.refund_status)) {
    throw refundError('По заказу уже проверяется возврат', 409, 'REFUND_IN_PROGRESS');
  }
  const alreadyRefunded = await successfulRefundedQuantities(order.id);
  const calculated = calculateRefund(order, payload.items, alreadyRefunded);
  const originalOrderId = `kaspi:${order.operation_id}`;
  const [transactionsResult, adjustmentsResult] = await Promise.all([
    order.customer_id
      ? supabase
          .from('transactions')
          .select('amount')
          .eq('customer_id', order.customer_id)
          .eq('order_id', originalOrderId)
          .eq('type', 'withdrawal')
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('order_partial_refund_adjustments')
      .select('earned_bonus_reversed,spent_bonus_restored')
      .eq('order_id', order.id),
  ]);
  if (transactionsResult.error) throw transactionsResult.error;
  if (adjustmentsResult.error) throw adjustmentsResult.error;
  const sum = (rows, field) =>
    (rows || []).reduce((total, row) => total + Number(row?.[field] || 0), 0);
  return buildRefundPreview(order, calculated, {
    originalSpent: sum(transactionsResult.data, 'amount'),
    priorSpentRestored: sum(adjustmentsResult.data, 'spent_bonus_restored'),
    priorEarnedReversed: sum(adjustmentsResult.data, 'earned_bonus_reversed'),
  });
}

async function applyRefundAdjustments(refundId) {
  const { data, error } = await supabase.rpc('apply_partial_refund_adjustments', {
    p_refund_id: refundId,
  });
  if (error) throw error;
  const { error: markerError } = await supabase
    .from('order_partial_refunds')
    .update({
      adjustments_applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', refundId)
    .eq('status', 'succeeded');
  if (markerError) throw markerError;
  return Array.isArray(data) ? data[0] : data;
}

async function markRefundUnknown(refund, error, reference = null, requestId = null) {
  const { error: saveError } = await supabase.rpc('mark_partial_refund_unknown', {
    p_refund_id: refund.id,
    p_error: String(error?.message || error || 'Результат возврата требует сверки').slice(0, 1000),
    p_provider_reference: String(reference || error?.refundReference || '').slice(0, 160) || null,
    p_provider_request_id: requestId || error?.requestId || refund.id,
  });
  if (saveError) throw saveError;
}

async function completeRefundRecord(refund, reference = null) {
  const { data, error } = await supabase.rpc('complete_partial_refund', {
    p_refund_id: refund.id,
    p_kaspi_reference: reference || refund.provider_reference || refund.kaspi_reference || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function findSubstitutionForRefund(refund) {
  const { data, error } = await supabase
    .from('order_substitution_requests')
    .select('id,order_id,status')
    .eq('id', refund.idempotency_key)
    .eq('order_id', refund.order_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function resumeSubstitutionAfterRefund(refund) {
  const request = await findSubstitutionForRefund(refund);
  if (!request || request.status !== 'processing') return;
  const { error } = await supabase.rpc('complete_order_substitution_execution', {
    p_order_id: refund.order_id,
    p_request_id: request.id,
    p_refund_id: refund.id,
  });
  if (error) throw error;
}

async function abortSubstitutionAfterDecline(refund, message) {
  const request = await findSubstitutionForRefund(refund);
  if (!request || request.status !== 'processing') return;
  const { error } = await supabase.rpc('abort_order_substitution_execution', {
    p_order_id: refund.order_id,
    p_request_id: request.id,
    p_error: String(message || 'Банк отклонил возврат').slice(0, 1000),
  });
  if (error) throw error;
}

async function notifyRefund(order, amount) {
  if (!order.customer_id) return;
  const title = order.status === 'refunded' ? 'Заказ возвращён' : 'Частичный возврат оформлен';
  const provider = paymentProviderName(order);
  const body = `Возврат ${Number(amount).toLocaleString('ru-RU')} ₸ по заказу №${order.order_number} отправлен через ${provider}. Срок зачисления зависит от банка карты.`;
  const [{ data: customer }, { data: notification }] = await Promise.all([
    supabase.from('customers').select('fcm_token').eq('id', order.customer_id).maybeSingle(),
    supabase
      .from('customer_notifications')
      .insert({
        customer_id: order.customer_id,
        title,
        body,
        type: 'refund',
        payload: { orderId: order.id, orderNumber: order.order_number, amount },
      })
      .select('id')
      .maybeSingle(),
  ]);
  if (order.customer_id) {
    await sendPushToCustomer(
      order.customer_id,
      title,
      body,
      {
        type: 'refund',
        orderId: String(order.id),
        orderNumber: String(order.order_number),
        orderStatus: String(
          order.status === 'refunded' ? 'refunded' : order.fulfillment_status || '',
        ),
        notificationId: String(notification?.id || ''),
      },
      customer?.fcm_token,
    );
  }
}

async function createPartialRefund(orderId, payload = {}, requestedBy = 'admin') {
  const idempotencyKey = String(payload.idempotencyKey || crypto.randomUUID());
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw refundError('Некорректный ключ операции');
  const { data: duplicate, error: duplicateError } = await supabase
    .from('order_partial_refunds')
    .select('*,order_partial_refund_items(*)')
    .eq('order_id', orderId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) {
    const adjustment =
      duplicate.status === 'succeeded' ? await applyRefundAdjustments(duplicate.id) : null;
    return { ...duplicate, duplicate: true, adjustment };
  }

  const order = await readOrder(orderId);
  if (order.order_kind === 'gift_certificate') {
    throw refundError(
      'Сертификат можно вернуть только целиком и только пока он не использован',
      409,
      'GIFT_CERTIFICATE_PARTIAL_REFUND_FORBIDDEN',
    );
  }
  if (order.status !== 'paid')
    throw refundError('Возврат доступен только для оплаченного заказа', 409);
  if (['processing', 'unknown'].includes(order.refund_status)) {
    throw refundError('По заказу уже проверяется возврат', 409, 'REFUND_IN_PROGRESS');
  }
  await assertExternalDeliveryCancelled(order.id);
  const alreadyRefunded = await successfulRefundedQuantities(order.id);
  const calculated = calculateRefund(order, payload.items, alreadyRefunded);
  const processorToken = crypto.randomUUID();
  const reason =
    String(payload.reason || '')
      .trim()
      .slice(0, 500) || null;
  const { data: claimedRefund, error: claimError } = await supabase.rpc('claim_partial_refund', {
    p_order_id: order.id,
    p_idempotency_key: idempotencyKey,
    p_processor_token: processorToken,
    p_amount: calculated.amount,
    p_reason: reason,
    p_requested_by: String(requestedBy || 'admin').slice(0, 160),
    p_items: calculated.records,
  });
  if (claimError) {
    const message = String(claimError.message || '');
    if (message.includes('already claimed')) {
      throw refundError(
        'Одна из позиций уже возвращается другим оператором. Обновите заказ.',
        409,
        'REFUND_LINE_ALREADY_CLAIMED',
      );
    }
    if (message.includes('another refund is already being processed')) {
      throw refundError(
        'По заказу уже выполняется другой возврат. Дождитесь результата.',
        409,
        'REFUND_IN_PROGRESS',
      );
    }
    throw claimError;
  }
  const refund = Array.isArray(claimedRefund) ? claimedRefund[0] : claimedRefund;
  if (!refund?.id) throw refundError('Не удалось зарезервировать позиции возврата', 500);
  if (String(refund.processor_token || '') !== processorToken) {
    return {
      ...refund,
      duplicate: true,
      inProgress: ['processing', 'unknown'].includes(refund.status),
      adjustment: refund.status === 'succeeded' ? await applyRefundAdjustments(refund.id) : null,
    };
  }
  if (refund.status === 'succeeded') {
    return {
      ...refund,
      duplicate: true,
      adjustment: await applyRefundAdjustments(refund.id),
    };
  }
  if (refund.status !== 'processing') {
    throw refundError(
      refund.error || 'Этот запрос возврата уже завершился с ошибкой',
      409,
      'REFUND_REQUEST_ALREADY_FINISHED',
    );
  }

  let gatewayRefund;
  try {
    gatewayRefund = await refundPaymentForOrder(order, calculated.amount, {
      reason,
      idempotencyKey: refund.id,
    });
  } catch (error) {
    const failureMessage = String(
      error.message || `${paymentProviderName(order)} не подтвердил возврат`,
    ).slice(0, 1000);
    let failureSaveError;
    if (error.refundUncertain === true) {
      try {
        await markRefundUnknown(refund, error);
      } catch (saveError) {
        failureSaveError = saveError;
      }
    } else {
      const result = await supabase.rpc('fail_partial_refund', {
        p_refund_id: refund.id,
        p_error: failureMessage,
        p_result_unknown: false,
      });
      failureSaveError = result.error;
    }
    if (failureSaveError) {
      console.error(
        'Не удалось сохранить состояние частичного возврата:',
        failureSaveError.message,
      );
    }
    const publicError = refundError(
      error.message || `${paymentProviderName(order)} не подтвердил возврат`,
      error.statusCode || 502,
      error.code || 'PAYMENT_PARTIAL_REFUND_FAILED',
    );
    if (error.refundUncertain === true) publicError.preserveSubstitutionExecution = true;
    throw publicError;
  }

  let finalOrder;
  try {
    finalOrder = await completeRefundRecord(refund, gatewayRefund.reference || null);
  } catch (_completionError) {
    try {
      await markRefundUnknown(
        refund,
        new Error(`${paymentProviderName(order)} подтвердил возврат, но база не обновилась`),
        gatewayRefund.reference || null,
        gatewayRefund.requestId || refund.id,
      );
    } catch (saveError) {
      console.error('Не удалось поставить возврат в очередь сверки:', saveError.message);
    }
    const publicError = refundError(
      `${paymentProviderName(order)} подтвердил возврат, но база не обновилась. Проверьте операцию.`,
      500,
      'PAYMENT_REFUND_DB_CONFLICT',
    );
    publicError.preserveSubstitutionExecution = true;
    throw publicError;
  }
  let adjustment;
  try {
    adjustment = await applyRefundAdjustments(refund.id);
    if (order.customer_id) queueCustomerLoyaltySync(order.customer_id);
  } catch (error) {
    console.error('Не удалось применить финансовый перерасчёт возврата:', error.message);
    throw refundError(
      `${paymentProviderName(order)} подтвердил возврат, но финансовый перерасчёт ожидает повторной сверки.`,
      500,
      'REFUND_ADJUSTMENT_PENDING',
    );
  }
  if (finalOrder?.status === 'refunded') {
    await releaseOrderReservations(finalOrder.id).catch((error) =>
      console.error('Не удалось освободить резерв после возврата:', error.message),
    );
  }
  await notifyRefund(finalOrder || order, calculated.amount).catch((error) =>
    console.error('Не удалось уведомить о частичном возврате:', error.message),
  );
  realtime.publish(
    'order.updated',
    {
      orderId: order.id,
      orderNumber: order.order_number,
      refundStatus: finalOrder?.refund_status || 'partial',
      refundAmount: finalOrder?.refund_amount || calculated.amount,
    },
    { customerId: order.customer_id, includeAdmins: true, branchId: order.branch_id },
  );
  return {
    id: refund.id,
    orderId: order.id,
    amount: calculated.amount,
    status: 'succeeded',
    reference: gatewayRefund.reference || null,
    adjustment,
    items: calculated.records.map(({ original_quantity: _originalQuantity, ...item }) => item),
  };
}

async function reconcilePartialRefundRecord(refund, dependencies) {
  let decision;
  try {
    decision = await dependencies.resolve(refund);
  } catch (error) {
    decision = {
      status: 'pending',
      reference: refund.provider_reference || null,
      requestId: refund.provider_request_id || refund.id,
      message: error.message,
    };
  }

  if (decision?.status === 'confirmed') {
    const completed = await dependencies.complete(refund, decision);
    const adjustment = await dependencies.applyAdjustments(refund, completed, decision);
    if (dependencies.afterConfirmed) {
      await dependencies.afterConfirmed(refund, completed, adjustment, decision);
    }
    return { status: 'confirmed', completed, adjustment, decision };
  }

  if (decision?.status === 'declined') {
    const declined = await dependencies.decline(refund, decision);
    if (dependencies.afterDeclined) {
      await dependencies.afterDeclined(refund, declined, decision);
    }
    return { status: 'declined', declined, decision };
  }

  await dependencies.defer(refund, decision || { status: 'pending' });
  return { status: 'pending', decision };
}

async function deferUnknownRefund(refund, decision = {}) {
  const attempts = Number(refund.reconciliation_attempts || 0) + 1;
  const delayMinutes = Math.min(30, Math.max(1, 2 ** Math.min(attempts - 1, 5)));
  const now = new Date();
  const requestId = String(decision.requestId || refund.provider_request_id || refund.id);
  const providerRequestId = /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : refund.id;
  const { error } = await supabase
    .from('order_partial_refunds')
    .update({
      provider_reference:
        String(decision.reference || refund.provider_reference || '').slice(0, 160) || null,
      provider_request_id: providerRequestId,
      error: String(
        decision.message || refund.error || 'Банк ещё не подтвердил результат возврата',
      ).slice(0, 1000),
      reconciliation_attempts: attempts,
      last_reconciled_at: now.toISOString(),
      next_reconcile_at: new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', refund.id)
    .eq('status', 'unknown');
  if (error) throw error;
}

async function afterConfirmedRefund(refund, finalOrder, _adjustment, decision) {
  const order = refund.order;
  if (order?.customer_id) queueCustomerLoyaltySync(order.customer_id);
  await resumeSubstitutionAfterRefund(refund).catch((error) =>
    console.error('Не удалось завершить замену после сверки возврата:', error.message),
  );
  if (finalOrder?.status === 'refunded') {
    await releaseOrderReservations(finalOrder.id).catch((error) =>
      console.error('Не удалось освободить резерв после сверки возврата:', error.message),
    );
  }
  await notifyRefund(finalOrder || order, refund.amount).catch((error) =>
    console.error('Не удалось уведомить о сверенном возврате:', error.message),
  );
  realtime.publish(
    'order.updated',
    {
      orderId: order.id,
      orderNumber: order.order_number,
      refundStatus: finalOrder?.refund_status || 'partial',
      refundAmount: finalOrder?.refund_amount || refund.amount,
      refundReference: decision.reference || null,
    },
    { customerId: order.customer_id, includeAdmins: true, branchId: order.branch_id },
  );
}

async function reconcileUnknownPartialRefunds({ limit = 25 } = {}) {
  const now = new Date().toISOString();
  const batchLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const staleProcessingCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const [{ data: readyUnknown, error }, { data: staleProcessing, error: staleProcessingError }] =
    await Promise.all([
      supabase
        .from('order_partial_refunds')
        .select('*')
        .eq('status', 'unknown')
        .or(`next_reconcile_at.is.null,next_reconcile_at.lte.${now}`)
        .order('created_at', { ascending: true })
        .limit(batchLimit),
      supabase
        .from('order_partial_refunds')
        .select('*')
        .eq('status', 'processing')
        .lte('created_at', staleProcessingCutoff)
        .order('created_at', { ascending: true })
        .limit(batchLimit),
    ]);
  if (error) throw error;
  if (staleProcessingError) throw staleProcessingError;

  const unknownRefunds = [...(readyUnknown || [])];
  for (const refund of staleProcessing || []) {
    try {
      await markRefundUnknown(
        refund,
        new Error('Операция возврата не завершилась за отведённое время'),
        refund.provider_reference || null,
        refund.provider_request_id || refund.id,
      );
      unknownRefunds.push({ ...refund, status: 'unknown' });
    } catch (staleError) {
      console.error(
        `Не удалось перевести зависший возврат ${refund.id} в сверку:`,
        staleError.message,
      );
    }
  }

  let processed = 0;
  for (const refund of unknownRefunds) {
    try {
      const order = await readOrder(refund.order_id);
      const { data: succeeded, error: succeededError } = await supabase
        .from('order_partial_refunds')
        .select('amount')
        .eq('order_id', refund.order_id)
        .eq('status', 'succeeded');
      if (succeededError) throw succeededError;
      const knownSucceededAmount = (succeeded || []).reduce(
        (total, row) => total + Number(row.amount || 0),
        0,
      );
      const record = { ...refund, order };
      await reconcilePartialRefundRecord(record, {
        resolve: (current) =>
          reconcileRefundForOrder(current.order, current, { knownSucceededAmount }),
        complete: (current, decision) => completeRefundRecord(current, decision.reference || null),
        applyAdjustments: (current) => applyRefundAdjustments(current.id),
        afterConfirmed: afterConfirmedRefund,
        decline: async (current, decision) => {
          const { data, error: declineError } = await supabase.rpc('decline_partial_refund', {
            p_refund_id: current.id,
            p_error: String(decision.message || 'Банк отклонил возврат').slice(0, 1000),
          });
          if (declineError) throw declineError;
          return Array.isArray(data) ? data[0] : data;
        },
        afterDeclined: async (current, _declined, decision) => {
          await abortSubstitutionAfterDecline(current, decision.message).catch((abortError) =>
            console.error(
              'Не удалось отменить подготовленную замену после отказа банка:',
              abortError.message,
            ),
          );
        },
        defer: deferUnknownRefund,
      });
      processed += 1;
    } catch (refundError) {
      await deferUnknownRefund(refund, {
        status: 'pending',
        message: refundError.message,
      }).catch((saveError) =>
        console.error(
          `Не удалось отложить сверку частичного возврата ${refund.id}:`,
          saveError.message,
        ),
      );
      console.error(`Не удалось сверить частичный возврат ${refund.id}:`, refundError.message);
    }
  }

  const { data: adjustmentRows, error: adjustmentReadError } = await supabase
    .from('order_partial_refunds')
    .select('*')
    .eq('status', 'succeeded')
    .is('adjustments_applied_at', null)
    .order('completed_at', { ascending: true })
    .limit(batchLimit);
  if (adjustmentReadError) throw adjustmentReadError;
  for (const refund of adjustmentRows || []) {
    try {
      const order = await readOrder(refund.order_id);
      await applyRefundAdjustments(refund.id);
      if (order.customer_id) queueCustomerLoyaltySync(order.customer_id);
      await resumeSubstitutionAfterRefund(refund).catch((resumeError) =>
        console.error('Не удалось завершить замену после финансовой сверки:', resumeError.message),
      );
      if (order.status === 'refunded') {
        await releaseOrderReservations(order.id).catch((releaseError) =>
          console.error(
            'Не удалось освободить резерв после финансовой сверки:',
            releaseError.message,
          ),
        );
      }
      processed += 1;
    } catch (adjustmentError) {
      console.error(
        `Не удалось восстановить перерасчёт возврата ${refund.id}:`,
        adjustmentError.message,
      );
    }
  }
  return processed;
}

module.exports = {
  buildRefundPreview,
  calculateRefund,
  createPartialRefund,
  getRefundOptions,
  lineKeyFor,
  applyRefundAdjustments,
  previewPartialRefund,
  reconcilePartialRefundRecord,
  reconcileUnknownPartialRefunds,
};
