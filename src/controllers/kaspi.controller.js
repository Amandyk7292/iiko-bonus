const crypto = require('crypto');
const kaspiService = require('../services/kaspi.service');
const { priceOrder } = require('../services/order.service');
const { getCitiesWithPoints } = require('../services/location.service');
const checkoutRequests = new Map();

const createPayment = async (req, res) => {
  try {
    const { items, branch, pickupTime, additionalPhone, comment, promoCode, checkoutId } = req.body;
    const { id: customerId, phone } = req.customerAuth;
    const normalizedBranch = String(branch || '')
      .trim()
      .slice(0, 160);
    const normalizedPickupTime = String(pickupTime || '')
      .trim()
      .slice(0, 40);
    const pickupDate = new Date(normalizedPickupTime);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        checkoutId || '',
      )
    ) {
      return res.status(400).json({ error: 'Некорректный идентификатор оформления' });
    }
    if (!normalizedBranch || !normalizedPickupTime || Number.isNaN(pickupDate.getTime())) {
      return res.status(400).json({ error: 'Выберите филиал и время самовывоза' });
    }
    const cities = await getCitiesWithPoints();
    const validBranch = cities.some((city) =>
      (city.points || []).some(
        (point) => [point.name, point.address].filter(Boolean).join(', ') === normalizedBranch,
      ),
    );
    if (!validBranch) {
      return res.status(400).json({ error: 'Выбранный филиал больше недоступен' });
    }
    if (
      pickupDate.getTime() < Date.now() - 5 * 60 * 1000 ||
      pickupDate.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000
    ) {
      return res.status(400).json({ error: 'Выберите доступное время самовывоза' });
    }
    const requestKey = `${customerId}:${checkoutId}`;
    let request = checkoutRequests.get(requestKey);
    if (!request) {
      request = (async () => {
        const pricing = await priceOrder(items, promoCode);
        return kaspiService.createInvoice(phone, pricing, customerId, {
          branch: normalizedBranch,
          pickupTime: normalizedPickupTime,
          additionalPhone:
            String(additionalPhone || '')
              .trim()
              .slice(0, 32) || null,
          comment:
            String(comment || '')
              .trim()
              .slice(0, 500) || null,
          requestId: checkoutId,
        });
      })();
      checkoutRequests.set(requestKey, request);
    }
    let result;
    try {
      result = await request;
    } finally {
      if (checkoutRequests.get(requestKey) === request) checkoutRequests.delete(requestKey);
    }
    res.json(result);
  } catch (error) {
    console.error('Ошибка createPayment:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

const quotePayment = async (req, res) => {
  try {
    const pricing = await priceOrder(req.body?.items, req.body?.promoCode);
    res.json({
      success: true,
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      total: pricing.total,
      promoCode: pricing.promoCode,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
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
    if (order.status === 'paid' || order.status === 'failed' || order.status === 'expired') {
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
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

const handleWebhook = async (req, res) => {
  try {
    // 1. Проверка подписи HMAC SHA-256
    const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'];
    const secret = process.env.KASPI_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return res.status(401).json({ error: 'Unauthorized: missing signature or secret' });
    }

    if (secret.length < 32 || !Buffer.isBuffer(req.rawBody)) {
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
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // 2. Обработка payload
    const { event } = req.body;
    const operationId = String(req.body?.operationId || req.body?.paymentId || '');
    if (
      !/^[A-Za-z0-9-]{1,100}$/.test(operationId) ||
      !['payment.success', 'payment.failed', 'payment.expired'].includes(event)
    ) {
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

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обработки Kaspi Webhook:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createPayment,
  quotePayment,
  checkStatus,
  handleWebhook,
};
