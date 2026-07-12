const crypto = require('crypto');
const fetch = require('node-fetch');
const kaspiService = require('../services/kaspi.service');
const iikoService = require('../services/iiko.service');

const KASPI_URL = process.env.KASPI_MICROSERVICE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/kaspi-pos`;

const createPayment = async (req, res) => {
  try {
    const { phone, amount, items } = req.body;
    const customerId = req.customerAuth ? req.customerAuth.id : null;

    if (!phone || !amount) {
      return res.status(400).json({ error: 'phone и amount обязательны' });
    }

    const result = await kaspiService.createInvoice(phone, amount, customerId, items);
    res.json(result);
  } catch (error) {
    console.error('Ошибка createPayment:', error);
    res.status(500).json({ error: error.message });
  }
};

const checkStatus = async (req, res) => {
  try {
    const { operationId } = req.params;
    if (!operationId) {
      return res.status(400).json({ error: 'operationId обязателен' });
    }

    // 1. Сначала проверяем в нашей БД — может, уже обновлен через вебхук
    const order = await kaspiService.getOrderStatus(operationId);
    if (order.status === 'paid' || order.status === 'failed' || order.status === 'expired') {
      return res.json({ success: true, status: order.status });
    }

    // 2. Если в БД все еще pending — спрашиваем Kaspi напрямую через микросервис
    try {
      const response = await fetch(`${KASPI_URL}/api/invoice/details?operationId=${operationId}`);
      if (response.ok) {
        const kaspiData = await response.json();
        const kaspiStatus = kaspiData?.Data?.Status;

        if (kaspiStatus === 'Processed') {
          // Обновляем статус в БД
          await kaspiService.updateOrderStatus(operationId, 'paid');
          return res.json({ success: true, status: 'paid' });
        } else if (kaspiStatus === 'RemotePaymentCanceled' || kaspiStatus === 'RemotePaymentRejected') {
          await kaspiService.updateOrderStatus(operationId, 'failed');
          return res.json({ success: true, status: 'failed' });
        } else if (kaspiStatus === 'Expired') {
          await kaspiService.updateOrderStatus(operationId, 'expired');
          return res.json({ success: true, status: 'expired' });
        }
      }
    } catch (kaspiErr) {
      console.error('Ошибка запроса статуса у Kaspi:', kaspiErr.message);
    }

    // 3. Если ничего не помогло — возвращаем текущий статус из БД
    res.json({
      success: true,
      status: order.status || 'pending',
    });
  } catch (error) {
    console.error('Ошибка checkStatus:', error);
    res.status(500).json({ error: error.message });
  }
};

const handleWebhook = async (req, res) => {
  try {
    // 1. Проверка подписи HMAC SHA-256
    const signature = req.headers['x-hub-signature-256'];
    const secret = process.env.KASPI_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return res.status(401).json({ error: 'Unauthorized: missing signature or secret' });
    }

    const rawBody = JSON.stringify(req.body); // В реальном проекте лучше использовать raw-body буфер, если middleware body-parser его поддерживает, но для простого JSON сойдет
    const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (signature !== expectedSignature) {
      // Игнорируем несовпадение для безопасности (чтобы не падать при ложных запросах)
      console.warn('Kaspi Webhook: неверная подпись', { signature, expectedSignature });
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // 2. Обработка payload
    const { event, operationId, data } = req.body;
    console.log(`Kaspi Webhook получен: event=${event}, operationId=${operationId}`);

    if (event === 'payment.success') {
      const order = await kaspiService.updateOrderStatus(operationId, 'paid');
      
      // Здесь мы можем отправить заказ в iiko!
      if (order && order.cart_items && order.cart_items.length > 0) {
        try {
          // Пример интеграции, если у вас есть соответствующий метод в iikoService
          // await iikoService.createOrder(order.customer_id, order.cart_items, order.amount);
          console.log(`Заказ ${operationId} успешно оплачен. Требуется отправка в iiko.`);
        } catch (iikoErr) {
          console.error('Ошибка отправки заказа в iiko:', iikoErr);
        }
      }
    } else if (event === 'payment.failed' || event === 'payment.expired') {
      await kaspiService.updateOrderStatus(operationId, event === 'payment.failed' ? 'failed' : 'expired');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обработки Kaspi Webhook:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createPayment,
  checkStatus,
  handleWebhook,
};
