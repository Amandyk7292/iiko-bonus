const kaspiService = require('./kaspi.service');
const forteService = require('./forte.service');

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

  let providerTransactionId = order.provider_transaction_id;
  if (!providerTransactionId) {
    const synchronized = await forteService.syncOrder(order);
    providerTransactionId = synchronized?.order?.provider_transaction_id;
  }
  if (!providerTransactionId) {
    throw Object.assign(
      new Error('ForteBank не вернул UID исходной оплаты. Сначала выполните сверку платежа.'),
      {
        statusCode: 409,
        code: 'FORTE_REFUND_PAYMENT_UID_MISSING',
      },
    );
  }
  return forteService.refundPayment(providerTransactionId, amount, options);
}

module.exports = {
  isForteOrder,
  paymentProviderName,
  refundPaymentForOrder,
};
