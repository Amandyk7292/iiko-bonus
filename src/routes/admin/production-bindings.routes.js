const { validateRequest } = require('../../middlewares/validation.middleware');
const {
  productionBindingParams,
  productionBindingQuery,
  productionBindingBody,
  productionActParams,
  productionActResolution,
} = require('../../contracts/production-binding.contract');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');

function owner(req, res, next) {
  if (!['owner', 'admin'].includes(req.admin?.role))
    return res.status(403).json({ success: false, error: 'Настройка доступна администратору' });
  const allowed = branchScopeForAdmin(req.admin);
  if (allowed.length && !allowed.includes(req.params.id))
    return res.status(403).json({ success: false, error: 'Филиал не входит в область доступа' });
  return next();
}

function registerProductionBindingRoutes(router, options = {}) {
  const service = options.service || require('../../services/cashier-production-binding.service');
  const client =
    options.client || new (require('../../services/iiko-dashboard-client').IikoDashboardClient)();
  const path = '/admin/api/locations/:id/production-binding';
  router.get(
    path,
    validateRequest({ params: productionBindingParams, query: productionBindingQuery }),
    owner,
    async (req, res, next) => {
      try {
        const [binding, servers] = await Promise.all([
          service.readProductionBinding(req.params.id),
          client.listServers(),
        ]);
        const visible = servers.filter((server) => server.active && server.configured);
        const serverId = req.query.serverId || binding?.serverId;
        if (serverId && !visible.some((server) => server.id === serverId))
          throw Object.assign(new Error('Сервер iiko недоступен'), { statusCode: 409 });
        const directory = serverId
          ? await service.loadProductionDirectory(serverId)
          : { departments: [], stores: [] };
        res.set('Cache-Control', 'private, no-store');
        res.json({
          success: true,
          binding,
          directory: {
            ...directory,
            servers: visible.map((server) => ({
              id: server.id,
              name: server.name || server.host || server.id,
              city: server.city,
            })),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.put(
    path,
    validateRequest({ params: productionBindingParams, body: productionBindingBody }),
    owner,
    async (req, res, next) => {
      try {
        const binding = await service.saveProductionBinding(req.params.id, req.body, {
          actor: req.admin.sub,
        });
        res.set('Cache-Control', 'private, no-store');
        res.json({ success: true, binding });
      } catch (error) {
        next(error);
      }
    },
  );
  const acts = options.acts || require('../../services/cashier-production.service');
  router.get(
    '/admin/api/locations/:id/production-acts',
    validateRequest({ params: productionBindingParams }),
    owner,
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'private, no-store');
        res.json({ success: true, acts: await acts.listUnconfirmedProductionActs(req.params.id) });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/admin/api/locations/:id/production-acts/:actId/resolve',
    validateRequest({ params: productionActParams, body: productionActResolution }),
    owner,
    async (req, res, next) => {
      try {
        const act = await acts.resolveProductionAct(req.params.id, req.params.actId, req.body, {
          actor: req.admin.sub,
        });
        res.set('Cache-Control', 'private, no-store');
        res.json({ success: true, act });
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { registerProductionBindingRoutes };
