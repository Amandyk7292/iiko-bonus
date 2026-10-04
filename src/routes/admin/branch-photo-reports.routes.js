const { validateRequest, emptyBodySchema } = require('../../middlewares/validation.middleware');
const contracts = require('../../contracts/branch-photo-reports.contract');
const service = require('../../services/branch-photo-reports.service');
const devices = require('../../services/branch-photo-device-admin.service');
const { photoForAdmin } = require('../../services/branch-photo-storage.service');
const handle = (work) => async (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};
function registerBranchPhotoReportRoutes(router) {
  router.get(
    '/admin/api/photo-reports/devices',
    validateRequest({ query: contracts.devicesQuery }),
    handle((req) => devices.list(req.admin, req.query)),
  );
  router.post(
    '/admin/api/photo-reports/devices/:deviceId/approve',
    validateRequest({ params: contracts.deviceParams, body: contracts.approveDeviceBody }),
    handle((req) => devices.approve(req.admin, req.params.deviceId, req.body)),
  );
  router.post(
    '/admin/api/photo-reports/devices/:deviceId/revoke',
    validateRequest({ params: contracts.deviceParams, body: emptyBodySchema }),
    handle((req) => devices.revoke(req.admin, req.params.deviceId)),
  );
  router.get(
    '/admin/api/photo-reports',
    validateRequest({ query: contracts.calendarQuery }),
    handle((req) => service.calendar(req.admin, req.query)),
  );
  router.get(
    '/admin/api/photo-reports/branches/:branchId',
    validateRequest({ params: contracts.branchParams, query: contracts.detailQuery }),
    handle((req) => service.details(req.admin, req.params.branchId, req.query.date)),
  );
  router.post(
    '/admin/api/photo-reports/branches/:branchId/qr',
    validateRequest({ params: contracts.branchParams, body: emptyBodySchema }),
    handle((req) => service.ensureQr(req.admin, req.params.branchId)),
  );
  router.get(
    '/admin/api/photo-reports/photos/:photoId',
    validateRequest({ params: contracts.photoParams }),
    async (req, res, next) => {
      try {
        const image = await photoForAdmin(req.admin, req.params.photoId);
        res
          .set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
          .type('image/jpeg')
          .send(image);
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { registerBranchPhotoReportRoutes };
