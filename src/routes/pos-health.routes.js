const router = require('express').Router();
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const { posHealthHeartbeatSchema } = require('../contracts/pos-health.contract');
const { recordHeartbeat } = require('../services/pos-health.service');
const { getLatestPluginUpdate } = require('../services/plugin-update.service');

router.get(
  '/api/loyalty/pos/updates/latest',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  async (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ success: true, release: await getLatestPluginUpdate() });
    } catch (error) {
      if (error.code === 'UPDATE_RELEASE_UNAVAILABLE') {
        return res.status(503).json({ success: false, code: error.code, error: error.message });
      }
      return next(error);
    }
  },
);

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
