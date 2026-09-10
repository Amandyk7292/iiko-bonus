const { validateRequest } = require('../../middlewares/validation.middleware');
const { pairingCodeSchema } = require('../../contracts/pos-pairing.contract');
const { issuePosPairingCode, listPosDevices } = require('../../services/pos-pairing.service');

const registerPosPairingAdminRoutes = (router) => {
  router.get('/admin/api/staff/pos/devices', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.json({
        success: true,
        ...(await listPosDevices(req.admin, String(req.query.pairingId || ''))),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.post(
    '/admin/api/staff/pos/pairing-code',
    validateRequest({ body: pairingCodeSchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        return res.json({ success: true, ...(await issuePosPairingCode(req.admin)) });
      } catch (error) {
        return next(error);
      }
    },
  );
};
module.exports = { registerPosPairingAdminRoutes };
