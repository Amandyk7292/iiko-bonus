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
  return forteService.refundPayment(order, amount, options);
}

module.exports = {
  isForteOrder,
  paymentProviderName,
  refundPaymentForOrder,
};
