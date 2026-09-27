const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { supabase } = require('../../config/supabase');
const { branchScopeForAdmin, hasGlobalBranchAccess } = require('../../utils/admin-scope.util');
const { sendApiError } = require('../../utils/http.util');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const query = z
  .object({
    from: day,
    to: day,
    branch: z.string().uuid().optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) >= Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Период не больше года',
  );
const id = z.object({ id: z.string().uuid() }).strict();
const owner = (req, res, next) =>
  req.admin.role === 'owner'
    ? next()
    : res.status(403).json({ error: 'Только владелец может изменять взаиморасчёты' });
const actor = (req) => String(req.admin.sub || req.admin.username || 'owner');
function checkBranch(req, branch) {
  const scope = branchScopeForAdmin(req.admin);
  if (scope.length && !scope.includes(branch))
    throw Object.assign(new Error('Точка недоступна'), { statusCode: 404 });
}
async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    if (error.code === 'P0001')
      throw Object.assign(
        new Error('Данные изменились или требуется сверка. Обновите отчёт и проверьте заказы.'),
        { statusCode: 409 },
      );
    if (error.code === '23505')
      throw Object.assign(new Error('Такое подтверждение выплаты уже зарегистрировано'), {
        statusCode: 409,
      });
    throw error;
  }
  return data;
}
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendApiError(res, error);
  }
};
async function readAll(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
function registerFranchiseRoutes(router) {
  router.get(
    '/admin/api/transactions/settlements',
    validateRequest({ query }),
    handle(async (req, res) => {
      if (req.query.branch) checkBranch(req, req.query.branch);
      const result = await rpc('franchise_report', {
        p_from: `${req.query.from}T00:00:00+05:00`,
        p_to: new Date(Date.parse(`${req.query.to}T00:00:00+05:00`) + 86400000).toISOString(),
        p_branches: branchScopeForAdmin(req.admin),
        p_branch: req.query.branch || null,
        p_offset: req.query.offset,
      });
      res.json({ ...result, canManage: req.admin.role === 'owner' });
    }),
  );
  router.get(
    '/admin/api/transactions/settlements/config',
    handle(async (req, res) => {
      const scope = branchScopeForAdmin(req.admin);
      const locations = await readAll(() => {
        let q = supabase.from('bulka_locations').select('id,name,city,active').order('id');
        return scope.length ? q.in('id', scope) : q;
      });
      const allTerms = await readAll(() => {
        let q = supabase
          .from('franchise_branch_terms')
          .select('*')
          .order('effective_at', { ascending: false })
          .order('id');
        return scope.length ? q.in('branch_id', scope) : q;
      });
      const terms = allTerms.filter(
        (v, i) => allTerms.findIndex((t) => t.branch_id === v.branch_id) === i,
      );
      const partnerIds = [...new Set(allTerms.map((t) => t.partner_id).filter(Boolean))];
      const partners =
        hasGlobalBranchAccess(req.admin) || partnerIds.length
          ? await readAll(() => {
              let q = supabase.from('franchise_partners').select('id,name').order('id');
              return hasGlobalBranchAccess(req.admin) ? q : q.in('id', partnerIds);
            })
          : [];

      res.json({ locations, terms, partners });
    }),
  );
  router.post(
    '/admin/api/transactions/settlements/partners',
    owner,
    validateRequest({ body: z.object({ name: z.string().trim().min(2).max(160) }).strict() }),
    handle(async (req, res) => {
      const { data, error } = await supabase
        .from('franchise_partners')
        .insert({ name: req.body.name, created_by: actor(req) })
        .select('id,name')
        .single();
      if (error) throw error;
      res.json(data);
    }),
  );
  router.post(
    '/admin/api/transactions/settlements/terms',
    owner,
    validateRequest({
      body: z
        .object({
          branch: z.string().uuid(),
          partner: z.string().uuid().nullable(),
          commission: z.number().int().min(0).max(10000),
          bonus: z.number().int().min(0).max(10000),
          delivery: z.enum(['platform', 'partner']),
        })
        .strict(),
    }),
    handle(async (req, res) => {
      const b = req.body;
      checkBranch(req, b.branch);
      res.json({
        id: await rpc('franchise_set_terms', {
          p_branch: b.branch,
          p_partner: b.partner,
          p_commission: b.commission,
          p_bonus: b.bonus,
          p_delivery: b.delivery,
          p_actor: actor(req),
        }),
      });
    }),
  );
  router.post(
    '/admin/api/transactions/settlements/orders/:id/reconcile',
    owner,
    validateRequest({
      params: id,
      body: z
        .object({
          fee: z.number().min(0).max(100000000).multipleOf(0.01),
          recipient: z.enum(['platform', 'partner']),
          reference: z.string().trim().min(3).max(200),
          signature: z.string().regex(/^[a-f0-9]{32}$/),
        })
        .strict(),
    }),
    handle(async (req, res) => {
      const { data, error } = await supabase
        .from('franchise_order_accounts')
        .select('branch_id')
        .eq('order_id', req.params.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Заказ не найден' });
      checkBranch(req, data.branch_id);
      const b = req.body;
      await rpc('franchise_reconcile', {
        p_order: req.params.id,
        p_fee: b.fee,
        p_recipient: b.recipient,
        p_reference: b.reference,
        p_actor: actor(req),
        p_signature: b.signature,
      });
      res.json({ success: true });
    }),
  );
  router.post(
    '/admin/api/transactions/settlements/payouts',
    owner,
    validateRequest({
      body: z
        .object({
          id: z.string().uuid(),
          branch: z.string().uuid(),
          partner: z.string().uuid(),
          amount: z.number().positive().max(1000000000).multipleOf(0.01),
          reference: z.string().trim().min(3).max(200),
          paidAt: z.string().datetime({ offset: true }),
        })
        .strict(),
    }),
    handle(async (req, res) => {
      const b = req.body;
      checkBranch(req, b.branch);
      res.json(
        await rpc('franchise_record_payout', {
          p_id: b.id,
          p_branch: b.branch,
          p_partner: b.partner,
          p_expected: b.amount,
          p_reference: b.reference,
          p_paid_at: b.paidAt,
          p_actor: actor(req),
        }),
      );
    }),
  );
  router.get(
    '/admin/api/transactions/settlements/payouts/:id',
    validateRequest({ params: id }),
    handle(async (req, res) => {
      const { data: p, error } = await supabase
        .from('franchise_payouts')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw error;
      if (!p) return res.status(404).json({ error: 'Выплата не найдена' });
      checkBranch(req, p.branch_id);
      res.json(
        await rpc('franchise_payout_detail', {
          p_id: p.id,
          p_branches: branchScopeForAdmin(req.admin),
        }),
      );
    }),
  );
}
module.exports = { registerFranchiseRoutes };
