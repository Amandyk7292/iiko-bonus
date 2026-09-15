const { adminAuthMiddleware } = require('../../middlewares/auth.middleware');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { adminMutationSchemas } = require('../../contracts/admin-mutations.contract');
const { getIikoClientForBranch } = require('../../services/iiko-city-profile.service');
const { supabase } = require('../../config/supabase');

function registerPriceLabelRoutes(router) {
  router.get('/admin/api/menu/price-label-settings', adminAuthMiddleware, async (req, res) => {
    try {
      const { profileKey } = await getIikoClientForBranch(req.admin?.selectedBranchId);
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', `price_labels_${profileKey}`)
        .maybeSingle();
      if (error) throw error;
      const saved = data ? JSON.parse(data.value) : { background: '#792C14', includeQr: false };
      res.json({
        success: true,
        profileKey,
        background: saved.background,
        includeQr: saved.includeQr,
      });
    } catch {
      res.status(503).json({
        success: false,
        error: 'Не удалось загрузить настройки ценников. Повторите попытку.',
      });
    }
  });
  router.post(
    '/admin/api/menu/price-label-settings',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.priceLabelSettings),
    async (req, res) => {
      try {
        const { profileKey } = await getIikoClientForBranch(req.admin?.selectedBranchId);
        if (profileKey !== req.body.profileKey)
          return res
            .status(409)
            .json({ success: false, error: 'Город изменился. Откройте печать заново.' });
        const settings = {
          background: req.body.background.toUpperCase(),
          includeQr: req.body.includeQr,
        };
        const { error } = await supabase
          .from('settings')
          .upsert(
            { key: `price_labels_${profileKey}`, value: JSON.stringify(settings) },
            { onConflict: 'key' },
          );
        if (error) throw error;
        res.json({ success: true, profileKey, ...settings });
      } catch {
        res.status(503).json({
          success: false,
          error: 'Не удалось сохранить настройки ценников. Повторите попытку.',
        });
      }
    },
  );
}
module.exports = { registerPriceLabelRoutes };
