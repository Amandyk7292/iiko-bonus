const express = require('express');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookMiddleware } = require('../middlewares/webhook.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const { frontInventorySnapshotSchema } = require('../contracts/front-inventory.contract');
const { applyFrontInventorySnapshot } = require('../services/front-inventory.service');
const router = express.Router();
const {
  frontStockHeartbeatSchema,
  frontStockSaleSchema,
  frontStockFinishSchema,
  frontStockRecountSchema,
} = require('../contracts/front-stock-guard.contract');
const {
  heartbeatFrontStock,
  authorizeFrontStock,
  finishFrontStock,
  recountFrontStock,
} = require('../services/front-stock-guard.service');
router.post(
  '/api/loyalty/inventory/recount',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontStockRecountSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await recountFrontStock(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
const {
  frontOrdersQuerySchema,
  frontOrderDecisionSchema,
  frontOrderPollSchema,
} = require('../contracts/front-order-inbox.contract');
const {
  listFrontOrders,
  decideFrontOrder,
  pollFrontOrders,
} = require('../services/front-order-inbox.service');

router.post(
  '/api/loyalty/orders/poll',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontOrderPollSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await pollFrontOrders(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/api/loyalty/orders/inbox',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ query: frontOrdersQuerySchema }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        ...(await listFrontOrders(req.posBranchId, {
          page: req.query.page,
          peek: req.query.peek === 'true',
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/orders/decision',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontOrderDecisionSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, order: await decideFrontOrder(req.posBranchId, req.body) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/api/loyalty/inventory/heartbeat',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontStockHeartbeatSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await heartbeatFrontStock(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/inventory/authorize',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontStockSaleSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await authorizeFrontStock(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/inventory/finish',
  webhookRateLimit,
  webhookMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontStockFinishSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await finishFrontStock(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);

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
