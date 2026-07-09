const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');

router.get('/', publicController.renderApp);
router.get('/admin', publicController.renderAdmin);
router.post('/api/register-iiko', publicController.registerIiko);

module.exports = router;
