const router = require('express').Router();
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const { startSchema, actionSchema } = require('../contracts/personal-account-pos.contract');
const { personalAccountPos } = require('../services/personal-account-pos.service');
router.use(
  '/api/loyalty/personal-account',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
);
router.post(
  '/api/loyalty/personal-account/start',
  validateRequest({ body: startSchema }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        payment: await personalAccountPos.start(req.posBranchId, req.body),
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/personal-account/action',
  validateRequest({ body: actionSchema }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        payment: await personalAccountPos.action(req.posBranchId, req.body),
      });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
