const adminController = require('../../controllers/admin.controller');
const {
  adminAuthMiddleware,
  requireAdminAction,
  CUSTOMER_ACTIONS,
} = require('../../middlewares/auth.middleware');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  adminCustomerBonusBodySchema,
  adminCustomerBulkBodySchema,
  adminCustomerListQuerySchema,
  adminCustomerParamsSchema,
  adminCustomerUpdateBodySchema,
} = require('../../contracts/admin-customer.contract');
const { supabase } = require('../../config/supabase');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
const { badRequest, notFound } = require('../../utils/app-error.util');

const assertCustomerAccess = async (req, customerId) => {
  const allowedBranches = branchScopeForAdmin(req.admin);
  if (!allowedBranches.length) return;
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id')
    .eq('customer_id', customerId)
    .in('branch_id', allowedBranches)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('CUSTOMER_NOT_FOUND', 'Клиент не найден');
};

const customerAccessMiddleware = async (req, _res, next) => {
  try {
    const customerId = req.params.id || req.body?.customerId;
    if (!customerId) {
      return next(badRequest('CUSTOMER_ID_REQUIRED', 'customerId is required'));
    }
    await assertCustomerAccess(req, customerId);
    return next();
  } catch (error) {
    return next(error);
  }
};

const registerCustomerAdminRoutes = (router) => {
  router.get(
    '/admin/api/customers',
    adminAuthMiddleware,
    requireAdminAction(CUSTOMER_ACTIONS.READ),
    validateRequest({ query: adminCustomerListQuerySchema }),
    adminController.getCustomersHandler,
  );
  router.post(
    '/admin/api/customers/bonus',
    adminAuthMiddleware,
    requireAdminAction(CUSTOMER_ACTIONS.ADJUST_BONUS),
    validateRequest({ body: adminCustomerBonusBodySchema }),
    customerAccessMiddleware,
    adminController.addBonusHandler,
  );
  router.post(
    '/admin/api/customers/update',
    adminAuthMiddleware,
    requireAdminAction(CUSTOMER_ACTIONS.UPDATE),
    validateRequest({ body: adminCustomerUpdateBodySchema }),
    customerAccessMiddleware,
    adminController.updateCustomerHandler,
  );
  router.post(
    '/admin/api/customers/expire-inactive',
    adminAuthMiddleware,
    requireAdminAction(CUSTOMER_ACTIONS.BULK_EXPIRE),
    validateRequest({ body: adminCustomerBulkBodySchema }),
    adminController.expireInactiveHandler,
  );
  router.post(
    '/admin/api/customers/notify-inactive',
    adminAuthMiddleware,
    requireAdminAction(CUSTOMER_ACTIONS.BULK_NOTIFY),
    validateRequest({ body: adminCustomerBulkBodySchema }),
    adminController.notifyInactiveHandler,
  );
  router.delete(
    '/admin/api/customers/:id',
    adminAuthMiddleware,
    requireAdminAction(CUSTOMER_ACTIONS.DELETE),
    validateRequest({ params: adminCustomerParamsSchema }),
    customerAccessMiddleware,
    adminController.deleteCustomerHandler,
  );
};

module.exports = {
  assertCustomerAccess,
  customerAccessMiddleware,
  registerCustomerAdminRoutes,
};
