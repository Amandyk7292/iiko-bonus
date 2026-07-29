const {
  completeSubstitution,
  createSubstitution,
  getSubstitutionOptions,
} = require('../../services/order-substitution.service');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  orderSubstitutionCreateBodySchema,
  orderSubstitutionParamsSchema,
  orderSubstitutionRequestParamsSchema,
} = require('../../contracts/order-substitution.contract');

const registerOrderSubstitutionAdminRoutes = (router, { assertOrderAccess }) => {
  router.get(
    '/admin/api/orders/:id/substitution-options',
    validateRequest({ params: orderSubstitutionParamsSchema }),
    async (req, res) => {
      try {
        await assertOrderAccess(req, req.params.id);
        res.json({
          success: true,
          options: await getSubstitutionOptions(req.params.id),
        });
      } catch (error) {
        res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.post(
    '/admin/api/orders/:id/substitutions',
    validateRequest({
      params: orderSubstitutionParamsSchema,
      body: orderSubstitutionCreateBodySchema,
    }),
    async (req, res) => {
      try {
        if (
          req.body.action === 'remove_refund' &&
          !['admin', 'owner', 'branch_manager'].includes(req.admin.role)
        ) {
          return res.status(403).json({
            success: false,
            error: 'Возврат доступен владельцу или управляющему филиалом',
          });
        }
        await assertOrderAccess(req, req.params.id);
        const substitution = await createSubstitution(req.params.id, req.body, req.admin.sub);
        return res.status(201).json({ success: true, substitution });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.patch(
    '/admin/api/orders/:id/substitutions/:requestId/complete',
    validateRequest({ params: orderSubstitutionRequestParamsSchema }),
    async (req, res) => {
      try {
        await assertOrderAccess(req, req.params.id);
        const substitution = await completeSubstitution(
          req.params.id,
          req.params.requestId,
          req.admin.sub,
          { role: req.admin.role },
        );
        res.json({ success: true, substitution });
      } catch (error) {
        res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          ...(error.code && { code: error.code }),
        });
      }
    },
  );
};

module.exports = { registerOrderSubstitutionAdminRoutes };
