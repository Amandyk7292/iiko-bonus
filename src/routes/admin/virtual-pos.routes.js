const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  saleSchema,
  saleParamsSchema,
  emptyQuerySchema,
  terminalConfigSchema,
} = require('../../contracts/virtual-pos.contract');
const virtualPos = require('../../services/virtual-pos.service');

const branchHeader = (req) =>
  Array.isArray(req.headers['x-bulka-branch-id']) ? '' : req.headers['x-bulka-branch-id'];
function registerVirtualPosAdminRoutes(router) {
  router.put(
    '/admin/api/staff/virtual-pos/terminal',
    validateRequest({ body: terminalConfigSchema, query: emptyQuerySchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({
          success: true,
          ...(await virtualPos.configureTerminal(req.admin, branchHeader(req), req.body)),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/admin/api/staff/virtual-pos/catalog',
    validateRequest({ query: emptyQuerySchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({ success: true, ...(await virtualPos.catalog(req.admin, branchHeader(req))) });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/admin/api/staff/virtual-pos/sales',
    validateRequest({ body: saleSchema, query: emptyQuerySchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({
          success: true,
          ...(await virtualPos.createSale(req.admin, branchHeader(req), req.body)),
        });
      } catch (error) {
        if (error.safelyRejected === true)
          return res.status(error.statusCode || 409).json({
            success: false,
            code: error.code,
            error: error.message,
            safelyRejected: true,
          });
        next(error);
      }
    },
  );
  router.get(
    '/admin/api/staff/virtual-pos/sales/:id',
    validateRequest({ params: saleParamsSchema, query: emptyQuerySchema }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({
          success: true,
          sale: await virtualPos.getSale(req.admin, branchHeader(req), req.params.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { registerVirtualPosAdminRoutes };
