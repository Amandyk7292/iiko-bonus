const express = require('express');
const { posTransportMiddleware } = require('../middlewares/pos-transport.middleware');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const { frontOrderPollSchema } = require('../contracts/front-order-inbox.contract');
const {
  frontBoardQuerySchema,
  frontBoardActionSchema,
} = require('../contracts/front-order-board.contract');
const {
  listFrontBoard,
  pollFrontBoard,
  moveFrontOrder,
} = require('../services/front-order-board.service');
const router = express.Router();
router.post(
  '/api/loyalty/orders/board/poll',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontOrderPollSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await pollFrontBoard(req.posBranchId, req.body)) });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  '/api/loyalty/orders/board',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ query: frontBoardQuerySchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await listFrontBoard(req.posBranchId, req.query)) });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/api/loyalty/orders/board/action',
  webhookRateLimit,
  posTransportMiddleware,
  branchPosAuthMiddleware,
  validateRequest({ body: frontBoardActionSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, order: await moveFrontOrder(req.posBranchId, req.body) });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
