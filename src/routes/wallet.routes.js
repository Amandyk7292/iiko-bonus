const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');
const { walletRateLimit } = require('../middlewares/rate-limit.middleware');

// Token generation (usually called from telegram bot internally, but exposed if needed)
router.post('/api/wallet/token', walletRateLimit, walletController.createToken);

// Wallet Choice UI
router.get('/wallet/:token', walletController.renderWalletChoice);

// Apple Wallet Download
router.get('/api/wallet/download/:token', walletController.downloadApplePass);

// Google Wallet Download via JWT
router.get('/api/wallet/google/download/:token', walletController.downloadGooglePass);

// Google Wallet Direct via Phone
router.get('/api/wallet/google/direct', walletController.directGooglePass);

// Apple Wallet Web Service API
router.post('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/pass.com.bulka.bonus/:serialNumber', walletController.handleAppleWalletWebService);
router.delete('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/pass.com.bulka.bonus/:serialNumber', walletController.handleAppleWalletWebService);
router.get('/api/wallet/v1/passes/pass.com.bulka.bonus/:serialNumber', walletController.handleAppleWalletWebService);
router.post('/api/wallet/v1/log', walletController.logAppleWalletError);

module.exports = router;
