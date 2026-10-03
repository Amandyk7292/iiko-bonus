const { faq } = require('../../services/faq.service');
const { faqQuerySchema } = require('../../contracts/faq.contract');
const { validateRequest } = require('../../middlewares/validation.middleware');

function registerFaqPublicRoutes(router, { service = faq } = {}) {
  router.get(
    '/api/public/faq',
    validateRequest({ query: faqQuerySchema }),
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, items: await service.listPublic(req.query.lang) });
      } catch (error) {
        next(error);
      }
    },
  );
}

module.exports = { registerFaqPublicRoutes };
