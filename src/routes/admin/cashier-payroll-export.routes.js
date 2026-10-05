const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { payrollMonthSchema } = require('../../contracts/cashier-payroll.contract');
const { cashierPayroll } = require('../../services/cashier-payroll.service');
const { payrollWorkbook } = require('../../services/cashier-payroll-export.service');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
const { sendApiError } = require('../../utils/http.util');
const querySchema = z
  .object({
    month: payrollMonthSchema,
    city: z.string().trim().max(120).optional(),
    pointId: z
      .string()
      .regex(/^(?:[0-9]{1,19}|__unassigned__)$/)
      .optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

function registerCashierPayrollExportRoutes(router) {
  router.get(
    '/admin/api/bonus/cashier-payroll/export',
    validateRequest({ query: querySchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const statement = await cashierPayroll.statement({
          month: req.query.month,
          branches: branchScopeForAdmin(req.admin),
        });
        res.set(
          'Content-Disposition',
          `attachment; filename="bulka-premii-${req.query.month}.xlsx"`,
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(payrollWorkbook(statement, req.query));
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
}
module.exports = { registerCashierPayrollExportRoutes };
