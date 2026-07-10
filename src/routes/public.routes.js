const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');
const {
  customerAuthMiddleware,
  registrationAuthMiddleware,
} = require('../middlewares/customer-auth.middleware');
const { publicApiRateLimit } = require('../middlewares/rate-limit.middleware');

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

router.get('/api/public/cities', publicController.getCities);

module.exports = router;
