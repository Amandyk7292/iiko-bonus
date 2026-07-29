const { emptyBodySchema, validateRequest } = require('../../middlewares/validation.middleware');
const {
  adminGlobalSearchDetailParamsSchema,
  adminGlobalSearchQuerySchema,
  branchPosCredentialParamsSchema,
  orderUuidParamsSchema,
  pickupHandoffVerifyBodySchema,
} = require('../../contracts/business-foundation.contract');
const { globalSearch, globalSearchDetail } = require('../../services/admin-global-search.service');
const { verifyPickupHandoff } = require('../../services/pickup-handoff.service');
const {
  getBranchPosCredentialStatus,
  rotateBranchPosCredential,
} = require('../../services/branch-pos-credential.service');

const publicError = (error, fallback) => (error.statusCode ? error.message : fallback);

function registerBusinessFoundationAdminRoutes(router, { assertOrderAccess }) {
  const adminCanReadBranch = (req, branchId) => {
    if (['owner', 'admin'].includes(req.admin?.role)) return true;
    return (
      Array.isArray(req.admin?.branchIds) && req.admin.branchIds.map(String).includes(branchId)
    );
  };

  router.get(
    '/admin/api/global-search',
    validateRequest({ query: adminGlobalSearchQuerySchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          results: await globalSearch(req.admin, req.query),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось выполнить поиск'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.get(
    '/admin/api/global-search/:type/:id',
    validateRequest({ params: adminGlobalSearchDetailParamsSchema }),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          detail: await globalSearchDetail(req.admin, req.params.type, req.params.id),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось загрузить карточку'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.post(
    '/admin/api/orders/:id/pickup-handoff/verify',
    validateRequest({
      params: orderUuidParamsSchema,
      body: pickupHandoffVerifyBodySchema,
    }),
    async (req, res) => {
      try {
        if (!['owner', 'admin', 'branch_manager', 'operator'].includes(req.admin?.role)) {
          return res.status(403).json({
            success: false,
            error: 'Недостаточно прав для выдачи заказа',
            code: 'PICKUP_HANDOFF_FORBIDDEN',
          });
        }
        const scopedOrder = await assertOrderAccess(req, req.params.id);
        const handoff = await verifyPickupHandoff({
          orderId: req.params.id,
          branchId: scopedOrder.branch_id,
          token: req.body.token || null,
          pin: req.body.pin || null,
          verifiedBy: req.admin.sub || req.admin.username || 'admin',
        });
        return res.json({ success: true, handoff });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось подтвердить выдачу'),
          ...(error.code && { code: error.code }),
          ...(error.retryAt && { retryAt: error.retryAt }),
          ...(Number.isInteger(error.attemptsRemaining) && {
            attemptsRemaining: error.attemptsRemaining,
          }),
        });
      }
    },
  );

  router.get(
    '/admin/api/locations/:id/pos-credential',
    validateRequest({ params: branchPosCredentialParamsSchema }),
    async (req, res) => {
      try {
        if (!adminCanReadBranch(req, req.params.id)) {
          return res.status(404).json({ success: false, error: 'Филиал не найден' });
        }
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          credential: await getBranchPosCredentialStatus(req.params.id),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось проверить ключ кассового плагина'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.post(
    '/admin/api/locations/:id/pos-credential/rotate',
    validateRequest({
      params: branchPosCredentialParamsSchema,
      body: emptyBodySchema,
    }),
    async (req, res) => {
      try {
        if (!['owner', 'admin'].includes(req.admin?.role)) {
          return res.status(403).json({
            success: false,
            error: 'Только владелец или администратор может заменить ключ кассы',
            code: 'BRANCH_POS_ROTATION_FORBIDDEN',
          });
        }
        res.set('Cache-Control', 'private, no-store');
        return res.status(201).json({
          success: true,
          credential: await rotateBranchPosCredential(
            req.params.id,
            req.admin.sub || req.admin.username || 'admin',
          ),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось заменить ключ кассового плагина'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );
}

module.exports = { registerBusinessFoundationAdminRoutes };
