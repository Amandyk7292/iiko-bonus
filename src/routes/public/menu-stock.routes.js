const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { supabase } = require('../../config/supabase');
const inventory = require('../../services/inventory.service');

const menuStockQuerySchema = z
  .object({
    branchId: z.string().uuid(),
    orderType: z.enum(['pickup', 'delivery', 'preorder']).default('pickup'),
  })
  .strict();

function registerMenuStockPublicRoutes(router) {
  router.get(
    '/api/public/menu-stock',
    validateRequest({ query: menuStockQuerySchema }),
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        const { branchId, orderType } = req.query;
        const { data: branch, error } = await supabase
          .from('bulka_locations')
          .select('active,pickup_enabled,delivery_enabled,preorder_enabled')
          .eq('id', branchId)
          .maybeSingle();
        if (error) throw error;
        if (!branch?.active)
          return res.status(404).json({ success: false, error: 'Филиал больше недоступен' });
        const enabled =
          orderType === 'delivery'
            ? branch.delivery_enabled === true
            : branch[`${orderType}_enabled`] !== false;
        const availability = await inventory.getBranchAvailability(branchId, {
          strict: true,
          preorder: orderType === 'preorder',
        });
        // Public quantities only: never expose raw counts, reserves or POS keys.
        const products = [...availability].map(([id, item]) => ({
          id,
          availableQuantity: item.availableQuantity,
          isAvailable: enabled && item.isAvailable,
          quantityStep: item.quantityStep,
          unit: item.unit,
        }));
        res.json({ success: true, branchId, orderType, enabled, products });
      } catch (error) {
        next(error);
      }
    },
  );
}

module.exports = { registerMenuStockPublicRoutes };
