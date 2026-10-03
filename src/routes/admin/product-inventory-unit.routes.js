const { validateRequest, z } = require('../../middlewares/validation.middleware');
const service = require('../../services/product-inventory-unit.service');

const params = z
  .object({
    productId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[0-9A-Za-z._:-]+$/),
  })
  .strict();
function registerProductInventoryUnitRoutes(router, { units = service } = {}) {
  const handle = (work) => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ success: true, ...(await work(req)) });
    } catch (error) {
      next(error);
    }
  };
  router.get(
    '/admin/api/menu/inventory-units/:productId',
    validateRequest({ params }),
    handle((req) => units.getProductInventoryUnit(req.admin, req.params.productId)),
  );
  router.put(
    '/admin/api/menu/inventory-units/:productId',
    (req, res, next) => {
      if (!service.canEditInventoryUnit(req.admin)) {
        return res.status(403).json({
          success: false,
          error: 'Единицу для всех филиалов меняет только администратор',
          code: 'PRODUCT_INVENTORY_UNIT_FORBIDDEN',
        });
      }
      return next();
    },
    validateRequest({ params, body: z.object({ unit: z.enum(['шт', 'кг']) }).strict() }),
    handle((req) => units.setProductInventoryUnit(req.admin, req.params.productId, req.body.unit)),
  );
}

module.exports = { registerProductInventoryUnitRoutes };
