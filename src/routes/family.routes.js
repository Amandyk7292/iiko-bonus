const router = require('express').Router();
const { customerAuthMiddleware } = require('../middlewares/customer-auth.middleware');
const { authRateLimit, publicApiRateLimit } = require('../middlewares/rate-limit.middleware');
const { validateRequest, emptyBodySchema } = require('../middlewares/validation.middleware');
const contract = require('../contracts/family.contract');
const { family } = require('../services/family.service');
const {
  childSessions,
  familyChildAuthMiddleware,
} = require('../services/family-child-session.service');
const { buildFamilyQr } = require('../utils/family-qr.util');
const { sendCustomerSession } = require('../utils/customer-session-cookie.util');
const handle = (work) => async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json({ success: true, ...(await work(req, res)) });
  } catch (error) {
    res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || 'FAMILY_UNAVAILABLE',
      error: error.statusCode
        ? error.message
        : 'Семейный аккаунт временно недоступен. Повторите позже.',
    });
  }
};
router.post(
  '/api/auth/family-child/login',
  authRateLimit,
  validateRequest({ body: contract.childLoginBody }),
  handle(async (req, res) => {
    const { context, session } = await childSessions.login(req.body.login, req.body.password);
    return { ...(await childSessions.profile(context)), ...sendCustomerSession(req, res, session) };
  }),
);
router.use('/api/family-child', publicApiRateLimit, familyChildAuthMiddleware);
router.get(
  '/api/family-child/profile',
  handle((req) => childSessions.profile(req.familyChildAuth)),
);
router.post(
  '/api/family-child/qr',
  validateRequest({ body: contract.qrBody }),
  handle(async (req) => {
    if (
      req.body.purpose === 'payment' &&
      Number(req.familyChildAuth.member.daily_limit_minor) <= 0
    ) {
      const { familyError } = require('../services/family.service');
      throw familyError(
        'Родитель ещё не разрешил оплату с личного счёта.',
        'FAMILY_PAYMENT_NOT_ALLOWED',
      );
    }
    return buildFamilyQr(
      { ...req.familyChildAuth.member, auth_version: req.familyChildAuth.member.qr_version },
      req.body.purpose,
    );
  }),
);
router.use('/api/customer/family', publicApiRateLimit, customerAuthMiddleware);
router.get(
  '/api/customer/family',
  handle((req) => family.summary(req.customerAuth.id)),
);
router.post(
  '/api/customer/family/invitations',
  validateRequest({ body: contract.inviteBody }),
  handle((req) => family.invite(req.customerAuth.id, req.body)),
);
router.post(
  '/api/customer/family/invitations/:id/answer',
  validateRequest({ params: contract.memberParams, body: contract.invitationAnswerBody }),
  handle((req) => family.answer(req.customerAuth.id, req.params.id, req.body.decision)),
);
router.post(
  '/api/customer/family/children',
  validateRequest({ body: contract.childBody }),
  handle((req) => family.createChild(req.customerAuth.id, req.body)),
);
router.patch(
  '/api/customer/family/members/:id',
  validateRequest({ params: contract.memberParams, body: contract.memberUpdateBody }),
  handle((req) => family.updateMember(req.customerAuth.id, req.params.id, req.body)),
);
router.post(
  '/api/customer/family/members/:id/remove',
  validateRequest({ params: contract.memberParams, body: emptyBodySchema }),
  handle((req) => family.removeMember(req.customerAuth.id, req.params.id)),
);
router.post(
  '/api/customer/family/qr',
  validateRequest({ body: contract.qrBody }),
  handle(async (req) => {
    const qr = await family.qrForCustomer(req.customerAuth.id, req.body.purpose);
    if (!qr) {
      const { familyError } = require('../services/family.service');
      throw familyError('Сначала примите приглашение в семью.', 'FAMILY_NOT_FOUND', 404);
    }
    return qr;
  }),
);
module.exports = router;
