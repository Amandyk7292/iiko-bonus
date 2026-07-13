const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');
const tierController = require('../controllers/tier.controller');
const orderController = require('../controllers/order.controller');
const {
  customerAuthMiddleware,
  registrationAuthMiddleware,
} = require('../middlewares/customer-auth.middleware');
const { publicApiRateLimit } = require('../middlewares/rate-limit.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');

router.use('/api/public', publicApiRateLimit);
router.use('/api/customer', publicApiRateLimit, customerAuthMiddleware);

router.get('/', publicController.renderApp);
router.get('/admin', publicController.renderAdmin);
router.post(
  '/api/register-iiko',
  publicApiRateLimit,
  registrationAuthMiddleware,
  publicController.registerIiko,
);

router.get('/api/customer/profile', publicController.getProfile);
router.put('/api/customer/profile', publicController.updateProfile);
router.delete('/api/customer/profile', publicController.deleteProfile);
router.get('/api/customer/loyalty', tierController.getCustomerLoyalty);
router.get('/api/customer/orders', orderController.listCustomer);

// Kaspi Pay endpoints
const kaspiController = require('../controllers/kaspi.controller');
router.post('/api/customer/kaspi-pay/create', kaspiController.createPayment);
router.post('/api/customer/kaspi-pay/quote', kaspiController.quotePayment);
router.get('/api/customer/kaspi-pay/status/:operationId', kaspiController.checkStatus);

// Kaspi Webhook (должен быть открытым)
router.post('/webhooks/kaspi', webhookRateLimit, kaspiController.handleWebhook);

router.get('/api/public/cities', publicController.getCities);
router.get('/api/public/loyalty-tiers', tierController.listPublicTiers);

module.exports = router;
