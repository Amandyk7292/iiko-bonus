const forteService = require('../services/forte.service');
const forteWidgetService = require('../services/forte-widget.service');
const kaspiService = require('../services/kaspi.service');
const paymentOperations = require('../services/payment-operations.service');
const { isSafeWidgetFallbackError } = paymentOperations;
const kaspiController = require('./kaspi.controller');
const { priceOrder } = require('../services/order.service');
const { getCitiesWithPoints } = require('../services/location.service');
const { validateCheckout } = require('../services/checkout.service');
const { SingleFlight } = require('../utils/single-flight.util');
const {
  attachPromotionReservation,
  releasePromotionReservation,
  reservePromotionForCheckout,
} = require('../services/commerce-marketing.service');
const {
  attachOrderReservations,
  commitOrderReservations,
  releaseCheckoutRequest,
  reserveCheckout,
} = require('../services/inventory.service');

const checkoutRequests = new SingleFlight();
const CHECKOUT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicError = (error, fallback) => (error.statusCode ? error.message : fallback);
const existingForteRequest = async (customerId, checkoutId) => {
  const results = await Promise.allSettled([
    forteWidgetService.existingRequest(customerId, checkoutId),
    forteService.existingRequest(customerId, checkoutId),
  ]);
  return results.find((result) => result.status === 'fulfilled' && result.value)?.value || null;
};

const availability = async (req, res) => {
  const decision = await paymentOperations.getForteCheckoutDecision();
  const widgetAvailable = decision.effectiveIntegration === 'widget';
  const service = widgetAvailable ? forteWidgetService : forteService;
  const available = service.availability();
  const paymentMethods = widgetAvailable
    ? await forteWidgetService.listPaymentMethods(req.customerAuth.id).catch(() => [])
    : [];
  res.json({
    success: true,
    available,
    integration: widgetAvailable ? 'widget' : available ? 'hosted_page' : null,
    fallbackActive: decision.fallbackActive,
    testMode: available && service.config().test,
    savedCard: paymentMethods.find((method) => method.isDefault) || null,
    cardSetup: widgetAvailable,
    googlePay: widgetAvailable,
    applePay: widgetAvailable && forteWidgetService.config().applePayEnabled === true,
    ...(!available && {
      message: 'Оплата картой ForteBank временно недоступна.',
    }),
  });
};

const createPayment = async (req, res) => {
  try {
    const { items, promoCode, checkoutId } = req.body || {};
    const { id: customerId, phone } = req.customerAuth;
    if (!CHECKOUT_ID_PATTERN.test(String(checkoutId || ''))) {
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
        throw Object.assign(
          new Error(
            `Минимальная сумма доставки — ${checkout.deliveryMinimumOrder.toLocaleString(
              'ru-RU',
            )} ₸`,
          ),
          { statusCode: 400 },
        );
      }

      await reservePromotionForCheckout(pricing, {
        customerId,
        requestId: checkoutId,
        ttlMinutes: 35,
      });
      try {
        await reserveCheckout({
          customerId,
          requestId: checkoutId,
          branchId: checkout.branchId,
          items: pricing.canonicalItems,
          orderType: checkout.effectiveFulfillmentType,
          scheduledAt: checkout.scheduledAt,
          ttlMinutes: 35,
        });
      } catch (error) {
        await releasePromotionReservation({ customerId, requestId: checkoutId }).catch(
          () => undefined,
        );
        throw error;
      }
      try {
        const decision = await paymentOperations.getForteCheckoutDecision();
        let service =
          decision.effectiveIntegration === 'widget' ? forteWidgetService : forteService;
        const checkoutPayload = {
          ...checkout,
          requestId: checkoutId,
        };
        const checkoutOptions = {
          language: req.body?.language || req.headers['accept-language'] || 'ru',
          paymentMethodId: req.body?.savedPaymentMethodId,
        };
        let payment;
        try {
          payment = await service.createCheckout(
            phone,
            pricing,
            customerId,
            checkoutPayload,
            checkoutOptions,
          );
        } catch (error) {
          if (
            service !== forteWidgetService ||
            !forteService.availability() ||
            !isSafeWidgetFallbackError(error)
          ) {
            throw error;
          }
          await paymentOperations.recordWidgetFailure(error);
          service = forteService;
          payment = await service.createCheckout(
            phone,
            pricing,
            customerId,
            checkoutPayload,
            checkoutOptions,
          );
        }
        const order = await service.existingRequest(customerId, checkoutId);
        if (order?.id) {
          await attachOrderReservations(customerId, checkoutId, order.id);
          if (pricing.promotionId) {
            await attachPromotionReservation(customerId, checkoutId, order.id);
          }
          if (order.status === 'paid') await commitOrderReservations(order.id);
        }
        return payment;
      } catch (error) {
        const order = await existingForteRequest(customerId, checkoutId);
        await Promise.allSettled([
          releaseCheckoutRequest(customerId, checkoutId),
          releasePromotionReservation({ customerId, requestId: checkoutId }),
          ...(order?.id ? [releasePromotionReservation({ orderId: order.id })] : []),
        ]).then((results) => {
          for (const result of results) {
            if (result.status === 'rejected') {
              console.error('Не удалось освободить резерв ForteBank:', result.reason.message);
            }
          }
        });
        if (order?.status === 'pending') {
          await kaspiService
            .updateOrderStatus(order.operation_id, 'expired')
            .catch(() => undefined);
        }
        throw error;
      }
    });
    return res.json(result);
  } catch (error) {
    console.error('Ошибка ForteBank createPayment:', error.code || 'UNKNOWN', error.message);
    return res.status(error.statusCode || 500).json({
      error: publicError(error, 'Не удалось создать оплату ForteBank'),
      ...(error.code && { code: error.code }),
      ...(typeof error.retryable === 'boolean' && { retryable: error.retryable }),
    });
  }
};

