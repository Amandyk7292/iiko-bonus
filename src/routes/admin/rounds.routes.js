const { validateRequest, emptyBodySchema } = require('../../middlewares/validation.middleware');
const c = require('../../contracts/rounds.contract');
const { rounds } = require('../../services/rounds.service');
const { sendMedia } = require('../../services/rounds-media.service');
const handle = (work) => async (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};
function registerRoundsAdminRoutes(router, service = rounds) {
  router.get(
    '/admin/api/rounds',
    validateRequest({ query: c.rangeQuery }),
    handle((req) => service.dashboard(req.admin, req.query)),
  );
  router.post(
    '/admin/api/rounds/inspectors',
    validateRequest({ body: c.inspectorCreate }),
    handle((req) => service.createInspector(req.admin, req.body)),
  );
  router.patch(
    '/admin/api/rounds/inspectors/:inspectorId',
    validateRequest({ params: c.inspectorParams, body: c.inspectorPatch }),
    handle((req) => service.patchInspector(req.admin, req.params.inspectorId, req.body)),
  );
  router.post(
    '/admin/api/rounds/inspectors/:inspectorId/password',
    validateRequest({ params: c.inspectorParams, body: emptyBodySchema }),
    handle((req) => service.resetPassword(req.admin, req.params.inspectorId)),
  );
  router.post(
    '/admin/api/rounds',
    validateRequest({ body: c.createRound }),
    handle((req) => service.create(req.admin, req.body)),
  );
  router.get(
    '/admin/api/rounds/media/:mediaId',
    validateRequest({ params: c.mediaParams }),
    async (req, res, next) => {
      try {
        await sendMedia(service, req.admin, req.params.mediaId, true, res, next);
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/admin/api/rounds/:roundId',
    validateRequest({ params: c.roundParams }),
    handle((req) => service.adminDetail(req.admin, req.params.roundId)),
  );
  router.post(
    '/admin/api/rounds/:roundId/cancel',
    validateRequest({ params: c.roundParams, body: emptyBodySchema }),
    handle((req) => service.cancel(req.admin, req.params.roundId)),
  );
}
module.exports = { registerRoundsAdminRoutes };
