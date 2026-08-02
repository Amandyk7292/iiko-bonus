const { supabase } = require('../../config/supabase');
const { applyAuditLogFilters, parseAuditLogQuery } = require('../../services/admin-audit.service');
const {
  createPartialRefund,
  getRefundOptions,
  previewPartialRefund,
} = require('../../services/partial-refund.service');
const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  auditLogQuerySchema,
  orderParamsSchema,
  partialRefundBodySchema,
  partialRefundPreviewBodySchema,
} = require('../../contracts/backend-safety.contract');

const canRefund = (admin) => ['admin', 'owner', 'branch_manager'].includes(admin?.role);
const publicError = (error, fallback) => (error.statusCode ? error.message : fallback);

function registerBackendSafetyAdminRoutes(router, { assertOrderAccess }) {
  router.get(
    '/admin/api/audit-logs',
    validateRequest({ query: auditLogQuerySchema }),
    async (req, res) => {
      try {
        const filters = parseAuditLogQuery(req.query);
        const from = (filters.page - 1) * filters.pageSize;
        let query = supabase.from('admin_audit_logs').select('*', { count: 'exact' });
        query = applyAuditLogFilters(query, filters);
        const { data, error, count } = await query
          .order('created_at', { ascending: false })
          .range(from, from + filters.pageSize - 1);
        if (error) throw error;
        return res.json({
          success: true,
          logs: data || [],
          total: count || 0,
          page: filters.page,
          pageSize: filters.pageSize,
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.statusCode ? error.message : 'Не удалось загрузить журнал аудита',
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.get('/admin/api/orders/:id/refund-options', async (req, res) => {
    try {
      await assertOrderAccess(req, req.params.id);
      res.json({ success: true, refund: await getRefundOptions(req.params.id) });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: publicError(error, 'Не удалось загрузить варианты возврата'),
      });
    }
  });

  router.post(
    '/admin/api/orders/:id/partial-refund',
    validateRequest({ params: orderParamsSchema, body: partialRefundBodySchema }),
    async (req, res) => {
      try {
        if (!canRefund(req.admin)) {
          return res.status(403).json({ success: false, error: 'Недостаточно прав для возврата' });
        }
        await assertOrderAccess(req, req.params.id);
        const refund = await createPartialRefund(req.params.id, req.body, req.admin.sub);
        return res.json({ success: true, refund });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось оформить частичный возврат'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );

  router.post(
    '/admin/api/orders/:id/partial-refund-preview',
    validateRequest({ params: orderParamsSchema, body: partialRefundPreviewBodySchema }),
    async (req, res) => {
      try {
        if (!canRefund(req.admin)) {
          return res.status(403).json({ success: false, error: 'Недостаточно прав для возврата' });
        }
        await assertOrderAccess(req, req.params.id);
        return res.json({
          success: true,
          preview: await previewPartialRefund(req.params.id, req.body),
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: publicError(error, 'Не удалось рассчитать частичный возврат'),
          ...(error.code && { code: error.code }),
        });
      }
    },
  );
}

module.exports = { registerBackendSafetyAdminRoutes };
