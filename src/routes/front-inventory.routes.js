const express = require('express');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookMiddleware } = require('../middlewares/webhook.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const { frontInventorySnapshotSchema } = require('../contracts/front-inventory.contract');
const { applyFrontInventorySnapshot } = require('../services/front-inventory.service');
const router = express.Router();

router.post(
  '/api/loyalty/inventory/snapshot',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontInventorySnapshotSchema }),
  async (req, res, next) => {
    try {
      const result = await applyFrontInventorySnapshot(req.posBranchId, req.body);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
