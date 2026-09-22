const { z, validateRequest } = require('../middlewares/validation.middleware');
const accounts = require('../services/personal-account.service');
const topups = require('../services/personal-account-topup.service');
const bank = require('../services/forte-widget.service');

function registerPersonalAccountRoutes(router) {
  const handle = (work) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      res.json(await work(req));
    } catch (error) {
      req.log?.error(
        { code: error.code || 'PERSONAL_ACCOUNT_UNAVAILABLE' },
        'Personal account request failed',
      );
      res.status(error.statusCode || 503).json({
        code: error.code || 'PERSONAL_ACCOUNT_UNAVAILABLE',
        error: error.statusCode
          ? error.message
          : 'Личный счёт временно недоступен. Повторите проверку.',
      });
    }
  };
  router.get(
    '/api/customer/personal-account',
    handle(async (req) => ({
      ...(await accounts.balance(req.customerAuth.id)),
      canTopUp: bank.availability(),
    })),
  );
  router.post(
    '/api/customer/personal-account/topups',
    validateRequest({
      body: z
        .object({
          requestId: z.uuid(),
          amount: z.number().int().min(100).max(200000),
          language: z.enum(['ru', 'kk', 'en']).default('ru'),
        })
        .strict(),
    }),
    handle((req) => topups.create(req.customerAuth.id, req.customerAuth.phone, req.body)),
  );
  router.get(
    '/api/customer/personal-account/topups/:id',
    validateRequest({ params: z.object({ id: z.uuid() }).strict() }),
    handle(async (req) => {
      let topup = await topups.find(req.params.id, req.customerAuth.id);
      if (!topup)
        throw accounts.accountError(
          'Пополнение не найдено',
          'PERSONAL_ACCOUNT_TOPUP_NOT_FOUND',
          404,
        );
      if (!['credited', 'reversed', 'failed', 'expired'].includes(topup.status)) {
        topup = await topups.sync(topup);
      }
      return topups.response(topup, req.query.language || 'ru', req.query.resume === '1');
    }),
  );
}
module.exports = { registerPersonalAccountRoutes };
