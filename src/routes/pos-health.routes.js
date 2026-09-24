const router = require('express').Router();
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const { posHealthHeartbeatSchema } = require('../contracts/pos-health.contract');
const { recordHeartbeat } = require('../services/pos-health.service');

router.post(
  '/api/loyalty/pos/health/heartbeat',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: posHealthHeartbeatSchema }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        ...(await recordHeartbeat(req.posBranchId, req.body)),
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
