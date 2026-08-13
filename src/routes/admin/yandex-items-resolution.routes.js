const { adminMutationSchemas } = require('../../contracts/admin-mutations.contract');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { setAdminAuditContext } = require('../../services/admin-audit.service');
const realtime = require('../../services/realtime.service');
const yandexDelivery = require('../../services/yandex-delivery.service');

function registerYandexItemsResolutionAdminRoute(router, { assertAccess, assertOrderAccess }) {
  router.post(
    '/admin/api/dispatch/:orderId/yandex/resolve-items',
    validateRequest(adminMutationSchemas.yandexItemsResolution),
    async (req, res) => {
      try {
        assertAccess(req);
        const order = await assertOrderAccess(req, req.params.orderId);
        setAdminAuditContext(req, {
          actionCode: 'YANDEX_DELIVERY_ITEMS_RESOLVED',
          targetType: 'order',
          targetId: req.params.orderId,
          branchId: order.branch_id,
          reason: req.body.reason,
          context: {
            deliveryJobId: req.body.deliveryJobId,
            resolution: req.body.resolution,
            resolutionAttempted: true,
          },
        });
        const delivery = await yandexDelivery.resolveBusinessDeliveryItems(req.params.orderId, {
          deliveryJobId: req.body.deliveryJobId,
          resolution: req.body.resolution,
          reason: req.body.reason,
          actor: req.admin?.sub || req.admin?.username || 'unknown-admin',
          requestId: req.id || null,
        });
        setAdminAuditContext(req, {
          actionCode: 'YANDEX_DELIVERY_ITEMS_RESOLVED',
          targetType: 'order',
          targetId: req.params.orderId,
          branchId: order.branch_id,
          reason: req.body.reason,
          context: {
            deliveryJobId: delivery?.id || req.body.deliveryJobId,
            resolution: req.body.resolution,
            providerStatus: delivery?.status || null,
          },
        });
        realtime.publish(
          'delivery.updated',
          {
            orderId: req.params.orderId,
            deliveryJobId: delivery?.id || req.body.deliveryJobId,
            itemsResolution: req.body.resolution,
          },
          { adminOnly: true, branchId: order.branch_id },
        );
        res.json({ success: true, delivery });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
          success: false,
          error:
            statusCode >= 500
              ? 'Не удалось зафиксировать результат доставки. Повторите после проверки заказа.'
              : error.message,
          ...(statusCode < 500 && error.code && { code: error.code }),
          ...(statusCode < 500 && error.details && { details: error.details }),
        });
      }
    },
  );
  router.post(
    '/admin/api/dispatch/:orderId/yandex/resolve-create',
    validateRequest(adminMutationSchemas.yandexCreateReconciliation),
    async (req, res) => {
      try {
        assertAccess(req);
        const order = await assertOrderAccess(req, req.params.orderId);
        setAdminAuditContext(req, {
          actionCode: 'YANDEX_DELIVERY_CREATE_RECONCILED',
          targetType: 'order',
          targetId: req.params.orderId,
          branchId: order.branch_id,
          reason: req.body.reason,
          context: {
            deliveryJobId: req.body.deliveryJobId,
            resolution: req.body.resolution,
            externalOrderIdProvided: Boolean(req.body.externalOrderId),
            reconciliationAttempted: true,
          },
        });
        const delivery = await yandexDelivery.resolveBusinessCreateReconciliation(
          req.params.orderId,
          {
            ...req.body,
            actor: req.admin?.sub || req.admin?.username || 'unknown-admin',
            requestId: req.id || null,
          },
        );
        res.json({ success: true, delivery });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
          success: false,
          error:
            statusCode >= 500
              ? 'Не удалось зафиксировать проверку кабинета. Повторите после проверки заказа.'
              : error.message,
          ...(statusCode < 500 && error.code && { code: error.code }),
        });
      }
    },
  );
}

module.exports = { registerYandexItemsResolutionAdminRoute };
