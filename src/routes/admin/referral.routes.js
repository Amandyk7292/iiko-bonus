const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { supabase } = require('../../config/supabase');
const { branchScopeForAdmin, hasGlobalBranchAccess } = require('../../utils/admin-scope.util');
const { sendApiError } = require('../../utils/http.util');

const querySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .refine((v) => {
    const start = Date.parse(v.from),
      end = Date.parse(v.to);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start &&
      end - start <= 366 * 86400000
    );
  }, 'Период должен быть не больше года');
const reviewSchema = z.union([
  z
    .object({ action: z.enum(['approve', 'reject']), note: z.string().trim().min(3).max(1000) })
    .strict(),
  z
    .object({
      action: z.literal('return'),
      note: z.string().trim().min(3).max(1000),
      total: z.number().positive().max(10000000).multipleOf(0.01),
    })
    .strict(),
]);
const paramsSchema = z.object({ id: z.string().uuid() }).strict();

function registerReferralAdminRoutes(router) {
  router.get(
    '/admin/api/bonus/referrals',
    validateRequest({ query: querySchema }),
    async (req, res) => {
      try {
        const branches = branchScopeForAdmin(req.admin);
        const { from, to, offset } = req.query;
        const until = new Date(Date.parse(`${to}T00:00:00+05:00`) + 86400000).toISOString();
        const { data, error } = await supabase.rpc('admin_referral_report', {
          p_from: `${from}T00:00:00+05:00`,
          p_to: until,
          p_branches: branches,
          p_offset: Number(offset || 0),
        });
        if (error) throw error;
        // Use the existing POS telemetry source; don't infer a healthy cash register from referral activity.
        let pos = null;
        let posError = false;
        if (hasGlobalBranchAccess(req.admin)) {
          try {
            pos = await require('../../services/pos-health.service').getPosHealth(branches);
          } catch {
            posError = true;
          }
        }
        res.json({
          success: true,
          ...data,
          canReview: hasGlobalBranchAccess(req.admin),
          pos,
          posError,
        });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
  router.post(
    '/admin/api/bonus/referrals/:id/review',
    (req, res, next) =>
      hasGlobalBranchAccess(req.admin)
        ? next()
        : res.status(403).json({ success: false, error: 'Требуется администратор' }),
    validateRequest({ params: paramsSchema, body: reviewSchema }),
    async (req, res) => {
      try {
        const branches = branchScopeForAdmin(req.admin);
        if (branches.length) {
          const { data: redemption, error } = await supabase
            .from('referral_redemptions')
            .select('referred_customer_id')
            .eq('id', req.params.id)
            .single();
          if (error) throw error;
          const { data: purchase, error: purchaseError } = await supabase
            .from('referral_first_purchases')
            .select('branch_id')
            .eq('customer_id', redemption.referred_customer_id)
            .in('branch_id', branches)
            .maybeSingle();
          if (purchaseError) throw purchaseError;
          if (!purchase)
            return res
              .status(404)
              .json({ success: false, error: 'Приглашение вне выбранных филиалов' });
        }
        const returning = req.body.action === 'return';
        const { data, error } = await supabase.rpc(
          returning ? 'record_referral_pos_return' : 'review_referral',
          {
            p_id: req.params.id,
            p_actor: req.admin.sub,
            p_note: req.body.note,
            ...(returning ? { p_total: req.body.total } : { p_action: req.body.action }),
          },
        );
        if (error) throw error;
        for (const id of [data?.friendCustomerId, data?.ownerCustomerId].filter(Boolean)) {
          require('../../services/loyalty-sync.service').queueCustomerLoyaltySync(id);
        }
        res.json({ success: true, result: data });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
}
module.exports = { registerReferralAdminRoutes, querySchema, reviewSchema };
