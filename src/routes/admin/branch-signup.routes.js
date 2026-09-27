const QRCode = require('qrcode');
const { supabase } = require('../../config/supabase');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
const { sendApiError } = require('../../utils/http.util');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { querySchema } = require('./referral.routes');
const { branchParams } = require('../public/branch-signup.routes');
const invitationUrl = (id) =>
  `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/invite/${id}`;
function registerBranchSignupAdminRoutes(router) {
  router.get(
    '/admin/api/bonus/branch-race',
    validateRequest({ query: querySchema }),
    async (req, res) => {
      try {
        const { from, to } = req.query;
        const { data, error } = await supabase.rpc('branch_signup_ranking', {
          p_from: `${from}T00:00:00+05:00`,
          p_to: new Date(Date.parse(`${to}T00:00:00+05:00`) + 86400000).toISOString(),
          p_branches: branchScopeForAdmin(req.admin),
        });
        if (error) throw error;
        res.json({
          success: true,
          items: (data?.items || []).map((row) => ({ ...row, url: invitationUrl(row.id) })),
        });
      } catch (error) {
        sendApiError(res, error);
      }
    },
  );
  router.get(
    '/admin/api/bonus/branch-race/:branch/qr',
    validateRequest({ params: branchParams }),
    async (req, res) => {
      try {
        const scope = branchScopeForAdmin(req.admin);
        if (scope.length && !scope.includes(req.params.branch)) return res.status(404).end();
        const { data, error } = await supabase
          .from('bulka_locations')
          .select('id')
          .eq('id', req.params.branch)
          .eq('active', true)
          .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).end();
        const png = await QRCode.toBuffer(invitationUrl(data.id), {
          width: 900,
          margin: 4,
          errorCorrectionLevel: 'M',
        });
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.send(png);
      } catch (error) {
        sendApiError(res, error);
      }
    },
  );
}
module.exports = { registerBranchSignupAdminRoutes };
