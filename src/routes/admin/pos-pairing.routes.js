const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  pairingCodeSchema,
  unlinkPosParamsSchema,
} = require('../../contracts/pos-pairing.contract');
const {
  issuePosPairingCode,
  listPosDevices,
  unlinkPosDevice,
} = require('../../services/pos-pairing.service');

const registerPosPairingAdminRoutes = (router) => {
  router.get('/admin/api/staff/order-sales-report', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { orderReportPeriod } = require('../../utils/order-report-period.util');
      const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
      const { supabase } = require('../../config/supabase');
      const period = orderReportPeriod(req.query.dateFrom, req.query.dateTo);
      if (!period) return res.status(400).json({ error: 'Выберите период отчёта' });
      const { data, error } = await supabase.rpc('staff_order_sales_report', {
        p_from: period.start,
        p_to: period.end,
        p_branches: branchScopeForAdmin(req.admin),
      });
      if (error) throw error;
      res.json({ success: true, report: data });
    } catch (error) {
      next(error);
    }
  });
  router.delete(
    '/admin/api/staff/pos/devices/:terminalId',
    validateRequest({ params: unlinkPosParamsSchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({ success: true, ...(await unlinkPosDevice(req.admin, req.params.terminalId)) });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get('/admin/api/staff/pos/devices', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.json({
        success: true,
        ...(await listPosDevices(req.admin, String(req.query.pairingId || ''))),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.post(
    '/admin/api/staff/pos/pairing-code',
    validateRequest({ body: pairingCodeSchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        return res.json({ success: true, ...(await issuePosPairingCode(req.admin)) });
      } catch (error) {
        return next(error);
      }
    },
  );
};
module.exports = { registerPosPairingAdminRoutes };
