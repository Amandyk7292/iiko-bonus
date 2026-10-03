const { cashierSignup } = require('../../services/cashier-signup.service');
const { querySchema } = require('./referral.routes');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
const { sendCashierError } = require('../public/cashier-signup.routes');

function registerCashierSignupAdminRoutes(router) {
  router.get(
    '/admin/api/bonus/cashier-race',
    validateRequest({ query: querySchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({
          success: true,
          ...(await cashierSignup.ranking({
            from: req.query.from,
            to: req.query.to,
            branches: branchScopeForAdmin(req.admin),
          })),
        });
      } catch (error) {
        sendCashierError(res, error);
      }
    },
  );
}
module.exports = { registerCashierSignupAdminRoutes };
