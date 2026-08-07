const { emptyBodySchema, validateRequest } = require('../../middlewares/validation.middleware');
const { onlineOrderingMiddleware } = require('../../middlewares/online-ordering.middleware');
const {
  bonusExpiryQuerySchema,
  giftCertificateListQuerySchema,
  giftCertificatePurchaseBodySchema,
  giftCertificatePurchaseParamsSchema,
  orderUuidParamsSchema,
  stockSubscriptionBodySchema,
  stockSubscriptionParamsSchema,
  stockSubscriptionProductParamsSchema,
  stockSubscriptionStatusQuerySchema,
} = require('../../contracts/business-foundation.contract');
const { getBonusExpirySummary } = require('../../services/bonus-expiry.service');
const {
  cancelStockSubscription,
  listStockSubscriptions,
  stockSubscriptionStatus,
  subscribeToStock,
} = require('../../services/stock-subscription.service');
const {
  createGiftCertificatePurchase,
  listGiftCertificatePurchases,
  listReceivedGiftCards,
  readPurchase,
  serializePurchase,
} = require('../../services/gift-certificate-purchase.service');
const { getPickupHandoff } = require('../../services/pickup-handoff.service');

const publicError = (error, fallback) => (error.statusCode ? error.message : fallback);

function registerBusinessFoundationCustomerRoutes(router) {
  router.get(
    '/api/customer/bonus-expiry',
    validateRequest({ query: bonusExpiryQuerySchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          summary: await getBonusExpirySummary(req.customerAuth.id, req.query),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось загрузить сроки действия бонусов'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.get('/api/customer/stock-subscriptions', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      return res.json({
        success: true,
        subscriptions: await listStockSubscriptions(req.customerAuth.id),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: publicError(error, 'Не удалось загрузить подписки на наличие'),
      });
    }
  });

  router.get(
    '/api/customer/stock-subscriptions/:productId',
    validateRequest({
      params: stockSubscriptionProductParamsSchema,
      query: stockSubscriptionStatusQuerySchema,
    }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          ...(await stockSubscriptionStatus(
            req.customerAuth.id,
            req.params.productId,
            req.query.branchId,
          )),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось проверить подписку'),
        });
      }
    },
  );

  router.post(
    '/api/customer/stock-subscriptions',
    validateRequest({ body: stockSubscriptionBodySchema }),
    async (req, res) => {
      try {
        return res.status(201).json({
          success: true,
          subscription: await subscribeToStock(req.customerAuth.id, req.body),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось подписаться на наличие'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.delete(
    '/api/customer/stock-subscriptions/:id',
    validateRequest({
      params: stockSubscriptionParamsSchema,
      body: emptyBodySchema,
    }),
    async (req, res) => {
      try {
        await cancelStockSubscription(req.customerAuth.id, req.params.id);
        return res.json({ success: true });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось отменить подписку'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.post(
    '/api/customer/gift-certificate-purchases',
    onlineOrderingMiddleware,
    validateRequest({ body: giftCertificatePurchaseBodySchema }),
    async (req, res) => {
      try {
        const result = await createGiftCertificatePurchase(
          {
            id: req.customerAuth.id,
            phone: req.customerAuth.phone,
          },
          req.body,
        );
        return res.status(201).json({ success: true, ...result });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось создать подарочный сертификат'),
          ...(error.code && { code: error.code }),
          ...(typeof error.retryable === 'boolean' && { retryable: error.retryable }),
        });
      }
    },
  );

  router.get(
    '/api/customer/gift-certificate-purchases',
    validateRequest({ query: giftCertificateListQuerySchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          purchases: await listGiftCertificatePurchases(req.customerAuth.id, req.query),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось загрузить покупки сертификатов'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.get(
    '/api/customer/gift-cards',
    validateRequest({ query: giftCertificateListQuerySchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          cards: await listReceivedGiftCards(req.customerAuth.id, req.query),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось загрузить полученные сертификаты'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.get(
    '/api/customer/gift-certificate-purchases/:id',
    validateRequest({ params: giftCertificatePurchaseParamsSchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        const { purchase, card } = await readPurchase(req.customerAuth.id, req.params.id);
        return res.json({
          success: true,
          purchase: serializePurchase(purchase, card, {
            includeCode: purchase.status === 'active',
          }),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось загрузить сертификат'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.get(
    '/api/customer/orders/:id/pickup-handoff',
    validateRequest({ params: orderUuidParamsSchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        const result = await getPickupHandoff(req.customerAuth.id, req.params.id);
        return res.json({ success: true, ...result });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось получить код выдачи'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );
}

module.exports = { registerBusinessFoundationCustomerRoutes };
