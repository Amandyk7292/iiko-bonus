const { z } = require('zod');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { requireAdminAction } = require('../../middlewares/auth.middleware');
const { deliveryBudget } = require('../../services/delivery-budget.service');

const adjustmentSchema = z
  .object({
    requestId: z.uuid(),
    revision: z.number().int().positive(),
    amount: z.number().min(0).max(100_000_000).multipleOf(0.01),
    mode: z.enum(['top_up', 'balance']),
    confirmed: z.literal(true),
  })
  .strict();

function registerDeliveryBudgetRoutes(router) {
  const owner = requireAdminAction('delivery.balance.resume');
  router.get('/admin/api/orders/delivery-budget', owner, async (_req, res, next) => {
    try {
      res.json(await deliveryBudget.snapshot());
    } catch (error) {
      next(error);
    }
  });
  router.put(
    '/admin/api/orders/delivery-budget',
    owner,
    validateRequest({ body: adjustmentSchema }),
    async (req, res, next) => {
      try {
        res.json(await deliveryBudget.adjust(req.body, req.admin.sub));
      } catch (error) {
        next(error);
      }
    },
  );
}

module.exports = { registerDeliveryBudgetRoutes, adjustmentSchema };
