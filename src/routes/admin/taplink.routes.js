const taplink = require('../../services/taplink.service');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  taplinkDraftBodySchema,
  taplinkPublishBodySchema,
} = require('../../contracts/taplink.contract');
const { setAdminAuditContext } = require('../../services/admin-audit.service');
const { requireAdminAction, TAPLINK_ACTIONS } = require('../../middlewares/auth.middleware');
const { primeTaplinkHtmlConfig } = require('../../services/taplink-html.service');

const sendTaplinkError = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message,
    ...(error.code && { code: error.code }),
  });

const adminSubject = (req) => req.admin?.sub || req.admin?.username || 'admin';

function registerTaplinkAdminRoutes(router, { service = taplink } = {}) {
  router.get('/admin/api/taplink', async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, page: await service.getAdminTaplink() });
    } catch (error) {
      sendTaplinkError(res, error);
    }
  });

  router.put(
    '/admin/api/taplink/draft',
    validateRequest({ body: taplinkDraftBodySchema }),
    async (req, res) => {
      try {
        setAdminAuditContext(req, {
          actionCode: 'taplink.draft.updated',
          targetType: 'taplink',
          targetId: 'main',
          context: { expectedRevision: req.body.expectedRevision },
        });
        res.json({
          success: true,
          page: await service.updateTaplinkDraft(
            req.body.config,
            req.body.expectedRevision,
            adminSubject(req),
          ),
        });
      } catch (error) {
        sendTaplinkError(res, error);
      }
    },
  );

  router.post(
    '/admin/api/taplink/publish',
    requireAdminAction(TAPLINK_ACTIONS.PUBLISH),
    validateRequest({ body: taplinkPublishBodySchema }),
    async (req, res) => {
      try {
        setAdminAuditContext(req, {
          actionCode: 'taplink.published',
          targetType: 'taplink',
          targetId: 'main',
          context: { expectedRevision: req.body.expectedRevision },
        });
        const page = await service.publishTaplink(req.body.expectedRevision, adminSubject(req));
        primeTaplinkHtmlConfig(page.published, page.publishedRevision);
        res.json({ success: true, page });
      } catch (error) {
        sendTaplinkError(res, error);
      }
    },
  );
}

module.exports = { registerTaplinkAdminRoutes, sendTaplinkError };
