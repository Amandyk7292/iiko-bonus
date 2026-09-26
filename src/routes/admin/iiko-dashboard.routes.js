const { service } = require('../../services/iiko-dashboard.service');
const {
  reportQuery,
  analyticsQuery,
  schemaQuery,
  departmentsQuery,
  productSearchQuery,
  productSalesQuery,
  balancesQuery,
  balancesExportQuery,
  revisionQuery,
  cashReportQuery,
  controlsQuery,
  controlsExportQuery,
  receiptQuery,
  barterQuery,
  barterPersonMutation,
  invoiceQuery,
  serverMutation,
  serverParams,
} = require('../../contracts/iiko-dashboard.contract');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { reportWorkbook, balanceReport } = require('../../services/iiko-dashboard-export');
const { ReportJobs } = require('../../services/iiko-dashboard-jobs');

function registerIikoDashboardRoutes(router, reporting = service) {
  const controlJobs = new ReportJobs();
  const receiptJobs = new ReportJobs();
  const barterJobs = new ReportJobs();
  const invoiceJobs = new ReportJobs();
  const revisionJobs = new ReportJobs();
  const cashReportJobs = new ReportJobs();
  const productSalesJobs = new ReportJobs();
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
    '/admin/api/iiko-dashboard/revision',
    ownerOnly,
    validateRequest({ body: revisionQuery }),
    handle((req) =>
      revisionJobs.read(JSON.stringify(req.body), () => reporting.revision(req.body)),
    ),
  );
  router.post(
    '/admin/api/iiko-dashboard/cash-report',
    ownerOnly,
    validateRequest({ body: cashReportQuery }),
    handle((req) =>
      cashReportJobs.read(JSON.stringify(req.body), () => reporting.cashReport(req.body)),
    ),
  );
  router.post(
    '/admin/api/iiko-dashboard/invoices',
    ownerOnly,
    validateRequest({ body: invoiceQuery }),
    handle((req) => invoiceJobs.read(JSON.stringify(req.body), () => reporting.invoices(req.body))),
  );
  router.post(
    '/admin/api/iiko-dashboard/invoices/export',
    ownerOnly,
    validateRequest({ body: invoiceQuery }),
    async (req, res) => {
      try {
        const report = await invoiceJobs.result(JSON.stringify(req.body), () =>
          reporting.invoices(req.body),
        );
        res.set(
          'Content-Disposition',
          `attachment; filename="iiko-invoices-${req.body.from}.xlsx"`,
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(reportWorkbook(report));
      } catch (error) {
        res.status(error.statusCode || 502).json({ code: error.code || 'IIKO_REPORT_FAILED' });
      }
    },
  );
  router.post(
    '/admin/api/iiko-dashboard/barters',
    ownerOnly,
    validateRequest({ body: barterQuery }),
    handle((req) => {
      const report = barterJobs.read(JSON.stringify(req.body), () => reporting.barters(req.body));
      return report.pending ? report : reporting.barterPeople(report);
    }),
  );
  router.post(
    '/admin/api/iiko-dashboard/barters/person',
    ownerOnly,
    validateRequest({ body: barterPersonMutation }),
    handle(async (req) => {
      const report = await barterJobs.result(JSON.stringify(req.body.query), () =>
        reporting.barters(req.body.query),
      );
      return reporting.saveBarterPerson(report, req.body, req.admin.sub);
    }),
  );
  router.post(
    '/admin/api/iiko-dashboard/barters/export',
    ownerOnly,
    validateRequest({ body: barterQuery }),
    async (req, res) => {
      try {
        const report = await barterJobs.result(JSON.stringify(req.body), () =>
          reporting.barters(req.body),
        );
        res.set('Content-Disposition', `attachment; filename="iiko-barters-${req.body.from}.xlsx"`);
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(reportWorkbook(await reporting.barterPeople(report)));
      } catch (error) {
        res.status(error.statusCode || 502).json({ code: error.code || 'IIKO_REPORT_FAILED' });
      }
    },
  );
  router.post(
    '/admin/api/iiko-dashboard/receipt',
    ownerOnly,
    validateRequest({ body: receiptQuery }),
    handle((req) => receiptJobs.read(JSON.stringify(req.body), () => reporting.receipt(req.body))),
  );
  router.post(
    '/admin/api/iiko-dashboard/controls',
    ownerOnly,
    validateRequest({ body: controlsQuery }),
    handle((req) =>
      req.get('X-Iiko-Async') === '1'
        ? controlJobs.read(JSON.stringify(req.body), () => reporting.controls(req.body))
        : reporting.controls(req.body),
    ),
  );
  router.post(
    '/admin/api/iiko-dashboard/controls/export',
    ownerOnly,
    validateRequest({ body: controlsExportQuery }),
    async (req, res) => {
      try {
        const result = await controlJobs.result(JSON.stringify(req.body.query), () =>
          reporting.controls(req.body.query),
        );
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
  router.get(
    '/admin/api/iiko-dashboard/product-sales/products',
    ownerOnly,
    validateRequest({ query: productSearchQuery }),
    handle((req) => reporting.searchProducts(req.query)),
  );
  router.post(
    '/admin/api/iiko-dashboard/product-sales',
    ownerOnly,
    validateRequest({ body: productSalesQuery }),
    handle((req) =>
      productSalesJobs.read(JSON.stringify(req.body), () => reporting.productSales(req.body)),
    ),
  );
  router.post(
    '/admin/api/iiko-dashboard/product-sales/export',
    ownerOnly,
    validateRequest({ body: productSalesQuery }),
    async (req, res) => {
      try {
        const result = await productSalesJobs.result(JSON.stringify(req.body), () =>
          reporting.productSales(req.body),
        );
        res.set(
          'Content-Disposition',
          `attachment; filename="iiko-product-sales-${req.body.from}-${req.body.to}.xlsx"`,
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(
            reportWorkbook(
              require('../../services/iiko-dashboard-product-sales').exportProductSales(result),
            ),
          );
      } catch (error) {
        res.status(error.statusCode || 502).json({ code: error.code || 'IIKO_REPORT_FAILED' });
      }
    },
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
    handle(async () => ({ servers: await reporting.listServers() })),
  );
  router.post(
    '/admin/api/iiko-dashboard/servers',
    ownerOnly,
    validateRequest({ body: serverMutation }),
    handle(async (req) => ({ servers: await reporting.saveServer(req.body) })),
  );
  router.delete(
    '/admin/api/iiko-dashboard/servers/:id',
    ownerOnly,
    validateRequest({ params: serverParams }),
    handle(async (req) => ({ servers: await reporting.deleteServer(req.params.id) })),
  );
  router.get(
    '/admin/api/iiko-dashboard/departments',
    ownerOnly,
    validateRequest({ query: departmentsQuery }),
    handle((req) => reporting.departments(req.query)),
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
