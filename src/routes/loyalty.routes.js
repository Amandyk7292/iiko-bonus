const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyalty.controller');
const { webhookMiddleware } = require('../middlewares/webhook.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');

router.use('/api/loyalty', webhookRateLimit, webhookMiddleware);
router.get('/api/loyalty/config-check', loyaltyController.configCheck);
router.post('/api/loyalty/customer', loyaltyController.getCustomerInfo);
router.post('/api/loyalty/search', loyaltyController.searchCustomersHandler);
router.post('/api/loyalty/calculate', loyaltyController.calculateBonus);
router.post('/api/loyalty/apply', loyaltyController.applyBonus);

module.exports = router;
