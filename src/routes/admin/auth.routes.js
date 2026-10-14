const {
  adminCsrfMiddleware,
  adminLoginHandler,
  adminLogoutHandler,
  adminSessionHandler,
  whatsappOperatorAccessHandler,
} = require('../../middlewares/auth.middleware');
const { adminLoginRateLimit } = require('../../middlewares/rate-limit.middleware');
const { emptyBodySchema, validateRequest } = require('../../middlewares/validation.middleware');
const {
  adminLoginBodySchema,
  whatsappOperatorAccessBodySchema,
} = require('../../contracts/admin-auth.contract');

const registerAdminAuthRoutes = (router, { auth, audit }) => {
  router.post(
    '/admin/api/login',
    adminLoginRateLimit,
    validateRequest({ body: adminLoginBodySchema }),
    adminLoginHandler,
  );
  router.post(
    '/admin/api/whatsapp/operator-access',
    adminLoginRateLimit,
    validateRequest({ body: whatsappOperatorAccessBodySchema }),
    adminCsrfMiddleware,
    whatsappOperatorAccessHandler,
  );
  router.post(
    '/admin/api/logout',
    auth,
    audit,
    validateRequest({ body: emptyBodySchema }),
    adminLogoutHandler,
  );
  router.get('/admin/api/session', auth, adminSessionHandler);
};

module.exports = { registerAdminAuthRoutes };
