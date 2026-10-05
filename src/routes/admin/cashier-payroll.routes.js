const { cashierPayroll } = require('../../services/cashier-payroll.service');
const {
  payrollReportQuerySchema,
  payrollPaymentBodySchema,
} = require('../../contracts/cashier-payroll.contract');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { branchScopeForAdmin, hasGlobalBranchAccess } = require('../../utils/admin-scope.util');
const { sendApiError } = require('../../utils/http.util');
const { setAdminAuditContext } = require('../../services/admin-audit.service');

function registerCashierPayrollAdminRoutes(router) {
  router.get(
    '/admin/api/bonus/cashier-payroll',
    validateRequest({ query: payrollReportQuerySchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({
          success: true,
          ...(await cashierPayroll.statement({
            month: req.query.month,
            branches: branchScopeForAdmin(req.admin),
          })),
          canMarkPaid: hasGlobalBranchAccess(req.admin),
        });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
  router.post(
    '/admin/api/bonus/cashier-payroll/payments',
    (req, res, next) =>
      hasGlobalBranchAccess(req.admin)
        ? next()
        : res.status(403).json({
            success: false,
            error: 'Отмечать выплаты может только администратор.',
            code: 'CASHIER_PAYROLL_PAYMENT_FORBIDDEN',
          }),
    validateRequest({
      query: payrollReportQuerySchema.pick({}).strict(),
      body: payrollPaymentBodySchema,
    }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const result = await cashierPayroll.markPaid({
          ...req.body,
          actor: req.admin.sub,
          branches: branchScopeForAdmin(req.admin),
        });
        setAdminAuditContext(req, {
          actionCode: 'cashier.payroll.mark_paid',
          targetType: 'cashier_payroll_payment',
          targetId: result.payment.id,
          amountChange: result.replayed ? 0 : result.payment.amount,
          context: {
            month: req.body.month,
            rowKey: req.body.rowKey,
            registrations: result.payment.registrations,
            replayed: result.replayed,
          },
        });
        res.json({
          success: true,
          ...result,
        });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
}

module.exports = { registerCashierPayrollAdminRoutes };
