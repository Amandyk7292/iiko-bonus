const {
  hasAdminAction,
  PAYMENT_ACTIONS,
  requireAdminAction,
} = require('../../middlewares/auth.middleware');
const { getIntegrationHealth } = require('../../services/integration-health.service');
const paymentOperations = require('../../services/payment-operations.service');

const paymentErrorResponse = (res, error, fallback, fallbackCode) =>
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.statusCode ? error.message : fallback,
    code: error.code || fallbackCode,
  });

function registerPaymentIntegrationAdminRoutes(router) {
  router.get('/admin/api/integrations/status', async (req, res) => {
    try {
      res.json({
        success: true,
        ...(await getIntegrationHealth({
          canManagePayments: hasAdminAction(req.admin, PAYMENT_ACTIONS.MANAGE),
        })),
      });
    } catch (error) {
      paymentErrorResponse(
        res,
        error,
        'Не удалось проверить платёжные сервисы',
        'PAYMENT_DIAGNOSTICS_FAILED',
      );
    }
  });

  router.put(
    '/admin/api/integrations/payments/widget',
    requireAdminAction(PAYMENT_ACTIONS.MANAGE),
    async (req, res) => {
      try {
        await paymentOperations.setWidgetEnabled(req.body?.enabled, {
          updatedBy: req.admin?.sub || '',
        });
        res.json({
          success: true,
          payments: await paymentOperations.getDiagnostics({ canManage: true }),
        });
      } catch (error) {
        paymentErrorResponse(
          res,
          error,
          'Не удалось изменить режим оплаты',
          'PAYMENT_WIDGET_MODE_SAVE_FAILED',
        );
      }
    },
  );

  router.post(
    '/admin/api/integrations/payments/probe',
    requireAdminAction(PAYMENT_ACTIONS.MANAGE),
    async (_req, res) => {
      try {
        await paymentOperations.runSafeProbe();
        res.json({
          success: true,
          payments: await paymentOperations.getDiagnostics({ canManage: true }),
        });
      } catch (error) {
        paymentErrorResponse(
          res,
          error,
          'Безопасная проверка не завершилась',
          'PAYMENT_PROBE_FAILED',
        );
      }
    },
  );
}

module.exports = { registerPaymentIntegrationAdminRoutes };
