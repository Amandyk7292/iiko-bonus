const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');

const KASPI_URL =
  process.env.KASPI_MICROSERVICE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/kaspi-pos`;
const DEFAULT_PENDING_RECONCILIATION_MS = 24 * 60 * 60 * 1000;
const MIN_PENDING_RECONCILIATION_MS = 15 * 60 * 1000;

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

const normalizeKaspiPhoneNumber = (value) => {
  const digits = digitsOnly(value);

  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;

  return null;
};

const kaspiResultCodes = (body) =>
  ['StatusCode', 'ResultCode', 'Code']
    .map((field) => body?.[field])
    .filter((value) => value !== undefined && value !== null && value !== '');

const isKaspiSuccess = (body) => {
  const codes = kaspiResultCodes(body);
  return codes.length > 0 && codes.every((value) => Number(value) === 0);
};

const kaspiErrorMessage = (body, fallback) =>
  String(body?.Message || body?.Description || body?.message || body?.error || fallback);

const paymentStatusCanTransition = (currentStatus, nextStatus) => {
  const current = String(currentStatus || 'pending');
  const next = String(nextStatus || '');
  if (!['pending', 'paid', 'failed', 'expired', 'refunded'].includes(next)) return false;
  if (current === next) return true;
  if (current === 'refunded') return false;
  if (current === 'paid') return next === 'refunded';
  if (next === 'paid') return true;
  return current === 'pending' && ['failed', 'expired'].includes(next);
};

const pendingReconciliationWindowMs = () => {
  const configured = Number(process.env.KASPI_PENDING_RECONCILIATION_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_PENDING_RECONCILIATION_MS;
  return Math.max(MIN_PENDING_RECONCILIATION_MS, Math.floor(configured));
};

const eligibleOrderAmount = (order) =>
  Math.max(0, Number(order?.subtotal ?? order?.amount ?? 0) - Number(order?.discount_amount || 0));

const paymentResponse = (order) => ({
  success: true,
  method: order.payment_method || 'invoice',
  operationId: order.operation_id,
  qrToken: order.qr_token || undefined,
  amount: Number(order.amount),
  orderType: order.fulfillment_type || 'pickup',
  branchId: order.branch_id == null ? null : String(order.branch_id),
  scheduledAt: order.scheduled_at || null,
});

const fetchJson = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
};

class KaspiService {
  internalHeaders(extra = {}) {
    const secret = String(process.env.KASPI_INTERNAL_SECRET || '');
    if (secret.length < 32) throw new Error('KASPI_INTERNAL_SECRET is not configured');
    return { Authorization: `Bearer ${secret}`, ...extra };
  }

  async cancelInvoice(operationId) {
    const { response, body } = await fetchJson(`${KASPI_URL}/api/invoice/cancel`, {
      method: 'POST',
      headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ operationId: String(operationId) }),
    });
    if (!response.ok || (kaspiResultCodes(body).length > 0 && !isKaspiSuccess(body))) {
      throw new Error(kaspiErrorMessage(body, `Kaspi returned ${response.status}`));
    }
  }

  async existingRequest(customerId, requestId) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select('operation_id,payment_method,qr_token,amount,fulfillment_type,branch_id,scheduled_at')
      .eq('customer_id', customerId)
      .eq('client_request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Отправляет запрос на микросервис Kaspi для создания счета
   */
  async createInvoice(phone, pricing, customerId, checkout = {}) {
    const normalizedPhone = normalizeKaspiPhoneNumber(phone);
    if (!normalizedPhone) throw new Error('Invalid phoneNumber format');
    const { total: amount, canonicalItems: cartItems } = pricing;
    let existing;
    try {
      existing = await this.existingRequest(customerId, checkout.requestId);
    } catch (error) {
      throw new Error('Не удалось проверить заказ: ' + error.message, { cause: error });
    }
    if (existing) return paymentResponse(existing);

    let comment = 'Оплата заказа Bulka';
    if (cartItems && cartItems.length > 0) {
      const itemsList = cartItems.map((item) => `${item.name} x${item.quantity}`).join(', ');
      comment += `\n${itemsList}`;
    }

    const fulfillmentLabel = {
      pickup: 'Самовывоз',
      delivery: 'Доставка',
      preorder: 'Предзаказ',
    }[checkout.orderType || 'pickup'];
    comment += `\n${fulfillmentLabel}`;
    if (checkout.deliveryAddress?.address) {
      comment += `: ${checkout.deliveryAddress.address}`;
    }
    comment = comment.slice(0, 500);

    let invoiceResult;
    try {
      invoiceResult = await fetchJson(`${KASPI_URL}/api/invoice/create`, {
        method: 'POST',
        headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          phoneNumber: normalizedPhone,
          amount,
          comment,
        }),
      });
    } catch (error) {
      throw Object.assign(
        new Error('Ответ Kaspi не получен. Проверьте счета в Kaspi Pay перед повтором.'),
        { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN', cause: error },
      );
    }

    const { response, body: data } = invoiceResult;
    if (!response.ok) {
      throw Object.assign(
        new Error(kaspiErrorMessage(data, 'Kaspi не подтвердил создание счёта.')),
        { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN' },
      );
    }

    let operationId = data?.Data?.Id || data?.Data?.QrOperationId;
    const invoiceCodes = kaspiResultCodes(data);
    if (operationId && invoiceCodes.some((value) => Number(value) !== 0)) {
      throw Object.assign(
        new Error('Kaspi вернул противоречивый статус. Проверьте счет в Kaspi Pay.'),
        { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN' },
      );
    }

    if (!operationId) {
      const resultCodes = kaspiResultCodes(data);
      const explicitlyRejected =
        resultCodes.length > 0 && resultCodes.some((value) => Number(value) !== 0);
      if (!explicitlyRejected) {
        throw Object.assign(
          new Error('Kaspi не вернул номер счёта. Проверьте Kaspi Pay перед повтором.'),
          { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN' },
        );
      }
      if (process.env.KASPI_QR_FALLBACK_ENABLED === 'false') {
        throw Object.assign(new Error(kaspiErrorMessage(data, 'Kaspi отклонил удалённый счёт.')), {
          statusCode: 409,
          code: 'KASPI_INVOICE_REJECTED',
        });
      }

      let qrResult;
      try {
        qrResult = await fetchJson(`${KASPI_URL}/api/qr/create`, {
          method: 'POST',
          headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ amount, comment }),
        });
      } catch (error) {
        throw Object.assign(new Error('Ответ Kaspi QR не получен. Повторите попытку позже.'), {
          statusCode: 502,
          code: 'KASPI_QR_CREATE_UNKNOWN',
          cause: error,
        });
      }

      if (!qrResult.response.ok) {
        throw Object.assign(
          new Error(kaspiErrorMessage(qrResult.body, 'Kaspi QR временно недоступен.')),
          { statusCode: 502, code: 'KASPI_QR_CREATE_FAILED' },
        );
      }

      const qrData = qrResult.body;
      operationId = qrData?.Data?.Id || qrData?.Data?.QrOperationId;
      const qrToken = qrData?.Data?.QrToken;

      if (!qrData.Data || !operationId || !qrToken || !isKaspiSuccess(qrData)) {
        throw Object.assign(new Error('Не удалось получить QR-код от Kaspi'), {
          statusCode: 502,
          code: 'KASPI_QR_CREATE_FAILED',
        });
      }

      const { error } = await supabase.from('kaspi_orders').insert([
        this.orderRecord({
          customerId,
          operationId,
          normalizedPhone,
          pricing,
          cartItems,
          checkout,
          paymentMethod: 'qr',
          qrToken,
        }),
      ]);

      if (error) {
        const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
        if (raced) return paymentResponse(raced);
        throw new Error('Не удалось сохранить заказ: ' + error.message);
      }

      return {
        success: true,
        method: 'qr',
        operationId: operationId,
        qrToken: qrToken,
        amount,
        orderType: checkout.orderType,
        branchId: checkout.branchId,
        scheduledAt: checkout.scheduledAt,
      };
    }

    const { error } = await supabase.from('kaspi_orders').insert([
      this.orderRecord({
        customerId,
        operationId,
        normalizedPhone,
        pricing,
        cartItems,
        checkout,
        paymentMethod: 'invoice',
      }),
    ]);

    if (error) {
      const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
      if (raced?.operation_id === String(operationId)) return paymentResponse(raced);
      try {
        await this.cancelInvoice(operationId);
      } catch (cancelError) {
        console.error('Не удалось отменить несохранённый счёт Kaspi:', cancelError.message);
      }
      if (raced) return paymentResponse(raced);
      throw new Error('Не удалось сохранить заказ: ' + error.message);
    }

    return {
      success: true,
      method: 'invoice',
      operationId: operationId,
      amount,
      orderType: checkout.orderType,
      branchId: checkout.branchId,
      scheduledAt: checkout.scheduledAt,
    };
  }

  orderRecord({
    customerId,
    operationId,
    normalizedPhone,
    pricing,
    cartItems,
    checkout,
    paymentMethod,
    qrToken = null,
  }) {
    return {
      customer_id: customerId,
      operation_id: String(operationId),
      phone: normalizedPhone,
      amount: pricing.total,
      status: 'pending',
      cart_items: cartItems,
      subtotal: pricing.subtotal,
      discount_amount: pricing.discount,
      delivery_fee: pricing.deliveryFee || 0,
      promo_code: pricing.promoCode,
      fulfillment_type: checkout.orderType,
      branch_id: checkout.branchId,
      branch_name: checkout.branch,
      scheduled_at: checkout.scheduledAt,
      pickup_time: checkout.pickupTime,
      delivery_address: checkout.deliveryAddress,
      delivery_latitude: checkout.deliveryAddress?.latitude ?? null,
      delivery_longitude: checkout.deliveryAddress?.longitude ?? null,
      additional_phone: checkout.additionalPhone,
      comment: checkout.comment,
      fulfillment_status: 'pending',
      client_request_id: checkout.requestId,
      payment_method: paymentMethod,
      qr_token: qrToken,
    };
  }

  /**
   * Получение статуса заказа из нашей БД
   */
  async getOrderStatus(operationId, customerId) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .eq('customer_id', String(customerId))
      .maybeSingle();

    if (error) throw new Error('DB Error: ' + error.message);
    if (!data) {
      const error = new Error('Заказ не найден');
      error.statusCode = 404;
      throw error;
    }

    return data;
  }

  async refundPayment(operationId, amount) {
    const cleanOperationId = String(operationId || '').trim();
    const numericAmount = Number(amount);
    if (!/^\d{1,100}$/.test(cleanOperationId)) {
      throw Object.assign(new Error('Некорректный идентификатор операции Kaspi'), {
        statusCode: 409,
        code: 'KASPI_REFUND_INVALID_OPERATION',
      });
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10000000) {
      throw Object.assign(new Error('Некорректная сумма возврата Kaspi'), {
        statusCode: 409,
        code: 'KASPI_REFUND_INVALID_AMOUNT',
      });
    }

    let refundResult;
    try {
      refundResult = await fetchJson(`${KASPI_URL}/api/refund/create`, {
        method: 'POST',
        headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          qrOperationId: cleanOperationId,
          returnAmount: numericAmount,
        }),
      });
    } catch (error) {
      const uncertain = Object.assign(
        new Error(
          'Ответ Kaspi не получен. Проверьте операцию в Kaspi Pay перед повторным возвратом.',
        ),
        {
          statusCode: 502,
          code: 'KASPI_REFUND_UNKNOWN',
          refundUncertain: true,
          cause: error,
        },
      );
      throw uncertain;
    }

    const { response, body } = refundResult;
    const resultCodes = kaspiResultCodes(body);
    if (response.ok && isKaspiSuccess(body)) {
      const data = body?.Data || {};
      return {
        reference:
          String(
            data.ReturnOperationId || data.OperationId || data.Id || data.QrOperationId || '',
          ).slice(0, 160) || null,
        response: body,
      };
    }
    if (
      resultCodes.some((value) => Number(value) !== 0) ||
      (response.status >= 400 && response.status < 500)
    ) {
      throw Object.assign(new Error(kaspiErrorMessage(body, 'Kaspi отклонил возврат.')), {
        statusCode: response.status >= 400 && response.status < 500 ? 409 : 502,
        code: 'KASPI_REFUND_REJECTED',
      });
    }
    throw Object.assign(
      new Error('Ответ Kaspi не подтверждает результат. Проверьте операцию в Kaspi Pay.'),
      {
        statusCode: 502,
        code: 'KASPI_REFUND_UNKNOWN',
        refundUncertain: true,
      },
    );
  }

  async reverseOrderLoyalty(order) {
    if (!order?.customer_id || order?.bonus_reversed_at) return order;
    const { error: reverseError } = await supabase.rpc('reverse_loyalty_order', {
      p_customer_id: order.customer_id,
      p_order_id: `kaspi:${order.operation_id}`,
      p_real_money_paid: eligibleOrderAmount(order),
    });
    if (reverseError) throw new Error('Не удалось сторнировать кэшбэк: ' + reverseError.message);

    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ bonus_reversed_at: new Date().toISOString(), last_error: null })
      .eq('id', order.id)
      .is('bonus_reversed_at', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data || order;
  }

  /**
   * Обновление статуса заказа (вызывается из вебхука)
   */
  async updateOrderStatus(operationId, newStatus) {
    const normalizedStatus = String(newStatus || '');
    const { data: current, error: readError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return null;
    if (!paymentStatusCanTransition(current.status, normalizedStatus)) return current;
    if (current.status === normalizedStatus) return current;

    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
      .eq('operation_id', String(operationId))
      .eq('status', current.status)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Ошибка обновления kaspi_orders:', error);
      throw error;
    }

    if (data) return data;
    const { data: latest, error: latestError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();
    if (latestError) throw latestError;
    return latest;
  }

  async syncRemoteOrder(operationId) {
    const { response, body: result } = await fetchJson(
      `${KASPI_URL}/api/payment/check/${encodeURIComponent(operationId)}`,
      {
        headers: this.internalHeaders(),
      },
    );
    if (!response.ok) return null;
    const status = result?.kaspiStatus;
    if (!result?.success || !status) return null;

    if (status === 'Processed') {
      await this.updateOrderStatus(operationId, 'paid');
      await this.recordPaidOrder(operationId);
      return 'paid';
    }
    if (
      [
        'RemotePaymentCanceled',
        'RemotePaymentRejected',
        'CancelledByUser',
        'ProcessingFailed',
        'Rejected',
        'Error',
      ].includes(status)
    ) {
      await this.updateOrderStatus(operationId, 'failed');
      return 'failed';
    }
    if (['Expired', 'QrTokenDiscarded'].includes(status)) {
      await this.updateOrderStatus(operationId, 'expired');
      return 'expired';
    }
    return 'pending';
  }

  async reconcileOrders() {
    const staleRefundCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { error: staleRefundError } = await supabase
      .from('kaspi_orders')
      .update({
        refund_status: 'unknown',
        refund_error: 'Сервер был перезапущен во время возврата. Проверьте операцию в Kaspi Pay.',
        last_error: 'Результат возврата требует проверки в Kaspi Pay',
      })
      .eq('refund_status', 'processing')
      .lt('refund_requested_at', staleRefundCutoff);
    if (staleRefundError) throw staleRefundError;

    const pendingWindowMs = pendingReconciliationWindowMs();
    const pendingCutoff = new Date(Date.now() - pendingWindowMs).toISOString();
    const pendingWindowHours = Math.max(1, Math.round(pendingWindowMs / (60 * 60 * 1000)));
    const stalePendingMessage = `Автоматическая проверка остановлена спустя ${pendingWindowHours} ч. Проверьте платеж вручную в Kaspi Pay.`;
    const { error: stalePendingError } = await supabase
      .from('kaspi_orders')
      .update({ last_error: stalePendingMessage })
      .eq('status', 'pending')
      .lt('created_at', pendingCutoff)
      .is('last_error', null);
    if (stalePendingError) throw stalePendingError;

    const [
      { data: settledOrders, error: settledError },
      { data: pendingOrders, error: pendingError },
    ] = await Promise.all([
      supabase
        .from('kaspi_orders')
        .select('*')
        .in('status', ['paid', 'refunded'])
        .order('created_at', { ascending: true })
        .limit(50),
      supabase
        .from('kaspi_orders')
        .select('*')
        .eq('status', 'pending')
        .gte('created_at', pendingCutoff)
        .order('created_at', { ascending: true })
        .limit(50),
    ]);
    if (settledError) throw settledError;
    if (pendingError) throw pendingError;

    const orders = [...(settledOrders || []), ...(pendingOrders || [])];

    for (const order of orders || []) {
      try {
        if (order.status === 'refunded') {
          await this.reverseOrderLoyalty(order);
        } else if (
          order.status === 'paid' &&
          (order.fulfillment_status === 'pending' || !order.bonus_awarded_at)
        ) {
          await this.recordPaidOrder(order.operation_id);
        } else if (order.status === 'pending') {
          await this.syncRemoteOrder(order.operation_id);
        }
      } catch (reconcileError) {
        console.error(`Не удалось сверить заказ ${order.operation_id}:`, reconcileError.message);
      }
    }
    return (orders || []).length;
  }

  async awardOrderBonus(order) {
    if (!order?.customer_id || order.bonus_awarded_at) return order;
    const { getCustomerById, applyLoyaltyTransaction } = require('./customer.service');
    const { getSettings } = require('./settings.service');
    const { getActiveLoyaltyTiers } = require('./tier.service');
    const { getTierInfo } = require('../utils/tier.util');
    const [customer, settings] = await Promise.all([
      getCustomerById(order.customer_id),
      getSettings(),
    ]);
    if (!customer) throw new Error('Клиент оплаченного заказа не найден');
    const tiers = await getActiveLoyaltyTiers(settings);
    const tier = getTierInfo(customer.total_spent, tiers, settings);
    const eligibleAmount = eligibleOrderAmount(order);
    const earnedBonus = Math.max(0, Math.round(eligibleAmount * (Number(tier.percent || 0) / 100)));
    await applyLoyaltyTransaction({
      customerId: order.customer_id,
      orderId: `kaspi:${order.operation_id}`,
      discountAmount: 0,
      earnedBonus,
      orderTotal: eligibleAmount,
      realMoneyPaid: eligibleAmount,
      activationDelayDays: Number(settings.bonus_activation?.delay_days || 0),
      items: order.cart_items,
    });
    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ earned_bonus: earnedBonus, bonus_awarded_at: new Date().toISOString() })
      .eq('id', order.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async recordPaidOrder(operationId) {
    const { data: order, error: readError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();
    if (readError) throw readError;
    if (!order || order.status !== 'paid') return order;
    let recorded = order;
    if (order.fulfillment_status === 'pending') {
      const { data, error } = await supabase
        .from('kaspi_orders')
        .update({
          fulfillment_status: 'new',
          last_error: null,
        })
        .eq('id', order.id)
        .eq('fulfillment_status', 'pending')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (data) recorded = data;
    }
    return recorded.bonus_awarded_at ? recorded : this.awardOrderBonus(recorded);
  }
}

module.exports = new KaspiService();
module.exports.KaspiService = KaspiService;
module.exports.eligibleOrderAmount = eligibleOrderAmount;
module.exports.isKaspiSuccess = isKaspiSuccess;
module.exports.paymentStatusCanTransition = paymentStatusCanTransition;
module.exports.pendingReconciliationWindowMs = pendingReconciliationWindowMs;
