const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');

router.get('/', publicController.renderApp);
router.get('/admin', publicController.renderAdmin);
router.post('/api/register-iiko', publicController.registerIiko);

router.get('/api/customer/profile', publicController.getProfile);
router.put('/api/customer/profile', publicController.updateProfile);
router.delete('/api/customer/profile', publicController.deleteProfile);

module.exports = router;
