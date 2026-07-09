const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyalty.controller');
const { webhookMiddleware } = require('../middlewares/webhook.middleware');

router.get('/api/loyalty/config-check', webhookMiddleware, loyaltyController.configCheck);
router.post('/api/loyalty/customer', webhookMiddleware, loyaltyController.getCustomerInfo);
router.post('/api/loyalty/search', webhookMiddleware, loyaltyController.searchCustomersHandler);
router.post('/api/loyalty/calculate', webhookMiddleware, loyaltyController.calculateBonus);
router.post('/api/loyalty/apply', webhookMiddleware, loyaltyController.applyBonus);

module.exports = router;
