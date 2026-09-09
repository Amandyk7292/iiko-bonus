const { z } = require('zod');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { hasAdminAction, requireAdminAction } = require('../../middlewares/auth.middleware');
const { deliveryAvailability } = require('../../services/delivery-availability.service');

const RESUME_ACTION = 'delivery.balance.resume';
const resumeBodySchema = z
  .object({ revision: z.uuid(), balanceConfirmed: z.literal(true) })
  .strict();

function registerDeliveryAvailabilityRoutes(router) {
  router.get('/admin/api/orders/delivery-availability', async (req, res, next) => {
    try {
      const config = await deliveryAvailability.get();
      res.json({ config, canResume: hasAdminAction(req.admin, RESUME_ACTION) });
    } catch (error) {
      next(error);
    }
  });
  router.put(
    '/admin/api/orders/delivery-availability',
    requireAdminAction(RESUME_ACTION),
    validateRequest({ body: resumeBodySchema }),
    async (req, res, next) => {
      try {
        const config = await deliveryAvailability.resume(
          req.body.revision,
          req.admin?.sub || 'admin',
        );
        res.json({ config, canResume: true });
      } catch (error) {
        next(error);
      }
    },
  );
}

module.exports = { registerDeliveryAvailabilityRoutes, resumeBodySchema };
