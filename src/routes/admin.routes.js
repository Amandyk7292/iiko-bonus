const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { adminAuthMiddleware, adminLoginHandler } = require('../middlewares/auth.middleware');
const { adminRateLimit, adminLoginRateLimit } = require('../middlewares/rate-limit.middleware');

router.use('/admin/api', adminRateLimit);
router.post('/admin/api/login', adminLoginRateLimit, adminLoginHandler);

router.get('/admin/api/settings', adminAuthMiddleware, adminController.getSettingsHandler);
router.post('/admin/api/settings', adminAuthMiddleware, adminController.updateSettingsHandler);

router.get('/admin/api/customers', adminAuthMiddleware, adminController.getCustomersHandler);
router.get('/admin/api/transactions', adminAuthMiddleware, adminController.getTransactionsHandler);
router.get('/admin/api/stats', adminAuthMiddleware, adminController.getStatsHandler);
router.get(
  '/admin/api/iiko-operations',
  adminAuthMiddleware,
  adminController.getIikoOperationsHandler,
);

router.post('/admin/api/push/test', adminAuthMiddleware, adminController.pushTestHandler);
router.post('/admin/api/push/mass', adminAuthMiddleware, adminController.pushMassHandler);

router.post('/admin/api/customers/bonus', adminAuthMiddleware, adminController.addBonusHandler);
router.post(
  '/admin/api/customers/update',
  adminAuthMiddleware,
  adminController.updateCustomerHandler,
);
router.post(
  '/admin/api/customers/expire-inactive',
  adminAuthMiddleware,
  adminController.expireInactiveHandler,
);
router.post(
  '/admin/api/customers/notify-inactive',
  adminAuthMiddleware,
  adminController.notifyInactiveHandler,
);
router.delete(
  '/admin/api/customers/:id',
  adminAuthMiddleware,
  adminController.deleteCustomerHandler,
);
router.post('/admin/api/broadcast', adminAuthMiddleware, adminController.broadcastHandler);
router.post('/admin/api/upload', adminAuthMiddleware, adminController.uploadPhotoHandler);

router.get('/admin/api/stories', adminAuthMiddleware, adminController.getStoriesHandler);
router.post('/admin/api/stories', adminAuthMiddleware, adminController.addStoryHandler);
router.put('/admin/api/stories/:id', adminAuthMiddleware, adminController.updateStoryHandler);
router.delete('/admin/api/stories/:id', adminAuthMiddleware, adminController.deleteStoryHandler);

router.get('/admin/api/news', adminAuthMiddleware, adminController.getNewsHandler);
router.post('/admin/api/news', adminAuthMiddleware, adminController.addNewsHandler);
router.put('/admin/api/news/:id', adminAuthMiddleware, adminController.updateNewsHandler);
router.delete('/admin/api/news/:id', adminAuthMiddleware, adminController.deleteNewsHandler);

router.get('/admin/api/cities', adminAuthMiddleware, adminController.getCitiesHandler);
router.post('/admin/api/cities', adminAuthMiddleware, adminController.addCityHandler);
router.put('/admin/api/cities/:id', adminAuthMiddleware, adminController.updateCityHandler);
router.delete('/admin/api/cities/:id', adminAuthMiddleware, adminController.deleteCityHandler);

router.post('/admin/api/points', adminAuthMiddleware, adminController.addPointHandler);
router.put('/admin/api/points/:id', adminAuthMiddleware, adminController.updatePointHandler);
router.delete('/admin/api/points/:id', adminAuthMiddleware, adminController.deletePointHandler);

module.exports = router;
