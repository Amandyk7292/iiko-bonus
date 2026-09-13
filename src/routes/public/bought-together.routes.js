const { validateRequest } = require('../../middlewares/validation.middleware');
const { customerProductParamsSchema } = require('../../contracts/customer-api.contract');
const { recommendations } = require('../../services/bought-together.service');

function registerBoughtTogetherRoutes(router) {
  router.get(
    '/api/public/products/:productId/bought-together',
    validateRequest({ params: customerProductParamsSchema }),
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, ...(await recommendations(req.params.productId)) });
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { registerBoughtTogetherRoutes };
