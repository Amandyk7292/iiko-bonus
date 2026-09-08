const { service } = require('../../services/iiko-dashboard.service');
const {
  reportQuery,
  analyticsQuery,
  schemaQuery,
  balancesQuery,
  balancesExportQuery,
  controlsQuery,
  controlsExportQuery,
} = require('../../contracts/iiko-dashboard.contract');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { reportWorkbook, balanceReport } = require('../../services/iiko-dashboard-export');

function registerIikoDashboardRoutes(router, reporting = service) {
  const ownerOnly = (req, res, next) => {
    if (!['owner', 'admin'].includes(req.admin?.role))
      return res.status(403).json({ code: 'FORBIDDEN', error: 'Недостаточно прав' });
    res.set('Cache-Control', 'no-store');
    return next();
  };
  const handle = (work) => async (req, res) => {
    try {
      res.json(await work(req));
    } catch (error) {
      res.status(error.statusCode || 502).json({
        code: error.code || 'IIKO_REPORT_FAILED',
        error: 'Не удалось получить отчёт iiko',
      });
    }
  };
  router.post(
    '/admin/api/iiko-dashboard/controls',
    ownerOnly,
    validateRequest({ body: controlsQuery }),
    handle((req) => reporting.controls(req.body)),
  );
  router.post(
    '/admin/api/iiko-dashboard/controls/export',
    ownerOnly,
    validateRequest({ body: controlsExportQuery }),
    async (req, res) => {
      try {
        const result = await reporting.controls(req.body.query);
        const report = result.tables[req.body.table];
        if (!report) return res.status(400).json({ code: 'IIKO_REPORT_FIELD' });
        const selected = require('../../services/iiko-dashboard-controls-export').controlsExport(
          report,
          req.body,
        );
        res.set(
          'Content-Disposition',
          `attachment; filename="iiko-${req.body.table}-${req.body.query.from}.xlsx"`,
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(reportWorkbook(selected));
      } catch (error) {
        res.status(error.statusCode || 502).json({ code: error.code || 'IIKO_REPORT_FAILED' });
      }
    },
  );
  router.post(
    '/admin/api/iiko-dashboard/analytics',
    ownerOnly,
    validateRequest({ body: analyticsQuery }),
    handle((req) => reporting.analytics(req.body)),
  );
  router.post(
    '/admin/api/iiko-dashboard/analytics/export',
    ownerOnly,
    validateRequest({ body: analyticsQuery }),
    async (req, res) => {
      try {
        const result = await reporting.analytics(req.body);
        res.set(
          'Content-Disposition',
          `attachment; filename="iiko-${req.body.view}-${req.body.from}.xlsx"`,
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(reportWorkbook(result));
      } catch (error) {
        res.status(error.statusCode || 502).json({ code: error.code || 'IIKO_REPORT_FAILED' });
      }
    },
  );
  router.get(
    '/admin/api/iiko-dashboard/balances/export',
    ownerOnly,
    validateRequest({ query: balancesExportQuery }),
    async (req, res) => {
      try {
        const data = await reporting.balances(req.query);
        res.set('Content-Disposition', `attachment; filename="iiko-stock-${req.query.date}.xlsx"`);
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(reportWorkbook(balanceReport(data, req.query)));
      } catch (error) {
        res.status(error.statusCode || 502).json({ code: error.code || 'IIKO_REPORT_FAILED' });
      }
    },
  );
  router.get(
    '/admin/api/iiko-dashboard/servers',
    ownerOnly,
    handle(() => ({ servers: reporting.listServers() })),
  );
  router.get(
    '/admin/api/iiko-dashboard/schema',
    ownerOnly,
    validateRequest({ query: schemaQuery }),
    handle((req) => reporting.getSchema(req.query)),
  );
  router.post(
    '/admin/api/iiko-dashboard/report',
    ownerOnly,
    validateRequest({ body: reportQuery }),
    handle((req) => reporting.report(req.body)),
  );
  router.post(
    '/admin/api/iiko-dashboard/export',
    ownerOnly,
    validateRequest({ body: reportQuery }),
    async (req, res) => {
      try {
        const result = await reporting.report(req.body);
        res.set(
          'Content-Disposition',
          `attachment; filename="iiko-${req.body.from}-${req.body.to}.xlsx"`,
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(reportWorkbook(result));
      } catch (error) {
        res.status(error.statusCode || 502).json({
          code: error.code || 'IIKO_REPORT_FAILED',
          error: 'Не удалось выгрузить отчёт iiko',
        });
      }
    },
  );
  router.get(
    '/admin/api/iiko-dashboard/balances',
    ownerOnly,
    validateRequest({ query: balancesQuery }),
    handle((req) => reporting.balances(req.query)),
  );
}

module.exports = { registerIikoDashboardRoutes };
