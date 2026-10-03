const { validateRequest } = require('../../middlewares/validation.middleware');
const contract = require('../../contracts/cashier-production.contract');
const service = require('../../services/cashier-production.service');
const { z } = require('../../middlewares/validation.middleware');
const { supabase } = require('../../config/supabase');
const { cashierBranch } = require('../../services/cashier-catalog.service');
const handle = (work) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    cashierBranch(req.admin);
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};
function registerCashierProductionRoutes(router, { production = service, db = supabase } = {}) {
  router.post(
    '/admin/api/staff/reports/display-stock/reset',
    validateRequest({ body: z.object({ code: z.literal('0000') }).strict() }),
    handle(async (req) => {
      const branch = cashierBranch(req.admin);
      const { data: reset, error } = await db.rpc('reset_cashier_display_stock_report', {
        p_branch: branch,
        p_actor: String(req.admin.sub || 'cashier').slice(0, 160),
      });
      if (error) throw error;
      const { data, error: reportError } = await db.rpc('cashier_display_stock_report', {
        p_branch: branch,
        p_date: reset.date,
        p_offset: 0,
      });
      if (reportError) throw reportError;
      return data;
    }),
  );
  router.get(
    '/admin/api/staff/reports/production',
    validateRequest({ query: contract.reportQuery }),
    handle((req) => production.getCashierProductionReport(req.admin, req.query.date)),
  );
  router.post(
    '/admin/api/staff/reports/production',
    validateRequest({ body: contract.createBody }),
    handle((req) => production.submitCashierProductionAct(req.admin, req.body)),
  );
}
module.exports = { registerCashierProductionRoutes };
