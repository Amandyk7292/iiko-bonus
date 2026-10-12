const { validateRequest } = require('../../middlewares/validation.middleware');
const c = require('../../contracts/fortune.contract');
const { fortuneAdmin } = require('../../services/fortune-admin.service');
const handle = (work) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};
function registerFortuneAdminRoutes(router, service = fortuneAdmin) {
  router.get(
    '/admin/api/fortune/vouchers/:id',
    validateRequest({ params: c.idParams }),
    handle((req) => service.voucher(req.admin, req.params.id)),
  );
  router.get(
    '/admin/api/fortune',
    handle((req) => service.list(req.admin)),
  );
  router.post(
    '/admin/api/fortune/campaigns',
    validateRequest({ body: c.campaignCreate }),
    handle((req) => service.save(req.admin, null, req.body)),
  );
  router.patch(
    '/admin/api/fortune/campaigns/:id',
    validateRequest({ params: c.idParams, body: c.campaignPatch }),
    handle((req) => service.save(req.admin, req.params.id, req.body)),
  );
  router.get(
    '/admin/api/fortune/campaigns/:id/winners',
    validateRequest({ params: c.idParams, query: c.winnersQuery }),
    handle((req) => service.winners(req.admin, req.params.id, req.query)),
  );
  router.get(
    '/admin/api/fortune/campaigns/:id/branches/:branchId/qr',
    validateRequest({ params: c.qrParams }),
    handle((req) => service.qr(req.admin, req.params.id, req.params.branchId)),
  );
  router.post(
    '/admin/api/fortune/winners/:id/redeem',
    validateRequest({ params: c.idParams, body: c.empty }),
    handle((req) => service.redeem(req.admin, req.params.id)),
  );
}
module.exports = { registerFortuneAdminRoutes };
