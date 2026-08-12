const { validateRequest } = require('../../middlewares/validation.middleware');
const { staffPushHeartbeatRateLimit } = require('../../middlewares/rate-limit.middleware');
const {
  staffPushDeviceBodySchema,
  staffPushDeviceIdentitySchema,
} = require('../../contracts/staff-push.contract');
const {
  registerStaffPushDevice,
  sendStaffPushTest,
  staffPushDeviceStatus,
  touchStaffPushDeviceHeartbeat,
  unregisterStaffPushDevice,
} = require('../../services/staff-push.service');

const registerStaffPushAdminRoutes = (router) => {
  router.get(
    '/admin/api/staff/push-token',
    validateRequest({ query: staffPushDeviceIdentitySchema }),
    async (req, res, next) => {
      try {
        const enabled = await staffPushDeviceStatus(req.admin, req.query);
        return res.json({
          success: true,
          enabled,
          device: enabled
            ? { platform: req.query.platform, installationId: req.query.installationId }
            : null,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    '/admin/api/staff/push-token',
    validateRequest({ body: staffPushDeviceBodySchema }),
    async (req, res, next) => {
      try {
        const device = await registerStaffPushDevice(req.admin, req.body);
        return res.json({ success: true, device });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete(
    '/admin/api/staff/push-token',
    validateRequest({ body: staffPushDeviceIdentitySchema }),
    async (req, res, next) => {
      try {
        await unregisterStaffPushDevice(req.admin, req.body);
        return res.status(204).send();
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    '/admin/api/staff/push-heartbeat',
    staffPushHeartbeatRateLimit,
    validateRequest({ body: staffPushDeviceIdentitySchema }),
    async (req, res, next) => {
      try {
        const active = await touchStaffPushDeviceHeartbeat(req.admin, req.body);
        return res.json({ success: true, active });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    '/admin/api/staff/push-test',
    validateRequest({ body: staffPushDeviceIdentitySchema }),
    async (req, res, next) => {
      try {
        const delivery = await sendStaffPushTest(req.admin, req.body);
        return res.json({ success: true, delivery });
      } catch (error) {
        return next(error);
      }
    },
  );
};

module.exports = { registerStaffPushAdminRoutes };
