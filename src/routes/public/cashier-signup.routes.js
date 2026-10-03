const { cashierSignup, invitationUrl } = require('../../services/cashier-signup.service');
const { cashierInviteQr } = require('../../services/cashier-invite-qr.service');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  cashierInviteParamsSchema,
  cashierDirectoryQuerySchema,
} = require('../../contracts/cashier-signup.contract');
const { sendApiError } = require('../../utils/http.util');
const path = require('node:path');
const express = require('express');
const portalRoot = path.resolve(__dirname, '../../../public/cashier-qr');

function sendCashierError(res, error) {
  if (error?.code === 'STAFF_DIRECTORY_UNAVAILABLE') {
    return res.status(503).json({ success: false, error: error.message, code: error.code });
  }
  return sendApiError(res, error, { success: false });
}
function registerCashierSignupPublicRoutes(router) {
  router.use(
    '/cashier-qr-assets',
    express.static(portalRoot, {
      index: false,
      setHeaders: (res) => res.set('Cache-Control', 'no-store'),
    }),
  );
  router.get(['/cashier-qr', '/cashier-qr/'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(portalRoot, 'index.html'));
  });
  router.get(
    '/api/public/cashier-invites',
    validateRequest({ query: cashierDirectoryQuerySchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({ success: true, ...(await cashierSignup.list(req.query)) });
      } catch (error) {
        sendCashierError(res, error);
      }
    },
  );
  router.get(
    '/api/public/cashier-invites/:token',
    validateRequest({ params: cashierInviteParamsSchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({ success: true, ...(await cashierSignup.invitation(req.params.token)) });
      } catch (error) {
        sendCashierError(res, error);
      }
    },
  );
  router.get(
    '/api/public/cashier-invites/:token/qr',
    validateRequest({ params: cashierInviteParamsSchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        await cashierSignup.resolve(req.params.token);
        res.set({
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="bulka-cashier-qr.png"',
        });
        res.send(await cashierInviteQr(invitationUrl(req.params.token)));
      } catch (error) {
        sendCashierError(res, error);
      }
    },
  );
}
module.exports = { registerCashierSignupPublicRoutes, sendCashierError };
