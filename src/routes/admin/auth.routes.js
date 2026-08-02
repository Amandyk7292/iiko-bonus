const {
  adminCsrfMiddleware,
  adminLoginHandler,
  adminLogoutHandler,
  adminPhoneLoginRequestHandler,
  adminPhoneLoginVerifyHandler,
  adminSessionHandler,
  whatsappOperatorAccessHandler,
} = require('../../middlewares/auth.middleware');
const { adminLoginRateLimit } = require('../../middlewares/rate-limit.middleware');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  adminLoginBodySchema,
  adminPhoneRequestBodySchema,
  adminPhoneVerifyBodySchema,
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
    '/admin/api/login/phone/request',
    adminLoginRateLimit,
    validateRequest({ body: adminPhoneRequestBodySchema }),
    adminPhoneLoginRequestHandler,
  );
  router.post(
    '/admin/api/login/phone/verify',
    adminLoginRateLimit,
    validateRequest({ body: adminPhoneVerifyBodySchema }),
    adminPhoneLoginVerifyHandler,
  );
  router.post(
    '/admin/api/whatsapp/operator-access',
    adminLoginRateLimit,
    validateRequest({ body: whatsappOperatorAccessBodySchema }),
    adminCsrfMiddleware,
    whatsappOperatorAccessHandler,
  );
  router.post('/admin/api/logout', auth, audit, adminLogoutHandler);
  router.get('/admin/api/session', auth, adminSessionHandler);
};

module.exports = { registerAdminAuthRoutes };
