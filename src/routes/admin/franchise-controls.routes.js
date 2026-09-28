const { supabase } = require('../../config/supabase');
const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { branchScopeForAdmin } = require('../../utils/admin-scope.util');
const { checkBankOrder } = require('../../services/franchise-bank-check.service');
const base = '/admin/api/transactions/settlements';
function registerFranchiseControls(
  router,
  { handle, owner, rpc, checkBranch, actor, day, readAll },
) {
  const period = z
    .object({
      from: day,
      to: day,
      branch: z.string().uuid().optional(),
      metric: z.enum(['orders', 'buyers', 'paid', 'completed', 'cancelled', 'refunded', 'issues']),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    })
    .strict()
    .refine(
      (v) =>
        Date.parse(v.to) >= Date.parse(v.from) &&
        Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    );
  router.get(
    base + '/details',
    validateRequest({ query: period }),
    handle(async (req, res) => {
      if (req.query.branch) checkBranch(req, req.query.branch);
      res.json(
        await rpc('franchise_order_drilldown', {
          p_from: `${req.query.from}T00:00:00+05:00`,
          p_to: new Date(Date.parse(`${req.query.to}T00:00:00+05:00`) + 86400000).toISOString(),
          p_branches: branchScopeForAdmin(req.admin),
          p_branch: req.query.branch || null,
          p_partner: req.franchisePartner || null,
          p_metric: req.query.metric,
          p_offset: req.query.offset,
        }),
      );
    }),
  );
  router.post(
    base + '/orders/:id/bank-check',
    owner,
    validateRequest({ params: z.object({ id: z.string().uuid() }).strict() }),
    handle(async (req, res) => {
      const { data: f, error: fe } = await supabase
        .from('franchise_order_finances')
        .select('branch_id,current_signature')
        .eq('order_id', req.params.id)
        .maybeSingle();
      if (fe) throw fe;
      if (!f) return res.status(404).json({ error: 'Заказ не найден' });
      checkBranch(req, f.branch_id);
      const { data: o, error: oe } = await supabase
        .from('kaspi_orders')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (oe) throw oe;
      const result = await checkBankOrder(o, {
        forte: require('../../services/forte.service'),
        widget: require('../../services/forte-widget.service'),
      });
      const record = {
        order_id: o.id,
        signature: f.current_signature,
        checked_by: actor(req),
        checked_at: new Date().toISOString(),
        ...result,
      };
      const { error } = await supabase.from('franchise_bank_checks').upsert(record);
      if (error) throw error;
      res.json(record);
    }),
  );
  const monthQuery = z
    .object({
      branch: z.string().uuid(),
      partner: z.string().uuid().optional(),
      month: day.refine((v) => v.endsWith('-01')),
    })
    .strict();
  router.get(
    base + '/months/preview',
    validateRequest({ query: monthQuery }),
    handle(async (req, res) => {
      checkBranch(req, req.query.branch);
      if (req.franchisePartner && req.query.partner && req.query.partner !== req.franchisePartner)
        return res.status(404).json({ error: 'Партнёр недоступен' });
      res.json(
        await rpc('franchise_month_preview', {
          p_branch: req.query.branch,
          p_partner: req.franchisePartner || req.query.partner || null,
          p_month: req.query.month,
        }),
      );
    }),
  );
  router.post(
    base + '/months/close',
    owner,
    validateRequest({ body: monthQuery.extend({ signature: z.string().regex(/^[a-f0-9]{32}$/) }) }),
    handle(async (req, res) => {
      checkBranch(req, req.body.branch);
      res.json({
        id: await rpc('franchise_close_month', {
          p_branch: req.body.branch,
          p_partner: req.body.partner || null,
          p_month: req.body.month,
          p_signature: req.body.signature,
          p_actor: actor(req),
        }),
      });
    }),
  );
  router.get(
    base + '/months',
    handle(async (req, res) => {
      const scope = branchScopeForAdmin(req.admin);
      const rows = await readAll(() => {
        let q = supabase
          .from('franchise_month_closures')
          .select('id,branch_id,partner_id,month,entitlement:snapshot->entitlement,closed_at')
          .order('month', { ascending: false })
          .order('id');
        if (scope.length) q = q.in('branch_id', scope);
        if (req.franchisePartner) q = q.eq('partner_id', req.franchisePartner);
        return q;
      });
      res.json({ months: rows });
    }),
  );
  router.get(
    base + '/months/:id',
    validateRequest({ params: z.object({ id: z.string().uuid() }).strict() }),
    handle(async (req, res) => {
      const { data, error } = await supabase
        .from('franchise_month_closures')
        .select('branch_id,partner_id,snapshot')
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw error;
      if (!data || (req.franchisePartner && data.partner_id !== req.franchisePartner))
        return res.status(404).json({ error: 'Расчёт не найден' });
      checkBranch(req, data.branch_id);
      res.json(data.snapshot);
    }),
  );
  router.get(
    base + '/portal-users',
    owner,
    handle(async (_req, res) => {
      const users = await readAll(() =>
        supabase
          .from('admin_user_profiles')
          .select('username,display_name,branch_ids,active')
          .eq('role', 'franchisee')
          .order('username'),
      );
      const links = await readAll(() =>
        supabase.from('franchise_portal_users').select('username,partner_id').order('username'),
      );
      res.json({ users, links });
    }),
  );
  router.post(
    base + '/portal-users',
    owner,
    validateRequest({
      body: z
        .object({ username: z.string().trim().min(3).max(160), partner: z.string().uuid() })
        .strict(),
    }),
    handle(async (req, res) => {
      const { data, error } = await supabase
        .from('admin_user_profiles')
        .select('role')
        .eq('username', req.body.username)
        .maybeSingle();
      if (error) throw error;
      if (data?.role !== 'franchisee')
        return res
          .status(409)
          .json({ error: 'Сначала создайте пользователя с ролью «Франчайзи» в разделе доступа' });
      const { error: saveError } = await supabase.from('franchise_portal_users').upsert({
        username: req.body.username,
        partner_id: req.body.partner,
        created_by: actor(req),
        updated_at: new Date().toISOString(),
      });
      if (saveError) throw saveError;
      res.json({ success: true });
    }),
  );
}
module.exports = { registerFranchiseControls };
