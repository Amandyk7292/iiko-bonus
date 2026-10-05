const { cashierDirectoryStatus } = require('../../services/cashier-directory-status.service');
const { hasGlobalBranchAccess } = require('../../utils/admin-scope.util');

function registerCashierDirectoryStatusRoutes(router, { service = cashierDirectoryStatus } = {}) {
  router.get('/admin/api/bonus/cashier-directory-status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const status = await service.getStatus();
      res.json({
        success: true,
        status: {
          ...status,
          cashierCount: hasGlobalBranchAccess(req.admin) ? status.cashierCount : null,
        },
      });
    } catch {
      res.status(503).json({
        success: false,
        error: 'Статус синхронизации недоступен.',
        code: 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE',
      });
    }
  });
}

module.exports = { registerCashierDirectoryStatusRoutes };
