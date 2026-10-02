const { rateLimit } = require('express-rate-limit');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { sendApiError } = require('../../utils/http.util');
const {
  walkingChallengeSchema,
  walkingRegistrationSchema,
  walkingSyncSchema,
} = require('../../contracts/walking-rewards.contract');
const walking = require('../../services/walking-rewards.service');
const limiter = rateLimit({
  windowMs: 300000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.customerAuth.id,
  message: { code: 'WALKING_RATE_LIMIT', error: 'Попробуйте чуть позже' },
});
const reply = (handler) => async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json({ success: true, ...(await handler(req.customerAuth.id, req.body)) });
  } catch (error) {
    sendApiError(res, error, { success: false });
  }
};
function registerWalkingRewardRoutes(router) {
  router.get('/api/customer/walking', reply(walking.walkingStatus));
  router.post(
    '/api/customer/walking/challenge',
    limiter,
    validateRequest({ body: walkingChallengeSchema }),
    reply(walking.createWalkingChallenge),
  );
  router.post(
    '/api/customer/walking/device',
    limiter,
    validateRequest({ body: walkingRegistrationSchema }),
    reply(walking.registerWalkingDevice),
  );
  router.post(
    '/api/customer/walking/sync',
    limiter,
    validateRequest({ body: walkingSyncSchema }),
    reply(walking.syncWalkingSteps),
  );
}
module.exports = { registerWalkingRewardRoutes };
