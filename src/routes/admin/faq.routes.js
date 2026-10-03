const { faq } = require('../../services/faq.service');
const { faqBodySchema, faqParamsSchema } = require('../../contracts/faq.contract');
const { emptyBodySchema, validateRequest } = require('../../middlewares/validation.middleware');
const { setAdminAuditContext } = require('../../services/admin-audit.service');

function registerFaqAdminRoutes(router, { service = faq } = {}) {
  router.get('/admin/api/faq', async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, items: await service.listAdmin() });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/admin/api/faq',
    validateRequest({ body: faqBodySchema }),
    async (req, res, next) => {
      try {
        const item = await service.create(req.body);
        setAdminAuditContext(req, {
          actionCode: 'faq.created',
          targetType: 'loyalty_faq',
          targetId: item.id,
        });
        res.status(201).json({ success: true, item });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/api/faq/:id',
    validateRequest({ params: faqParamsSchema, body: faqBodySchema }),
    async (req, res, next) => {
      try {
        setAdminAuditContext(req, {
          actionCode: 'faq.updated',
          targetType: 'loyalty_faq',
          targetId: req.params.id,
        });
        res.json({ success: true, item: await service.update(req.params.id, req.body) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/api/faq/:id',
    validateRequest({ params: faqParamsSchema, body: emptyBodySchema }),
    async (req, res, next) => {
      try {
        setAdminAuditContext(req, {
          actionCode: 'faq.hidden',
          targetType: 'loyalty_faq',
          targetId: req.params.id,
        });
        res.json({ success: true, item: await service.hide(req.params.id) });
      } catch (error) {
        next(error);
      }
    },
  );
}

module.exports = { registerFaqAdminRoutes };
