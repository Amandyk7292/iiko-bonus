const service = require('../../services/delivery-resolution.service');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  deliveryResolutionParamsSchema,
  deliveryResolutionReviewSchema,
} = require('../../contracts/delivery-resolution.contract');
function registerDeliveryResolutionAdminRoutes(
  router,
  { assertOrderAccess, resolution = service },
) {
  router.post(
    '/admin/api/orders/:id/delivery-resolution',
    validateRequest({
      params: deliveryResolutionParamsSchema,
      body: deliveryResolutionReviewSchema,
    }),
    async (req, res) => {
      try {
        if (!['owner', 'admin', 'branch_manager', 'cashier'].includes(req.admin.role))
          return res
            .status(403)
            .json({ success: false, error: 'Подтверждение доступно сотруднику точки' });
        await assertOrderAccess(req, req.params.id);
        return res.json({
          success: true,
          order: await resolution.reviewDeliveryResolution(req.params.id, req.body.action, {
            resolutionId: req.body.resolutionId,
            actor: req.admin.sub,
          }),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.statusCode ? error.message : 'Не удалось подтвердить замену доставки',
          ...(error.code && { code: error.code }),
        });
      }
    },
  );
}
module.exports = { registerDeliveryResolutionAdminRoutes };
