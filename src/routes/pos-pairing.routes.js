const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { validateRequest } = require('../middlewares/validation.middleware');
const { activatePosSchema } = require('../contracts/pos-pairing.contract');
const { activatePosDevice } = require('../services/pos-pairing.service');
const router = express.Router();
const activationLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Повторите через 10 минут.' },
});

router.post(
  '/api/pos/activate',
  activationLimit,
  validateRequest({ body: activatePosSchema }),
  async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.json({
        success: true,
        ...(await activatePosDevice(req.body, ipKeyGenerator(req.ip))),
      });
    } catch (error) {
      return next(error);
    }
  },
);
module.exports = router;
