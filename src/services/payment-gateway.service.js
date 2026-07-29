const kaspiService = require('./kaspi.service');
const forteService = require('./forte.service');
const forteWidgetService = require('./forte-widget.service');

const SAFE_REFUND_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const isForteOrder = (order) => String(order?.payment_method || '') === 'forte_card';

const paymentProviderName = (order) => (isForteOrder(order) ? 'ForteBank' : 'Kaspi Pay');

async function refundPaymentForOrder(order, amount, options = {}) {
  if (!order?.operation_id) {
    throw Object.assign(new Error('У заказа отсутствует идентификатор платежа'), {
      statusCode: 409,
      code: 'PAYMENT_OPERATION_MISSING',
    });
  }
  if (!isForteOrder(order)) {
    return kaspiService.refundPayment(order.operation_id, amount);
  }
  if (order.provider_payment_system === 'forte_widget') {
    return forteWidgetService.refundPayment(order, amount, options);
  }
  return forteService.refundPayment(order, amount, options);
}

const EXPLICIT_REFUND_DECLINES = new Set([
  'KASPI_REFUND_REJECTED',
  'FORTE_REFUND_REJECTED',
  'FORTE_WIDGET_REFUND_REJECTED',
]);

async function reconcileRefundForOrder(order, refund, options = {}) {
  if (!isForteOrder(order)) {
    return kaspiService.reconcileRefund(order, refund, options);
  }

  if (order.provider_payment_system !== 'forte_widget') {
    try {
      const snapshot = await forteService.queryOrder(order);
      const providerStatus = String(snapshot?.normalized?.status || '')
        .replace(/[\s_-]/g, '')
        .toLowerCase();
      if (['refunded', 'voided'].includes(providerStatus)) {
        const locallyAccountedMinor = Math.round(
          (Number(options.knownSucceededAmount || 0) + Number(refund.amount || 0)) * 100,
        );
        const orderAmountMinor = Math.round(Number(order.amount || 0) * 100);
        if (
          Number.isSafeInteger(locallyAccountedMinor) &&
          Number.isSafeInteger(orderAmountMinor) &&
          orderAmountMinor > 0 &&
          locallyAccountedMinor >= orderAmountMinor
        ) {
          return {
            status: 'confirmed',
            reference: refund.provider_reference || refund.kaspi_reference || null,
            requestId: refund.provider_request_id || refund.id,
          };
        }
        return {
          status: 'pending',
          reference: refund.provider_reference || refund.kaspi_reference || null,
          requestId: refund.provider_request_id || refund.id,
          message:
            'ForteBank сообщает полный возврат, но локальная сумма операций требует ручной сверки',
        };
      }
    } catch (error) {
      return {
        status: 'pending',
        reference: refund.provider_reference || refund.kaspi_reference || null,
        requestId: refund.provider_request_id || refund.id,
        message: error.message,
      };
    }
  }

  const createdAt = Date.parse(String(refund.created_at || ''));
  const ageMs = Number(options.now ?? Date.now()) - createdAt;
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    ageMs >= SAFE_REFUND_RETRY_WINDOW_MS
  ) {
    return {
      status: 'pending',
      reference: refund.provider_reference || refund.kaspi_reference || null,
      requestId: refund.provider_request_id || refund.id,
      message:
        'Безопасное окно повторного запроса ForteBank истекло. Требуется ручная сверка без повторного возврата.',
    };
  }

  try {
    const result = await refundPaymentForOrder(order, Number(refund.amount), {
      reason: refund.reason,
      idempotencyKey: refund.provider_request_id || refund.id,
    });
    return {
      status: 'confirmed',
      reference: result.reference || refund.provider_reference || null,
      requestId: result.requestId || refund.provider_request_id || refund.id,
    };
  } catch (error) {
    if (
      EXPLICIT_REFUND_DECLINES.has(String(error.code || '')) &&
      error.refundDeclinedExplicit === true
    ) {
      return {
        status: 'declined',
        reference: error.refundReference || refund.provider_reference || null,
        requestId: error.requestId || refund.provider_request_id || refund.id,
        message: error.message,
      };
    }
    return {
      status: 'pending',
      reference: error.refundReference || refund.provider_reference || null,
      requestId: error.requestId || refund.provider_request_id || refund.id,
      message: error.message,
    };
  }
}

module.exports = {
  SAFE_REFUND_RETRY_WINDOW_MS,
  isForteOrder,
  paymentProviderName,
  reconcileRefundForOrder,
  refundPaymentForOrder,
};
