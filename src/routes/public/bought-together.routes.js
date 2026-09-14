const { validateRequest, z } = require('../../middlewares/validation.middleware');
const { customerProductParamsSchema } = require('../../contracts/customer-api.contract');
const { recommendations } = require('../../services/bought-together.service');

function registerBoughtTogetherRoutes(router) {
  router.get(
    '/api/public/products/:productId/bought-together',
    validateRequest({
      params: customerProductParamsSchema,
      query: z.object({ branchId: z.string().uuid().optional() }),
    }),
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        res.json({
          success: true,
          ...(await recommendations(req.params.productId, req.query.branchId)),
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { registerBoughtTogetherRoutes };
