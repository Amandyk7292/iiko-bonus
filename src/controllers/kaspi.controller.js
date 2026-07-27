const crypto = require('crypto');
const kaspiService = require('../services/kaspi.service');
const paymentOperations = require('../services/payment-operations.service');
const { priceOrder } = require('../services/order.service');
const { getCitiesWithPoints } = require('../services/location.service');
const { normalizeOrderType, validateCheckout } = require('../services/checkout.service');
const { forecastOrderEta } = require('../services/eta.service');
const { SingleFlight } = require('../utils/single-flight.util');
const {
  attachOrderReservations,
  commitOrderReservations,
  releaseCheckoutRequest,
  reserveCheckout,
} = require('../services/inventory.service');
const checkoutRequests = new SingleFlight();
const publicError = (error, fallback) => (error.statusCode ? error.message : fallback);

const availability = async (_req, res) => {
  const available = await kaspiService.availability();
  res.json({
    success: true,
    available,
    ...(!available && {
      message: 'Kaspi Pay временно недоступен. Мы уже восстанавливаем подключение.',
    }),
  });
};

const createPayment = async (req, res) => {
  try {
    const { items, promoCode, checkoutId } = req.body;
    const { id: customerId, phone } = req.customerAuth;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        checkoutId || '',
      )
    ) {
      return res.status(400).json({ error: 'Некорректный идентификатор оформления' });
    }
    const cities = await getCitiesWithPoints({ throwOnError: true });
    const checkout = validateCheckout(req.body, cities);
    const requestKey = `${customerId}:${checkoutId}`;
    const result = await checkoutRequests.run(requestKey, async () => {
      const pricing = await priceOrder(items, promoCode, {
        deliveryFee: checkout.deliveryFee,
        branchId: checkout.branchId,
        customerId,
        orderType: checkout.orderType,
      });
      if (pricing.subtotal < checkout.deliveryMinimumOrder) {
        const error = new Error(
          `Минимальная сумма доставки — ${checkout.deliveryMinimumOrder.toLocaleString('ru-RU')} ₸`,
        );
        error.statusCode = 400;
        throw error;
      }
      await reserveCheckout({
        customerId,
        requestId: checkoutId,
        branchId: checkout.branchId,
        items: pricing.canonicalItems,
        orderType: checkout.orderType,
        scheduledAt: checkout.scheduledAt,
      });
      try {
        const result = await kaspiService.createInvoice(phone, pricing, customerId, {
          ...checkout,
          requestId: checkoutId,
        });
        const order = await kaspiService.existingRequest(customerId, checkoutId);
        if (order?.id) {
          await attachOrderReservations(customerId, checkoutId, order.id);
          if (order.status === 'paid') await commitOrderReservations(order.id);
        }
        return result;
      } catch (error) {
        const order = await kaspiService.existingRequest(customerId, checkoutId).catch(() => null);
        if (!order) {
          await releaseCheckoutRequest(customerId, checkoutId).catch((releaseError) =>
            console.error('Не удалось освободить резерв оформления:', releaseError.message),
          );
        }
        throw error;
      }
    });
    res.json(result);
  } catch (error) {
    console.error('Ошибка createPayment:', error);
    res.status(error.statusCode || 500).json({
      error: publicError(error, 'Не удалось создать счет на оплату'),
      ...(error.code && { code: error.code }),
      ...(typeof error.retryable === 'boolean' && { retryable: error.retryable }),
    });
  }
};

const quotePayment = async (req, res) => {
  try {
    normalizeOrderType(req.body?.orderType ?? req.body?.fulfillmentType ?? 'pickup');
    const cities = await getCitiesWithPoints({ throwOnError: true });
    const checkout = validateCheckout(req.body, cities);
    const deliveryFee = checkout.deliveryFee;
    const deliveryMinimumOrder = checkout.deliveryMinimumOrder;
    const pricing = await priceOrder(req.body?.items, req.body?.promoCode, {
      deliveryFee,
      branchId: checkout.branchId,
      customerId: req.customerAuth.id,
      orderType: checkout.orderType,
    });
    if (pricing.subtotal < deliveryMinimumOrder) {
      return res.status(400).json({
        error: `Минимальная сумма доставки — ${deliveryMinimumOrder.toLocaleString('ru-RU')} ₸`,
      });
    }
    const eta = await forecastOrderEta({
      branchId: checkout.branchId,
      orderType: checkout.orderType,
      scheduledAt: checkout.scheduledAt,
      preparationMinutes: pricing.preparationMinutes,
      deliveryAddress: checkout.deliveryAddress,
      deliveryZone: checkout.deliveryZone,
    });
    res.json({
      success: true,
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      deliveryFee: pricing.deliveryFee,
      total: pricing.total,
      promoCode: pricing.promoCode,
      branchId: checkout.branchId,
      deliveryZone: checkout.deliveryZone,
      eta,
    });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось рассчитать заказ') });
  }
};

