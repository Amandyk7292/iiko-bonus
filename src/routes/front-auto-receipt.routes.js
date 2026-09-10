const router = require('express').Router();
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const {
  frontAutoReceiptPollSchema,
  frontAutoReceiptActionSchema,
  frontOfflineReceiptSchema,
} = require('../contracts/front-auto-receipt.contract');
const { listAutoReceipts, autoReceiptAction } = require('../services/front-auto-receipt.service');
router.post(
  '/api/loyalty/orders/receipts/poll',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontAutoReceiptPollSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await listAutoReceipts(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/orders/receipts/action',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontAutoReceiptActionSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await autoReceiptAction(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/inventory/offline-receipt',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontOfflineReceiptSchema }),
  async (req, res, next) => {
    try {
      const { recordOfflineReceipt } = require('../services/front-offline-receipt.service');
      res.json({ success: true, ...(await recordOfflineReceipt(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
