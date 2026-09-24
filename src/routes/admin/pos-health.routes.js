const {
  hasAdminAction,
  PAYMENT_ACTIONS,
  requireAdminAction,
} = require('../../middlewares/auth.middleware');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  posPolicyBodySchema,
  reconciliationActionSchema,
  reconciliationParamsSchema,
} = require('../../contracts/pos-health.contract');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
const { sendApiError } = require('../../utils/http.util');
const posHealth = require('../../services/pos-health.service');

function registerPosHealthAdminRoutes(router) {
  router.get('/admin/api/integrations/pos', async (req, res) => {
    try {
      res.json({
        success: true,
        canManage: hasAdminAction(req.admin, PAYMENT_ACTIONS.MANAGE),
        ...(await posHealth.getPosHealth(branchScopeForAdmin(req.admin))),
      });
    } catch (error) {
      sendApiError(res, error, { success: false });
    }
  });

  router.put(
    '/admin/api/integrations/pos/policy',
    requireAdminAction(PAYMENT_ACTIONS.MANAGE),
    validateRequest({ body: posPolicyBodySchema }),
    async (req, res) => {
      try {
        res.json({
          success: true,
          policy: await posHealth.savePolicy(req.body, req.admin?.sub),
        });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );

  router.post(
    '/admin/api/integrations/pos/reconciliation/:id/action',
    requireAdminAction(PAYMENT_ACTIONS.MANAGE),
    validateRequest({ params: reconciliationParamsSchema, body: reconciliationActionSchema }),
    async (req, res) => {
      try {
        res.json({
          success: true,
          reconciliation: await posHealth.actOnCase(
            req.params.id,
            req.body,
            req.admin,
            branchScopeForAdmin(req.admin),
          ),
        });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
}

module.exports = { registerPosHealthAdminRoutes };
