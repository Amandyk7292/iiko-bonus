const router = require('express').Router();
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const {
  snapshotSchema,
  pollQuerySchema,
  emptyQuerySchema,
  actionSchema,
} = require('../contracts/virtual-pos.contract');
const virtualPos = require('../services/virtual-pos.service');

router.use(
  '/api/loyalty/virtual-pos',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
);
router.post(
  '/api/loyalty/virtual-pos/snapshot',
  validateRequest({ body: snapshotSchema, query: emptyQuerySchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await virtualPos.snapshot(req)) });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  '/api/loyalty/virtual-pos/poll',
  validateRequest({ query: pollQuerySchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await virtualPos.poll(req)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/virtual-pos/action',
  validateRequest({ body: actionSchema, query: emptyQuerySchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await virtualPos.action(req)) });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