const checkStatus = async (req, res) => {
  try {
    const { operationId } = req.params;
    if (!/^[A-Za-z0-9-]{1,100}$/.test(String(operationId || ''))) {
      return res.status(400).json({ error: 'Некорректный operationId' });
    }

    // 1. Сначала проверяем в нашей БД — может, уже обновлен
    const customerId = req.customerAuth.id;
    let order = await kaspiService.getOrderStatus(operationId, customerId);
    if (order.status === 'paid') {
      try {
        order = await kaspiService.recordPaidOrder(operationId);
      } catch (recordError) {
        console.error('Ошибка сохранения оплаченного заказа:', recordError.message);
        order = await kaspiService.getOrderStatus(operationId, customerId);
      }
    }
    if (
      order.status === 'paid' ||
      order.status === 'refunded' ||
      order.status === 'failed' ||
      order.status === 'expired'
    ) {
      return res.json({
        success: true,
        status: order.status,
        paymentStatus: order.status,
        fulfillmentStatus: order.fulfillment_status || 'pending',
      });
    }

    // 2. Если в БД pending — напрямую спрашиваем Kaspi API через микросервис
    try {
      const syncedStatus = await kaspiService.syncRemoteOrder(operationId);
      if (syncedStatus && syncedStatus !== 'pending') {
        order = await kaspiService.getOrderStatus(operationId, customerId);
        return res.json({
          success: true,
          status: order.status,
          paymentStatus: order.status,
          fulfillmentStatus: order.fulfillment_status || 'pending',
        });
      }
    } catch (kaspiErr) {
      console.error('Ошибка прямого запроса статуса у Kaspi:', kaspiErr.message);
    }

    // 3. Возвращаем текущий статус из БД
    res.json({
      success: true,
      status: order.status || 'pending',
      paymentStatus: order.status || 'pending',
      fulfillmentStatus: order.fulfillment_status || 'pending',
    });
  } catch (error) {
    console.error('Ошибка checkStatus:', error);
    res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось проверить статус оплаты') });
  }
};

const handleWebhook = async (req, res) => {
  try {
    // 1. Проверка подписи HMAC SHA-256
    const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'];
    const secret = process.env.KASPI_WEBHOOK_SECRET;

    if (!signature || !secret) {
      void paymentOperations
        .recordWebhook('kaspi', { success: false, errorCode: 'KASPI_WEBHOOK_AUTH_MISSING' })
        .catch(() => undefined);
      return res.status(401).json({ error: 'Unauthorized: missing signature or secret' });
    }

    if (secret.length < 32 || !Buffer.isBuffer(req.rawBody)) {
      void paymentOperations
        .recordWebhook('kaspi', { success: false, errorCode: 'KASPI_WEBHOOK_NOT_CONFIGURED' })
        .catch(() => undefined);
      return res.status(503).json({ error: 'Webhook is not configured' });
    }
    const actualSignature = String(signature).replace(/^sha256=/i, '');
    const expectedSignature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const actualBuffer = Buffer.from(actualSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      console.warn('Kaspi Webhook: неверная подпись');
      void paymentOperations
        .recordWebhook('kaspi', { success: false, errorCode: 'KASPI_WEBHOOK_SIGNATURE_INVALID' })
        .catch(() => undefined);
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // 2. Обработка payload
    const { event } = req.body;
    const operationId = String(req.body?.operationId || req.body?.paymentId || '');
    if (
      !/^[A-Za-z0-9-]{1,100}$/.test(operationId) ||
      !['payment.success', 'payment.failed', 'payment.expired'].includes(event)
    ) {
      void paymentOperations
        .recordWebhook('kaspi', { success: false, errorCode: 'KASPI_WEBHOOK_PAYLOAD_INVALID' })
        .catch(() => undefined);
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
    console.log(`Kaspi Webhook получен: event=${event}, operationId=${operationId}`);

    if (event === 'payment.success') {
      await kaspiService.updateOrderStatus(operationId, 'paid');
      try {
        await kaspiService.recordPaidOrder(operationId);
      } catch (recordError) {
        console.error('Ошибка сохранения оплаченного заказа:', recordError.message);
      }
    } else if (event === 'payment.failed' || event === 'payment.expired') {
      await kaspiService.updateOrderStatus(
        operationId,
        event === 'payment.failed' ? 'failed' : 'expired',
      );
    }

    await paymentOperations.recordWebhook('kaspi', { success: true }).catch(() => undefined);
    res.json({ success: true });
  } catch (error) {
    await paymentOperations
      .recordWebhook('kaspi', {
        success: false,
        errorCode: error.code || 'KASPI_WEBHOOK_FAILED',
      })
      .catch(() => undefined);
    console.error('Ошибка обработки Kaspi Webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = {
  availability,
  createPayment,
  quotePayment,
  checkStatus,
  handleWebhook,
};