const checkStatus = async (req, res) => {
  try {
    const operationId = String(req.params.operationId || '');
    const isWidgetOperation = UUID_PATTERN.test(operationId);
    if (!PAYMENT_TOKEN_PATTERN.test(operationId) && !isWidgetOperation) {
      return res.status(400).json({ error: 'Некорректный operationId' });
    }
    const customerId = req.customerAuth.id;
    const service = isWidgetOperation ? forteWidgetService : forteService;
    if (!service.availability()) {
      return res.status(503).json({ error: 'Оплата картой временно недоступна' });
    }
    let order = await service.getOrderStatus(operationId, customerId);
    if (order.status === 'paid') {
      order = (await service.orderService.recordPaidOrder(operationId)) || order;
    } else if (!['failed', 'expired', 'refunded'].includes(order.status)) {
      try {
        await service.syncOrder(order, customerId);
        order = await service.getOrderStatus(operationId, customerId);
      } catch (error) {
        console.error('Ошибка прямой сверки ForteBank:', error.message);
      }
    }
    return res.json({
      success: true,
      status: order.status || 'pending',
      paymentStatus: order.status || 'pending',
      fulfillmentStatus: order.fulfillment_status || 'pending',
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось проверить статус ForteBank') });
  }
};

const listPaymentMethods = async (req, res) => {
  try {
    const methods = forteWidgetService.availability()
      ? await forteWidgetService.listPaymentMethods(req.customerAuth.id)
      : [];
    return res.json({ success: true, methods });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось загрузить сохранённые карты') });
  }
};

const createCardSetup = async (req, res) => {
  try {
    const decision = await paymentOperations.getForteCheckoutDecision();
    if (decision.effectiveIntegration !== 'widget') {
      throw Object.assign(new Error('Привязка карты временно недоступна'), {
        statusCode: 503,
        code: 'FORTE_WIDGET_CHECKOUT_DISABLED',
      });
    }
    const result = await forteWidgetService.createCardSetup(
      req.customerAuth.id,
      req.customerAuth.phone,
      req.body?.language || req.headers['accept-language'] || 'ru',
    );
    return res.status(201).json(result);
  } catch (error) {
    console.error('Ошибка ForteBank createCardSetup:', error.code || 'UNKNOWN', error.message);
    return res.status(error.statusCode || 500).json({
      error: publicError(error, 'Не удалось начать привязку карты'),
      ...(error.code && { code: error.code }),
      ...(typeof error.retryable === 'boolean' && { retryable: error.retryable }),
    });
  }
};

const checkCardSetupStatus = async (req, res) => {
  try {
    const operationId = String(req.params.operationId || '');
    if (!UUID_PATTERN.test(operationId)) {
      return res.status(400).json({ error: 'Некорректный идентификатор привязки карты' });
    }
    if (!forteWidgetService.availability()) {
      return res.status(503).json({ error: 'Привязка карты временно недоступна' });
    }
    let setup = await forteWidgetService.getCardSetupStatus(operationId, req.customerAuth.id);
    if (!['paid', 'failed', 'expired'].includes(setup.status)) {
      try {
        await forteWidgetService.syncCardSetup(setup, req.customerAuth.id);
        setup = await forteWidgetService.getCardSetupStatus(operationId, req.customerAuth.id);
      } catch (error) {
        console.error('Ошибка прямой сверки привязки карты ForteBank:', error.message);
      }
    }
    return res.json({
      success: true,
      status: setup.status || 'pending',
      paymentStatus: setup.status || 'pending',
      purpose: 'card-setup',
      cardSaved:
        setup.status === 'paid' || String(setup.provider_status || '').includes('card_saved'),
      refundStatus: setup.refund_status || null,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось проверить привязку карты') });
  }
};

const removePaymentMethod = async (req, res) => {
  try {
    await forteWidgetService.revokePaymentMethod(req.customerAuth.id, req.params.methodId);
    return res.json({ success: true });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось удалить сохранённую карту') });
  }
};

const setDefaultPaymentMethod = async (req, res) => {
  try {
    await forteWidgetService.setDefaultPaymentMethod(req.customerAuth.id, req.params.methodId);
    return res.json({ success: true });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: publicError(error, 'Не удалось выбрать сохранённую карту') });
  }
};

const handleWidgetWebhook = async (req, res) => {
  try {
    await forteWidgetService.handleWebhook(req.body, req.rawBody, req.headers);
    await paymentOperations.recordWebhook('forte_widget', { success: true }).catch(() => undefined);
    return res.status(200).json({ success: true });
  } catch (error) {
    await paymentOperations
      .recordWebhook('forte_widget', {
        success: false,
        errorCode: error.code || 'FORTE_WIDGET_WEBHOOK_FAILED',
      })
      .catch(() => undefined);
    console.error('Ошибка ForteBank Widget webhook:', error.code || 'UNKNOWN', error.message);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode && error.statusCode < 500 ? error.message : 'Webhook failed',
      ...(error.code && { code: error.code }),
    });
  }
};

module.exports = {
  availability,
  checkCardSetupStatus,
  checkStatus,
  createCardSetup,
  createPayment,
  handleWidgetWebhook,
  listPaymentMethods,
  removePaymentMethod,
  setDefaultPaymentMethod,
  quotePayment: kaspiController.quotePayment,
};
