const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');
const {
  commitOrReacquireOrderReservations,
  releaseOrderReservations,
} = require('./inventory.service');
const realtime = require('./realtime.service');
const { recordSystemEvent } = require('./analytics-event.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { buildEtaForecast, etaDatabaseFields, forecastOrderEta } = require('./eta.service');
const { effectiveFulfillmentType, isDeliveryFulfillment } = require('../utils/fulfillment.util');

const KASPI_URL =
  process.env.KASPI_MICROSERVICE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/kaspi-pos`;
const DEFAULT_PENDING_RECONCILIATION_MS = 24 * 60 * 60 * 1000;
const MIN_PENDING_RECONCILIATION_MS = 15 * 60 * 1000;
const RECONCILIATION_BATCH_SIZE = 50;
const LATE_PAYMENT_CANCELLATION_REASONS = new Set(['Срок оплаты истёк', 'Оплата не прошла']);
const LATE_PAYMENT_AUTO_REFUND_PREFIX = 'Автоматический возврат поздней оплаты: ';

const isLatePaymentAutoRefund = (order) =>
  String(order?.cancellation_reason || '').startsWith(LATE_PAYMENT_AUTO_REFUND_PREFIX);

const reconciliationTimestamp = (order) => {
  const timestamp = Date.parse(String(order?.updated_at || order?.created_at || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const mergeReconciliationOrders = (...groups) => {
  const unique = new Map();
  for (const order of groups.flat()) {
    if (!order) continue;
    const key = String(order.id || order.operation_id || '');
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing || reconciliationTimestamp(order) > reconciliationTimestamp(existing)) {
      unique.set(key, order);
    }
  }
  return [...unique.values()].sort(
    (left, right) => reconciliationTimestamp(right) - reconciliationTimestamp(left),
  );
};

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

const isKaspiReauthRequired = (response, body) =>
  ['KASPI_REAUTH_REQUIRED', 'KASPI_SESSION_REPLACED'].includes(String(body?.code || '')) ||
  response?.status === 401;

const kaspiReauthError = () =>
  Object.assign(
    new Error('Kaspi Pay временно недоступен. Администратору необходимо восстановить подключение.'),
    { statusCode: 503, code: 'KASPI_REAUTH_REQUIRED', retryable: false },
  );

async function dispatchPaidDeliveryOrder(order, { yandexDelivery, dispatchService } = {}) {
  if (!order || !isDeliveryFulfillment(order)) {
    return { skipped: true, reason: 'not_delivery' };
  }
  if (
    order.courier_id ||
    !['', 'unassigned'].includes(String(order.delivery_status || 'unassigned')) ||
    ['completed', 'cancelled'].includes(String(order.fulfillment_status || ''))
  ) {
    return { skipped: true, reason: 'already_dispatched' };
  }

  const externalDelivery = yandexDelivery || require('./yandex-delivery.service');
  const internalDispatch = dispatchService || require('./dispatch.service');
  const yandexStatus = externalDelivery.getConfigurationStatus();
  if (yandexStatus.configured && yandexStatus.autoDispatch) {
    return {
      skipped: false,
      provider: 'yandex',
      result: await externalDelivery.dispatchOrder(order.id),
    };
  }
  return {
    skipped: false,
    provider: 'internal',
    result: await internalDispatch.autoAssignOrder(order.id),
  };
}

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
  preorderFulfillmentType: order.preorder_fulfillment_type || null,
  effectiveFulfillmentType: effectiveFulfillmentType(order),
  branchId: order.branch_id == null ? null : String(order.branch_id),
  scheduledAt: order.scheduled_at || null,
  orderId: order.id == null ? undefined : String(order.id),
});

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const paymentCreationFingerprint = (payload) =>
  crypto.createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');

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

  async availability() {
    try {
      const { response, body } = await fetchJson(`${KASPI_URL}/api/payment/availability`, {
        headers: this.internalHeaders(),
      });
      return response.ok && body?.available === true;
    } catch (error) {
      console.error('Kaspi availability check failed:', error.message);
      return false;
    }
  }

  async cancelInvoice(operationId) {
    const { response, body } = await fetchJson(`${KASPI_URL}/api/invoice/cancel`, {
      method: 'POST',
      headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ operationId: String(operationId) }),
    });
    if (isKaspiReauthRequired(response, body)) throw kaspiReauthError();
    if (!response.ok || (kaspiResultCodes(body).length > 0 && !isKaspiSuccess(body))) {
      throw new Error(kaspiErrorMessage(body, `Kaspi returned ${response.status}`));
    }
  }

  async existingRequest(customerId, requestId) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select(
        'id,operation_id,payment_method,qr_token,amount,status,fulfillment_type,preorder_fulfillment_type,branch_id,scheduled_at',
      )
      .eq('customer_id', customerId)
      .eq('client_request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async claimPaymentCreation(customerId, requestId, amount, fingerprint, orderPayload) {
    const { data, error } = await supabase.rpc('claim_payment_creation', {
      p_provider: 'kaspi',
      p_customer_id: customerId,
      p_client_request_id: requestId,
      p_amount: amount,
      p_request_fingerprint: fingerprint,
      p_order_payload: orderPayload,
    });
    if (error) throw error;
    const claim = Array.isArray(data) ? data[0] : data;
    if (!claim?.id || !claim?.status) throw new Error('Некорректный ответ блокировки оплаты');
    return claim;
  }

  async updatePaymentCreationClaim(claimId, updates) {
    const { error } = await supabase
      .from('payment_creation_claims')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', claimId)
      .eq('provider', 'kaspi');
    if (error) throw error;
  }

  creationConflict(claim) {
    const status = String(claim?.status || '');
    if (status === 'fingerprint_mismatch') {
      return Object.assign(
        new Error('Этот идентификатор оформления уже использован другим заказом'),
        {
          statusCode: 409,
          code: 'PAYMENT_REQUEST_ALREADY_USED',
        },
      );
    }
    if (status === 'creating') {
      return Object.assign(new Error('Счёт уже создаётся. Подождите и проверьте заказ.'), {
        statusCode: 409,
        code: 'KASPI_CREATE_IN_PROGRESS',
        retryable: true,
      });
    }
    if (status === 'customer_active_unknown') {
      return Object.assign(
        new Error(
          'Предыдущая оплата ещё проверяется. Новый счёт не создан во избежание двойной оплаты.',
        ),
        {
          statusCode: 409,
          code: 'KASPI_CUSTOMER_PAYMENT_UNRESOLVED',
          retryable: true,
        },
      );
    }
    return Object.assign(
      new Error(
        'Состояние создания счёта проверяется. Новый счёт не создан во избежание двойной оплаты.',
      ),
      {
        statusCode: 409,
        code: 'KASPI_CREATE_RECOVERY_REQUIRED',
        retryable: true,
      },
    );
  }

  async recoverPaymentCreationClaims({ limit = 25 } = {}) {
    const { data, error } = await supabase
      .from('payment_creation_claims')
      .select('*')
      .eq('provider', 'kaspi')
      .in('status', ['provider_created', 'unknown'])
      .not('provider_operation_id', 'is', null)
      .is('order_id', null)
      .order('created_at', { ascending: true })
      .limit(Math.min(100, Math.max(1, Number(limit) || 25)));
    if (error) throw error;
    let recovered = 0;
    for (const claim of data || []) {
      try {
        let order = await this.existingRequest(claim.customer_id, claim.client_request_id);
        if (!order) {
          const record = {
            ...(claim.order_payload || {}),
            operation_id: String(claim.provider_operation_id),
          };
          const { data: inserted, error: insertError } = await supabase
            .from('kaspi_orders')
            .insert([record])
            .select('*')
            .single();
          if (insertError) {
            order = await this.existingRequest(claim.customer_id, claim.client_request_id);
            if (!order) throw insertError;
          } else {
            order = inserted;
          }
        }
        await this.updatePaymentCreationClaim(claim.id, {
          status: 'completed',
          order_id: order.id,
          completed_at: new Date().toISOString(),
          last_error: null,
        });
        const { attachOrderReservations } = require('./inventory.service');
        const { attachPromotionReservation } = require('./commerce-marketing.service');
        await attachOrderReservations(claim.customer_id, claim.client_request_id, order.id).catch(
          () => undefined,
        );
        if (order.promo_code) {
          await attachPromotionReservation(
            claim.customer_id,
            claim.client_request_id,
            order.id,
          ).catch(() => undefined);
        }
        recovered += 1;
      } catch (claimError) {
        await this.updatePaymentCreationClaim(claim.id, {
          last_error: String(claimError.message || 'recovery failed').slice(0, 1000),
        }).catch(() => undefined);
      }
    }
    return recovered;
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
    if (existing) {
      if (existing.payment_method === 'forte_card') {
        throw Object.assign(new Error('Это оформление уже связано с оплатой ForteBank'), {
          statusCode: 409,
          code: 'PAYMENT_REQUEST_ALREADY_USED',
        });
      }
      return paymentResponse(existing);
    }

    const eta = await forecastOrderEta({
      branchId: checkout.branchId,
      orderType: checkout.effectiveFulfillmentType,
      scheduledAt: checkout.scheduledAt,
      preparationMinutes: pricing.preparationMinutes,
      deliveryAddress: checkout.deliveryAddress,
      deliveryZone: checkout.deliveryZone,
    });

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

    const creationFingerprint = paymentCreationFingerprint({
      customerId,
      requestId: checkout.requestId,
      phone: normalizedPhone,
      amount,
      cartItems,
      branchId: checkout.branchId,
      orderType: checkout.orderType,
      preorderFulfillmentType: checkout.preorderFulfillmentType,
      scheduledAt: checkout.scheduledAt,
      deliveryAddress: checkout.deliveryAddress,
      promoCode: pricing.promoCode || null,
    });
    const draftOrderRecord = this.orderRecord({
      customerId,
      operationId: null,
      normalizedPhone,
      pricing,
      cartItems,
      checkout,
      paymentMethod: 'invoice',
      eta,
    });
    let creationClaim;
    try {
      creationClaim = await this.claimPaymentCreation(
        customerId,
        checkout.requestId,
        amount,
        creationFingerprint,
        draftOrderRecord,
      );
    } catch (error) {
      throw new Error('Не удалось заблокировать повторное создание счёта: ' + error.message, {
        cause: error,
      });
    }
    if (creationClaim.status === 'completed') {
      const completedOrder = await this.existingRequest(customerId, checkout.requestId);
      if (completedOrder) return paymentResponse(completedOrder);
    }
    if (creationClaim.status !== 'claimed') throw this.creationConflict(creationClaim);

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
      await this.updatePaymentCreationClaim(creationClaim.id, {
        status: 'unknown',
        last_error: String(error.message || 'Kaspi response missing').slice(0, 1000),
      }).catch(() => undefined);
      throw Object.assign(
        new Error('Ответ Kaspi не получен. Проверьте счета в Kaspi Pay перед повтором.'),
        { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN', cause: error },
      );
    }

    const { response, body: data } = invoiceResult;
    if (isKaspiReauthRequired(response, data)) {
      await this.updatePaymentCreationClaim(creationClaim.id, {
        status: 'failed_safe',
        last_error: 'Kaspi session requires authentication',
      }).catch(() => undefined);
      throw kaspiReauthError();
    }
    if (!response.ok) {
      await this.updatePaymentCreationClaim(creationClaim.id, {
        status: 'unknown',
        last_error: kaspiErrorMessage(data, `Kaspi returned ${response.status}`).slice(0, 1000),
      }).catch(() => undefined);
      throw Object.assign(
        new Error(kaspiErrorMessage(data, 'Kaspi не подтвердил создание счёта.')),
        { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN' },
      );
    }

    let operationId = data?.Data?.Id || data?.Data?.QrOperationId;
    const invoiceCodes = kaspiResultCodes(data);
    if (operationId && invoiceCodes.some((value) => Number(value) !== 0)) {
      await this.updatePaymentCreationClaim(creationClaim.id, {
        status: 'unknown',
        provider_operation_id: String(operationId),
        last_error: 'Kaspi returned an operation ID with a rejection code',
      }).catch(() => undefined);
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
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'unknown',
          last_error: 'Kaspi response did not contain an operation ID or an explicit rejection',
        }).catch(() => undefined);
        throw Object.assign(
          new Error('Kaspi не вернул номер счёта. Проверьте Kaspi Pay перед повтором.'),
          { statusCode: 502, code: 'KASPI_CREATE_UNKNOWN' },
        );
      }
      if (process.env.KASPI_QR_FALLBACK_ENABLED === 'false') {
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'failed_safe',
          last_error: kaspiErrorMessage(data, 'Kaspi rejected invoice').slice(0, 1000),
        }).catch(() => undefined);
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
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'unknown',
          last_error: String(error.message || 'Kaspi QR response missing').slice(0, 1000),
        }).catch(() => undefined);
        throw Object.assign(new Error('Ответ Kaspi QR не получен. Повторите попытку позже.'), {
          statusCode: 502,
          code: 'KASPI_QR_CREATE_UNKNOWN',
          cause: error,
        });
      }

      if (!qrResult.response.ok) {
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'unknown',
          last_error: kaspiErrorMessage(
            qrResult.body,
            `Kaspi QR returned ${qrResult.response.status}`,
          ).slice(0, 1000),
        }).catch(() => undefined);
        throw Object.assign(
          new Error(kaspiErrorMessage(qrResult.body, 'Kaspi QR временно недоступен.')),
          { statusCode: 502, code: 'KASPI_QR_CREATE_FAILED' },
        );
      }

      const qrData = qrResult.body;
      operationId = qrData?.Data?.Id || qrData?.Data?.QrOperationId;
      const qrToken = qrData?.Data?.QrToken;

      if (!qrData.Data || !operationId || !qrToken || !isKaspiSuccess(qrData)) {
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'unknown',
          last_error: 'Kaspi QR response did not contain a confirmed operation',
        }).catch(() => undefined);
        throw Object.assign(new Error('Не удалось получить QR-код от Kaspi'), {
          statusCode: 502,
          code: 'KASPI_QR_CREATE_FAILED',
        });
      }

      const qrOrderRecord = this.orderRecord({
        customerId,
        operationId,
        normalizedPhone,
        pricing,
        cartItems,
        checkout,
        paymentMethod: 'qr',
        qrToken,
        eta,
      });
      try {
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'provider_created',
          provider_operation_id: String(operationId),
          order_payload: qrOrderRecord,
          last_error: null,
        });
      } catch (claimError) {
        throw Object.assign(
          new Error(
            'QR создан, но его состояние не сохранено. Проверьте Kaspi Pay перед повтором.',
          ),
          {
            statusCode: 502,
            code: 'KASPI_QR_CREATE_UNKNOWN',
            cause: claimError,
          },
        );
      }
      const { data: savedOrder, error } = await supabase
        .from('kaspi_orders')
        .insert([qrOrderRecord])
        .select('id')
        .single();

      if (error) {
        const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
        if (raced && raced.payment_method !== 'forte_card') {
          await this.updatePaymentCreationClaim(creationClaim.id, {
            status: 'completed',
            order_id: raced.id,
            completed_at: new Date().toISOString(),
          }).catch(() => undefined);
          return paymentResponse(raced);
        }
        let providerCancelled = false;
        try {
          await this.cancelInvoice(operationId);
          providerCancelled = true;
          await this.updatePaymentCreationClaim(creationClaim.id, {
            status: 'failed_safe',
            last_error: 'Provider QR was cancelled after local save failed',
          });
        } catch (cancelError) {
          console.error('Не удалось отменить несохранённый QR Kaspi:', cancelError.message);
        }
        if (!providerCancelled) {
          throw Object.assign(
            new Error('QR создан, но заказ восстанавливается. Не создавайте повторную оплату.'),
            {
              statusCode: 503,
              code: 'KASPI_CREATE_RECOVERY_REQUIRED',
              cause: error,
            },
          );
        }
        if (raced) {
          throw Object.assign(new Error('Это оформление уже связано с оплатой ForteBank'), {
            statusCode: 409,
            code: 'PAYMENT_REQUEST_ALREADY_USED',
          });
        }
        throw new Error('Не удалось сохранить заказ: ' + error.message);
      }
      await this.updatePaymentCreationClaim(creationClaim.id, {
        status: 'completed',
        order_id: savedOrder.id,
        completed_at: new Date().toISOString(),
        last_error: null,
      }).catch((claimError) =>
        console.error('Не удалось завершить блокировку QR Kaspi:', claimError.message),
      );

      await recordSystemEvent(customerId, {
        type: 'payment_created',
        orderId: savedOrder.id,
        branchId: checkout.branchId,
        properties: { paymentMethod: 'qr', amount },
      }).catch((eventError) =>
        console.error('Не удалось записать аналитику заказа:', eventError.message),
      );

      return {
        success: true,
        method: 'qr',
        operationId: operationId,
        qrToken: qrToken,
        amount,
        orderType: checkout.orderType,
        preorderFulfillmentType: checkout.preorderFulfillmentType,
        effectiveFulfillmentType: checkout.effectiveFulfillmentType,
        branchId: checkout.branchId,
        scheduledAt: checkout.scheduledAt,
        orderId: savedOrder.id,
      };
    }

    const invoiceOrderRecord = this.orderRecord({
      customerId,
      operationId,
      normalizedPhone,
      pricing,
      cartItems,
      checkout,
      paymentMethod: 'invoice',
      eta,
    });
    try {
      await this.updatePaymentCreationClaim(creationClaim.id, {
        status: 'provider_created',
        provider_operation_id: String(operationId),
        order_payload: invoiceOrderRecord,
        last_error: null,
      });
    } catch (claimError) {
      throw Object.assign(
        new Error(
          'Счёт создан, но его состояние не сохранено. Проверьте Kaspi Pay перед повтором.',
        ),
        {
          statusCode: 502,
          code: 'KASPI_CREATE_UNKNOWN',
          cause: claimError,
        },
      );
    }
    const { data: savedOrder, error } = await supabase
      .from('kaspi_orders')
      .insert([invoiceOrderRecord])
      .select('id')
      .single();

    if (error) {
      const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
      if (raced?.operation_id === String(operationId) && raced?.payment_method !== 'forte_card') {
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'completed',
          order_id: raced.id,
          completed_at: new Date().toISOString(),
        }).catch(() => undefined);
        return paymentResponse(raced);
      }
      let providerCancelled = false;
      try {
        await this.cancelInvoice(operationId);
        providerCancelled = true;
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'failed_safe',
          last_error: 'Provider invoice was cancelled after local save failed',
        });
      } catch (cancelError) {
        console.error('Не удалось отменить несохранённый счёт Kaspi:', cancelError.message);
      }
      if (!providerCancelled) {
        throw Object.assign(
          new Error('Счёт создан, но заказ восстанавливается. Не создавайте повторную оплату.'),
          {
            statusCode: 503,
            code: 'KASPI_CREATE_RECOVERY_REQUIRED',
            cause: error,
          },
        );
      }
      if (raced && raced.payment_method !== 'forte_card') {
        await this.updatePaymentCreationClaim(creationClaim.id, {
          status: 'completed',
          order_id: raced.id,
          completed_at: new Date().toISOString(),
        }).catch(() => undefined);
        return paymentResponse(raced);
      }
      if (raced) {
        throw Object.assign(new Error('Это оформление уже связано с оплатой ForteBank'), {
          statusCode: 409,
          code: 'PAYMENT_REQUEST_ALREADY_USED',
        });
      }
      throw new Error('Не удалось сохранить заказ: ' + error.message);
    }
    await this.updatePaymentCreationClaim(creationClaim.id, {
      status: 'completed',
      order_id: savedOrder.id,
      completed_at: new Date().toISOString(),
      last_error: null,
    }).catch((claimError) =>
      console.error('Не удалось завершить блокировку счёта Kaspi:', claimError.message),
    );

    await recordSystemEvent(customerId, {
      type: 'payment_created',
      orderId: savedOrder.id,
      branchId: checkout.branchId,
      properties: { paymentMethod: 'invoice', amount },
    }).catch((eventError) =>
      console.error('Не удалось записать аналитику заказа:', eventError.message),
    );

    return {
      success: true,
      method: 'invoice',
      operationId: operationId,
      amount,
      orderType: checkout.orderType,
      preorderFulfillmentType: checkout.preorderFulfillmentType,
      effectiveFulfillmentType: checkout.effectiveFulfillmentType,
      branchId: checkout.branchId,
      scheduledAt: checkout.scheduledAt,
      orderId: savedOrder.id,
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
    eta = null,
  }) {
    const preparationMinutes = Math.min(240, Math.max(1, Number(pricing.preparationMinutes) || 15));
    const effectiveType =
      checkout.effectiveFulfillmentType ||
      effectiveFulfillmentType({
        fulfillment_type: checkout.orderType,
        preorder_fulfillment_type: checkout.preorderFulfillmentType,
      });
    const resolvedEta =
      eta ||
      buildEtaForecast({
        orderType: effectiveType,
        scheduledAt: checkout.scheduledAt,
        preparationMinutes,
        directDistanceKm: checkout.deliveryZone?.distanceKm,
      });
    return {
      customer_id: customerId,
      operation_id: operationId == null ? null : String(operationId),
      phone: normalizedPhone,
      amount: pricing.total,
      status: 'pending',
      cart_items: cartItems,
      subtotal: pricing.subtotal,
      discount_amount: pricing.discount,
      delivery_fee: pricing.deliveryFee || 0,
      promo_code: pricing.promoCode,
      fulfillment_type: checkout.orderType,
      preorder_fulfillment_type:
        checkout.orderType === 'preorder' ? checkout.preorderFulfillmentType : null,
      branch_id: checkout.branchId,
      branch_name: checkout.branch,
      scheduled_at: checkout.scheduledAt,
      pickup_time: checkout.pickupTime,
      delivery_address: checkout.deliveryAddress,
      delivery_latitude: checkout.deliveryAddress?.latitude ?? null,
      delivery_longitude: checkout.deliveryAddress?.longitude ?? null,
      additional_phone: checkout.additionalPhone,
      comment: checkout.comment,
      substitution_preference: checkout.substitutionPreference,
      fulfillment_status: 'pending',
      preparation_minutes: preparationMinutes,
      ...etaDatabaseFields(resolvedEta, effectiveType),
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
    if (isKaspiReauthRequired(response, body)) throw kaspiReauthError();
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

  async reconcileRefund(order, refund, { knownSucceededAmount = 0 } = {}) {
    const cleanOperationId = String(order?.operation_id || '').trim();
    if (!/^\d{1,100}$/.test(cleanOperationId)) {
      throw Object.assign(new Error('Некорректный идентификатор операции Kaspi'), {
        statusCode: 409,
        code: 'KASPI_REFUND_INVALID_OPERATION',
      });
    }

    const { response, body } = await fetchJson(`${KASPI_URL}/api/history/details`, {
      method: 'POST',
      headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: cleanOperationId, operationMethod: 0 }),
    });
    if (isKaspiReauthRequired(response, body)) throw kaspiReauthError();
    if (!response.ok) {
      throw Object.assign(new Error(kaspiErrorMessage(body, 'Kaspi не вернул историю возврата')), {
        statusCode: response.status >= 400 && response.status < 500 ? 409 : 502,
        code: 'KASPI_REFUND_RECONCILIATION_FAILED',
        retryable: response.status >= 500,
      });
    }

    const returns = Array.isArray(body?.Data?.Returns) ? body.Data.Returns : [];
    const cleanReference = String(
      refund?.provider_reference || refund?.kaspi_reference || '',
    ).trim();
    const normalized = returns.map((entry) => {
      const reference = String(
        entry?.ReturnOperationId || entry?.OperationId || entry?.Id || entry?.QrOperationId || '',
      ).trim();
      const amount = Number(
        String(entry?.Amount ?? entry?.ReturnAmount ?? 0)
          .replace(/\s/g, '')
          .replace(',', '.'),
      );
      const status = String(
        entry?.StatusDescription || entry?.Status || entry?.State || entry?.Result || '',
      )
        .trim()
        .toLowerCase();
      const declined = /(fail|declin|reject|cancel|error|отклон|отмен|ошиб)/i.test(status);
      return { reference, amount, status, declined };
    });

    if (cleanReference) {
      const exact = normalized.find((entry) => entry.reference === cleanReference);
      if (exact?.declined) {
        return {
          status: 'declined',
          reference: exact.reference,
          message: exact.status || 'Kaspi отклонил возврат',
        };
      }
      if (exact) return { status: 'confirmed', reference: exact.reference };
    }

    const confirmedReturns = normalized.filter(
      (entry) => !entry.declined && Number.isFinite(entry.amount) && entry.amount > 0,
    );
    const providerReturnedAmount = confirmedReturns.reduce(
      (total, entry) => total + entry.amount,
      0,
    );
    const expectedReturnedAmount = Number(knownSucceededAmount || 0) + Number(refund?.amount || 0);
    if (
      expectedReturnedAmount > 0 &&
      providerReturnedAmount + Number.EPSILON >= expectedReturnedAmount
    ) {
      const matching = [...confirmedReturns]
        .reverse()
        .find((entry) => entry.amount === Number(refund?.amount || 0));
      return {
        status: 'confirmed',
        reference: matching?.reference || cleanReference || null,
      };
    }

    return { status: 'pending', reference: cleanReference || null };
  }

  async reverseOrderLoyalty(order) {
    if (!order?.customer_id || order?.bonus_reversed_at) return order;
    const { error: reverseError } = await supabase.rpc('reverse_loyalty_order', {
      p_customer_id: order.customer_id,
      p_order_id: `kaspi:${order.operation_id}`,
      p_real_money_paid: eligibleOrderAmount(order),
    });
    if (reverseError) throw new Error('Не удалось сторнировать кэшбэк: ' + reverseError.message);
    queueCustomerLoyaltySync(order.customer_id);

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
  async updateOrderStatus(operationId, newStatus, analytics = {}) {
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

    if (data) {
      if (data.status === 'paid') {
        // recordPaidOrder performs the authoritative commit/reacquire before
        // any bonus, receipt or fulfillment transition.
      } else if (['failed', 'expired'].includes(data.status)) {
        await releaseOrderReservations(data.id).catch((error) =>
          console.error('Не удалось освободить резерв заказа:', error.message),
        );
        const { releasePromotionReservation } = require('./commerce-marketing.service');
        await releasePromotionReservation({ orderId: data.id }).catch((error) =>
          console.error('Не удалось освободить промокод заказа:', error.message),
        );
        await recordSystemEvent(data.customer_id, {
          type:
            analytics.type || (data.status === 'expired' ? 'payment_cancelled' : 'payment_failed'),
          orderId: data.id,
          branchId: data.branch_id,
          properties: {
            paymentMethod: data.payment_method || 'kaspi',
            providerStatus: String(analytics.providerStatus || data.status).slice(0, 120),
          },
        }).catch((eventError) =>
          console.error('Не удалось записать аналитику неуспешной оплаты:', eventError.message),
        );
      }
      realtime.publish(
        'order.updated',
        { orderId: data.id, paymentStatus: data.status, orderStatus: data.fulfillment_status },
        { customerId: data.customer_id, includeAdmins: true, branchId: data.branch_id },
      );
      return data;
    }
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
    if (isKaspiReauthRequired(response, result)) throw kaspiReauthError();
    if (!response.ok) return null;
    const status = result?.kaspiStatus;
    if (!result?.success || !status) return null;

    if (status === 'Processed') {
      await this.updateOrderStatus(operationId, 'paid');
      await this.recordPaidOrder(operationId);
      return 'paid';
    }
    if (['RemotePaymentCanceled', 'CancelledByUser'].includes(status)) {
      await this.updateOrderStatus(operationId, 'failed', {
        type: 'payment_cancelled',
        providerStatus: status,
      });
      return 'failed';
    }
    if (['RemotePaymentRejected', 'ProcessingFailed', 'Rejected', 'Error'].includes(status)) {
      await this.updateOrderStatus(operationId, 'failed', {
        type: 'payment_failed',
        providerStatus: status,
      });
      return 'failed';
    }
    if (['Expired', 'QrTokenDiscarded'].includes(status)) {
      await this.updateOrderStatus(operationId, 'expired', {
        type: 'payment_cancelled',
        providerStatus: status,
      });
      return 'expired';
    }
    return 'pending';
  }

  async reconcileOrders({ syncKaspiPending = process.env.KASPI_POS_ENABLED === 'true' } = {}) {
    const pendingWindowMs = pendingReconciliationWindowMs();
    const pendingCutoff = new Date(Date.now() - pendingWindowMs).toISOString();
    if (syncKaspiPending) {
      const staleRefundCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { error: staleRefundError } = await supabase
        .from('kaspi_orders')
        .update({
          refund_status: 'unknown',
          refund_error: 'Сервер был перезапущен во время возврата. Проверьте операцию в Kaspi Pay.',
          last_error: 'Результат возврата требует проверки в Kaspi Pay',
        })
        .eq('refund_status', 'processing')
        .or('payment_method.is.null,payment_method.in.(invoice,qr)')
        .lt('refund_requested_at', staleRefundCutoff);
      if (staleRefundError) throw staleRefundError;

      const pendingWindowHours = Math.max(1, Math.round(pendingWindowMs / (60 * 60 * 1000)));
      const stalePendingMessage = `Автоматическая проверка остановлена спустя ${pendingWindowHours} ч. Проверьте платеж вручную в Kaspi Pay.`;
      const { error: stalePendingError } = await supabase
        .from('kaspi_orders')
        .update({ last_error: stalePendingMessage })
        .eq('status', 'pending')
        .or('payment_method.is.null,payment_method.in.(invoice,qr)')
        .lt('created_at', pendingCutoff)
        .is('last_error', null);
      if (stalePendingError) throw stalePendingError;
      await this.recoverPaymentCreationClaims();
    }

    const [
      { data: paidPendingOrders, error: paidPendingError },
      { data: missingBonusOrders, error: missingBonusError },
      { data: failedAutoRefundOrders, error: failedAutoRefundError },
      { data: missingReversalOrders, error: missingReversalError },
      { data: pendingOrders, error: pendingError },
      { data: missingReceiptOrders, error: missingReceiptError },
    ] = await Promise.all([
      supabase
        .from('kaspi_orders')
        .select('*')
        .eq('status', 'paid')
        .eq('fulfillment_status', 'pending')
        .order('updated_at', { ascending: false })
        .limit(RECONCILIATION_BATCH_SIZE),
      supabase
        .from('kaspi_orders')
        .select('*')
        .eq('status', 'paid')
        .is('bonus_awarded_at', null)
        .or('fulfillment_status.is.null,fulfillment_status.neq.cancelled')
        .order('updated_at', { ascending: false })
        .limit(RECONCILIATION_BATCH_SIZE),
      supabase
        .from('kaspi_orders')
        .select('*')
        .eq('status', 'paid')
        .eq('refund_status', 'failed')
        .like('cancellation_reason', `${LATE_PAYMENT_AUTO_REFUND_PREFIX}%`)
        .order('updated_at', { ascending: false })
        .limit(RECONCILIATION_BATCH_SIZE),
      supabase
        .from('kaspi_orders')
        .select('*')
        .eq('status', 'refunded')
        .is('bonus_reversed_at', null)
        .order('updated_at', { ascending: false })
        .limit(RECONCILIATION_BATCH_SIZE),
      syncKaspiPending
        ? supabase
            .from('kaspi_orders')
            .select('*')
            .eq('status', 'pending')
            .or('payment_method.is.null,payment_method.in.(invoice,qr)')
            .gte('created_at', pendingCutoff)
            .order('created_at', { ascending: false })
            .limit(RECONCILIATION_BATCH_SIZE)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('kaspi_orders')
        .select('*')
        .in('status', ['paid', 'refunded'])
        .is('receipt_created_at', null)
        .order('updated_at', { ascending: false })
        .limit(RECONCILIATION_BATCH_SIZE),
    ]);
    if (paidPendingError) throw paidPendingError;
    if (missingBonusError) throw missingBonusError;
    if (failedAutoRefundError) throw failedAutoRefundError;
    if (missingReversalError) throw missingReversalError;
    if (pendingError) throw pendingError;
    if (missingReceiptError) throw missingReceiptError;

    const orders = mergeReconciliationOrders(
      paidPendingOrders || [],
      missingBonusOrders || [],
      failedAutoRefundOrders || [],
      missingReversalOrders || [],
      pendingOrders || [],
    );

    for (const order of orders) {
      try {
        if (order.status === 'refunded') {
          await this.reverseOrderLoyalty(order);
        } else if (
          order.status === 'paid' &&
          (order.fulfillment_status === 'pending' ||
            !order.bonus_awarded_at ||
            (order.refund_status === 'failed' && isLatePaymentAutoRefund(order)))
        ) {
          await this.recordPaidOrder(order.operation_id);
        } else if (order.status === 'pending') {
          await this.syncRemoteOrder(order.operation_id);
        }
      } catch (reconcileError) {
        console.error(`Не удалось сверить заказ ${order.operation_id}:`, reconcileError.message);
      }
    }
    const { ensurePaymentReceipt } = require('./payment-receipt.service');
    for (const order of missingReceiptOrders || []) {
      try {
        await ensurePaymentReceipt(order);
      } catch (receiptError) {
        console.error(
          `Не удалось восстановить чек заказа ${order.order_number}:`,
          receiptError.message,
        );
      }
    }
    return orders.length + (missingReceiptOrders || []).length;
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
      branchId: order.branch_id,
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

    if (
      ['processing', 'unknown', 'succeeded'].includes(String(order.refund_status || '')) ||
      order.status === 'refunded'
    ) {
      return order;
    }
    const latePaymentAutoRefund = isLatePaymentAutoRefund(order);
    const lateCleanupCancellation =
      order.fulfillment_status === 'cancelled' &&
      (latePaymentAutoRefund ||
        LATE_PAYMENT_CANCELLATION_REASONS.has(String(order.cancellation_reason || '')));
    if (order.fulfillment_status === 'cancelled' && !lateCleanupCancellation) {
      return order;
    }

    const beforeFulfillment = ['pending', 'new'].includes(
      String(order.fulfillment_status || 'pending'),
    );
    const mustValidateCapacity = beforeFulfillment || lateCleanupCancellation;
    const refundUnavailableOrder = async (reason) => {
      const { releasePromotionReservation } = require('./commerce-marketing.service');
      const { cancelPaidOrder } = require('./customer-order.service');
      const cancellationReason = String(reason || '').startsWith(LATE_PAYMENT_AUTO_REFUND_PREFIX)
        ? String(reason)
        : `${LATE_PAYMENT_AUTO_REFUND_PREFIX}${String(reason || '').trim()}`;
      await releasePromotionReservation({ orderId: order.id }).catch((error) =>
        console.error('Не удалось освободить промокод поздней оплаты:', error.message),
      );
      await cancelPaidOrder(order, cancellationReason, {
        allowedFulfillmentStatuses: [String(order.fulfillment_status || 'pending')],
        cancelBeforeRefund: true,
        reuseRefundRequestId: true,
      });
      const { data: refundedOrder, error: refundedReadError } = await supabase
        .from('kaspi_orders')
        .select('*')
        .eq('id', order.id)
        .maybeSingle();
      if (refundedReadError) throw refundedReadError;
      return refundedOrder || order;
    };

    if (latePaymentAutoRefund && order.refund_status === 'failed') {
      return refundUnavailableOrder(order.cancellation_reason);
    }

    if (mustValidateCapacity) {
      const reservation = await commitOrReacquireOrderReservations(order.id, {
        allowReacquire: true,
      });
      if (!['committed', 'already_committed'].includes(reservation.status)) {
        const productSuffix = reservation.productId ? ` (${reservation.productId})` : '';
        return refundUnavailableOrder(
          `Оплата поступила после освобождения резерва, а товар или время уже недоступны${productSuffix}`,
        );
      }
    }

    const {
      consumePromotionReservation,
      qualifyReferralForOrder,
    } = require('./commerce-marketing.service');
    const promotion = await consumePromotionReservation(order);
    if (
      mustValidateCapacity &&
      ['unavailable', 'promotion_missing'].includes(String(promotion.status || ''))
    ) {
      return refundUnavailableOrder(
        'Оплата поступила после истечения резерва промокода, и скидка уже недоступна',
      );
    }

    let recorded = order;
    if (order.fulfillment_status === 'pending' || lateCleanupCancellation) {
      const { data, error } = await supabase
        .from('kaspi_orders')
        .update({
          fulfillment_status: 'new',
          cancellation_reason: null,
          last_error: null,
        })
        .eq('id', order.id)
        .eq('fulfillment_status', order.fulfillment_status)
        .eq('status', 'paid')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: latest, error: latestError } = await supabase
          .from('kaspi_orders')
          .select('*')
          .eq('id', order.id)
          .maybeSingle();
        if (latestError) throw latestError;
        if (
          !latest ||
          latest.status !== 'paid' ||
          ['processing', 'unknown'].includes(String(latest.refund_status || '')) ||
          latest.fulfillment_status === 'cancelled'
        ) {
          return latest || order;
        }
        recorded = latest;
      } else {
        recorded = data;
      }
    }
    const finalOrder = recorded.bonus_awarded_at ? recorded : await this.awardOrderBonus(recorded);
    await recordSystemEvent(finalOrder.customer_id, {
      type: 'payment_paid',
      orderId: finalOrder.id,
      branchId: finalOrder.branch_id,
      properties: { amount: Number(finalOrder.amount || 0) },
    }).catch((eventError) =>
      console.error('Не удалось записать аналитику оплаты:', eventError.message),
    );
    await qualifyReferralForOrder(finalOrder).catch((marketingError) =>
      console.error(
        `Не удалось применить реферальный бонус заказа ${finalOrder.order_number}:`,
        marketingError.message,
      ),
    );
    const { ensurePaymentReceipt } = require('./payment-receipt.service');
    await ensurePaymentReceipt(finalOrder).catch((receiptError) =>
      console.error(
        `Не удалось создать или отправить чек заказа ${finalOrder.order_number}:`,
        receiptError.message,
      ),
    );
    if (isDeliveryFulfillment(finalOrder)) {
      await dispatchPaidDeliveryOrder(finalOrder).catch((dispatchError) =>
        console.warn(
          `Автоматическая отправка заказа ${finalOrder.order_number} курьеру:`,
          dispatchError.message,
        ),
      );
    }
    realtime.publish(
      'order.created',
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
    return finalOrder;
  }
}

module.exports = new KaspiService();
module.exports.KaspiService = KaspiService;
module.exports.eligibleOrderAmount = eligibleOrderAmount;
module.exports.isKaspiSuccess = isKaspiSuccess;
module.exports.paymentStatusCanTransition = paymentStatusCanTransition;
module.exports.pendingReconciliationWindowMs = pendingReconciliationWindowMs;
module.exports.dispatchPaidDeliveryOrder = dispatchPaidDeliveryOrder;
