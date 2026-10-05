const express = require('express');
const { validateRequest } = require('../middlewares/validation.middleware');
const { publicApiRateLimit } = require('../middlewares/rate-limit.middleware');
const { chatgptCartResolveSchema } = require('../contracts/chatgpt-cart.contract');
const { resolveCart } = require('../services/chatgpt-cart.service');

const router = express.Router();
router.post(
  '/api/public/chatgpt-cart/resolve',
  publicApiRateLimit,
  validateRequest({ body: chatgptCartResolveSchema }),
  async (req, res, next) => {
    try {
      const draft = await resolveCart(req.body.token);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, draft });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
