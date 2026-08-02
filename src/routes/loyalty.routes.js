const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyalty.controller');
const { webhookMiddleware } = require('../middlewares/webhook.middleware');
const { webhookRateLimit } = require('../middlewares/rate-limit.middleware');
const { branchPosAuthMiddleware } = require('../middlewares/branch-pos-auth.middleware');
const { validateRequest } = require('../middlewares/validation.middleware');
const {
  loyaltyApplyBodySchema,
  loyaltyCalculateBodySchema,
  loyaltyCancelBodySchema,
  loyaltyCommitBodySchema,
  loyaltyCustomerBodySchema,
  loyaltyReserveBodySchema,
  loyaltySearchBodySchema,
  pickupHandoffPluginBodySchema,
  giftCardValidateBodySchema,
  giftCardReserveBodySchema,
  giftCardReservationMutationBodySchema,
} = require('../contracts/loyalty.contract');
const { verifyPluginPickupHandoff } = require('../services/pickup-handoff.service');
const {
  cancelGiftCardForPos,
  commitGiftCardForPos,
  reserveGiftCardForPos,
  validateGiftCardForPos,
} = require('../services/gift-card-pos.service');

router.use('/api/loyalty', webhookRateLimit, webhookMiddleware);
router.get('/api/loyalty/config-check', loyaltyController.configCheck);
router.post(
  '/api/loyalty/customer',
  validateRequest({ body: loyaltyCustomerBodySchema }),
  loyaltyController.getCustomerInfo,
);
router.post(
  '/api/loyalty/search',
  validateRequest({ body: loyaltySearchBodySchema }),
  loyaltyController.searchCustomersHandler,
);
router.post(
  '/api/loyalty/calculate',
  validateRequest({ body: loyaltyCalculateBodySchema }),
  loyaltyController.calculateBonus,
);
router.post(
  '/api/loyalty/apply',
  validateRequest({ body: loyaltyApplyBodySchema }),
  loyaltyController.applyBonus,
);
router.post(
  '/api/loyalty/reserve',
  validateRequest({ body: loyaltyReserveBodySchema }),
  loyaltyController.reserveBonus,
);
router.post(
  '/api/loyalty/commit',
  validateRequest({ body: loyaltyCommitBodySchema }),
  loyaltyController.commitReservedBonus,
);
router.post(
  '/api/loyalty/cancel',
  validateRequest({ body: loyaltyCancelBodySchema }),
  loyaltyController.cancelReservedBonus,
);
router.post(
  '/api/loyalty/pickup-handoff/verify',
  validateRequest({ body: pickupHandoffPluginBodySchema }),
  branchPosAuthMiddleware,
  async (req, res) => {
    try {
      const handoff = await verifyPluginPickupHandoff(req.body);
      return res.json({ success: true, handoff });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Pickup handoff failed',
        ...(error.code && { code: error.code }),
        ...(error.retryAt && { retryAt: error.retryAt }),
        ...(Number.isInteger(error.attemptsRemaining) && {
          attemptsRemaining: error.attemptsRemaining,
        }),
      });
    }
  },
);
router.post(
  '/api/loyalty/gift-cards/validate',
  validateRequest({ body: giftCardValidateBodySchema }),
  branchPosAuthMiddleware,
  async (req, res) => {
    try {
      return res.json({
        success: true,
        card: await validateGiftCardForPos(req.body),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Gift card validation failed',
        ...(error.code && { code: error.code }),
      });
    }
  },
);
router.post(
  '/api/loyalty/gift-cards/reserve',
  validateRequest({ body: giftCardReserveBodySchema }),
  branchPosAuthMiddleware,
  async (req, res) => {
    try {
      return res.json({
        success: true,
        reservation: await reserveGiftCardForPos(req.body),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Gift card reservation failed',
        ...(error.code && { code: error.code }),
      });
    }
  },
);
router.post(
  '/api/loyalty/gift-cards/commit',
  validateRequest({ body: giftCardReservationMutationBodySchema }),
  branchPosAuthMiddleware,
  async (req, res) => {
    try {
      return res.json({
        success: true,
        reservation: await commitGiftCardForPos(req.body),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Gift card commit failed',
        ...(error.code && { code: error.code }),
      });
    }
  },
);
router.post(
  '/api/loyalty/gift-cards/cancel',
  validateRequest({ body: giftCardReservationMutationBodySchema }),
  branchPosAuthMiddleware,
  async (req, res) => {
    try {
      return res.json({
        success: true,
        reservation: await cancelGiftCardForPos(req.body),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Gift card cancellation failed',
        ...(error.code && { code: error.code }),
      });
    }
  },
);

module.exports = router;
