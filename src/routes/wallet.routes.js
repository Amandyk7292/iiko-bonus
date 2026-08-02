const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');
const { walletRateLimit } = require('../middlewares/rate-limit.middleware');
const { customerAuthMiddleware } = require('../middlewares/customer-auth.middleware');
const { emptyBodySchema, validateRequest } = require('../middlewares/validation.middleware');
const {
  appleWalletLogBodySchema,
  appleWalletRegistrationBodySchema,
  appleWalletRegistrationParamsSchema,
} = require('../contracts/wallet.contract');
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Token generation (usually called from telegram bot internally, but exposed if needed)
router.post(
  '/api/wallet/token',
  walletRateLimit,
  customerAuthMiddleware,
  validateRequest({ body: emptyBodySchema }),
  asyncHandler(walletController.createToken),
);

// Wallet Choice UI
router.get('/wallet/:token', walletRateLimit, asyncHandler(walletController.renderWalletChoice));

// Apple Wallet Download
router.get(
  '/api/wallet/download/:token',
  walletRateLimit,
  asyncHandler(walletController.downloadApplePass),
);

// Google Wallet Download via JWT
router.get(
  '/api/wallet/google/download/:token',
  walletRateLimit,
  asyncHandler(walletController.downloadGooglePass),
);

// Apple Wallet Web Service API
router.post(
  '/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
  walletRateLimit,
  validateRequest({
    params: appleWalletRegistrationParamsSchema,
    body: appleWalletRegistrationBodySchema,
  }),
  asyncHandler(walletController.handleAppleWalletWebService),
);
router.delete(
  '/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
  walletRateLimit,
  validateRequest({ params: appleWalletRegistrationParamsSchema }),
  asyncHandler(walletController.handleAppleWalletWebService),
);
router.get(
  '/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier',
  walletRateLimit,
  asyncHandler(walletController.listAppleWalletRegistrations),
);
router.get(
  '/api/wallet/v1/passes/:passTypeIdentifier/:serialNumber',
  walletRateLimit,
  asyncHandler(walletController.handleAppleWalletWebService),
);
router.post(
  '/api/wallet/v1/log',
  walletRateLimit,
  validateRequest({ body: appleWalletLogBodySchema }),
  asyncHandler(walletController.logAppleWalletError),
);

module.exports = router;
