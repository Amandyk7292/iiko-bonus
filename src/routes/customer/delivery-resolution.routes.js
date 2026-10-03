const service = require('../../services/delivery-resolution.service');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  deliveryResolutionParamsSchema,
  deliveryResolutionChoiceSchema,
} = require('../../contracts/delivery-resolution.contract');
function registerDeliveryResolutionRoutes(router, resolution = service) {
  const errorResponse = (res, error) =>
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Не удалось обновить способ получения заказа',
      ...(error.code && { code: error.code }),
    });
  router.get(
    '/api/customer/orders/:id/delivery-resolution',
    validateRequest({ params: deliveryResolutionParamsSchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        res.json({
          success: true,
          ...(await resolution.getDeliveryResolution(req.customerAuth.id, req.params.id)),
        });
      } catch (error) {
        errorResponse(res, error);
      }
    },
  );
  router.post(
    '/api/customer/orders/:id/delivery-resolution',
    validateRequest({
      params: deliveryResolutionParamsSchema,
      body: deliveryResolutionChoiceSchema,
    }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        res.json({
          success: true,
          order: await resolution.chooseDeliveryResolution(
            req.customerAuth.id,
            req.params.id,
            req.body,
          ),
        });
      } catch (error) {
        errorResponse(res, error);
      }
    },
  );
}
module.exports = { registerDeliveryResolutionRoutes };
