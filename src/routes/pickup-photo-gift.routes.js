const router = require('express').Router();
const crypto = require('node:crypto');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const contract = require('../contracts/pickup-photo-gift.contract');
const photos = require('../services/pickup-photo-gift.service');
const auth = [webhookRateLimit, posTransportMiddleware, branchPosAuthMiddleware];
const terminalMatches = (req, res, next) => {
  const terminalId = req.body?.terminalId || req.query.terminalId;
  if (req.pairedPos && req.pairedPos.terminal_id !== terminalId) {
    return res.status(403).json({ success: false, code: 'POS_DEVICE_UNAUTHORIZED' });
  }
  return next();
};
router.post(
  '/api/loyalty/orders/photo-gifts/poll',
  ...auth,
  validateRequest({ body: contract.pickupPhotoPollSchema }),
  terminalMatches,
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await photos.listPrintJobs(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/orders/photo-gifts/action',
  ...auth,
  validateRequest({ body: contract.pickupPhotoActionSchema }),
  terminalMatches,
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await photos.printAction(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  '/api/loyalty/orders/photo-gifts/:orderId/image',
  ...auth,
  validateRequest({
    params: contract.pickupPhotoPrintParamsSchema,
    query: contract.pickupPhotoPrintQuerySchema,
  }),
  terminalMatches,
  async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const image = await photos.printImage(
        req.posBranchId,
        req.params.orderId,
        req.query.terminalId,
        req.query.widthDots,
      );
      const hash = crypto.createHash('sha256').update(image).digest('hex');
      res.setHeader('X-Content-SHA256', hash);
      res.setHeader('ETag', `"${hash}"`);
      res.type('image/png').send(image);
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
