const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { hasGlobalBranchAccess, branchScopeForAdmin } = require('../utils/admin-scope.util');
const { failure, databaseError, safePrize } = require('./fortune-common');
const { getBulkaLocations } = require('./location.service');
const management = (admin) => {
  if (!hasGlobalBranchAccess(admin)) throw failure('FORTUNE_FORBIDDEN', 403);
};
const campaign = (row) => ({
  ...row.config,
  id: row.id,
  title: row.title,
  status: row.status,
  branchIds: row.branch_ids,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
function createFortuneAdminService({ db = supabase, locations = getBulkaLocations } = {}) {
  async function getCampaign(id) {
    const { data, error } = await db
      .from('fortune_campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw failure('FORTUNE_UNAVAILABLE', 404);
    return data;
  }
  async function list(admin) {
    management(admin);
    const [{ data, error }, branches] = await Promise.all([
      db.rpc('fortune_campaign_list'),
      locations(),
    ]);
    if (error) throw databaseError(error);
    const campaigns = (data || []).map(campaign);
    return {
      campaigns,
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        city: b.city,
        address: b.address,
        active: b.active !== false,
      })),
    };
  }
  async function save(admin, id, body) {
    management(admin);
    const { expectedVersion, ...config } = body;
    const branches = await locations();
    if (
      config.branchIds.some((value) => !branches.some((b) => b.id === value && b.active !== false))
    )
      throw failure('FORTUNE_CONFIG_INVALID', 400);
    const value = {
      ...config,
      prizes: config.prizes.map((p) => ({ ...p, id: p.id || crypto.randomUUID() })),
    };
    const { data, error } = await db.rpc('fortune_save_campaign', {
      p_id: id,
      p_expected_version: expectedVersion ?? null,
      p_config: value,
    });
    if (error) throw databaseError(error);
    return { campaign: campaign(data) };
  }
  async function qr(admin, id, branchId) {
    management(admin);
    const row = await getCampaign(id);
    if (!row.branch_ids.includes(branchId)) throw failure('FORTUNE_UNAVAILABLE', 404);
    return { url: `https://bulka.com.kz/fortune/${id}/${branchId}` };
  }
  async function winners(admin, id, query) {
    management(admin);
    await getCampaign(id);
    const now = new Date().toISOString();
    let request = db
      .from('fortune_draws')
      .select('*,customers(name,phone)', { count: 'exact' })
      .eq('campaign_id', id);
    if (query.status === 'expired')
      request = request.neq('status', 'redeemed').lte('expires_at', now);
    else if (query.status) {
      request = request.eq('status', query.status);
      if (query.status !== 'redeemed') request = request.gt('expires_at', now);
    }
    const offset = (query.page - 1) * 50;
    const { data, error, count } = await request
      .order('won_at', { ascending: false })
      .range(offset, offset + 49);
    if (error) throw databaseError(error);
    const branches = await locations();
    return {
      items: (data || []).map((row) => ({
        ...safePrize(row, branches.find((b) => b.id === row.branch_id)?.name),
        campaignId: row.campaign_id,
        branchId: row.branch_id,
        customerName: row.customers?.name,
        customerPhone: row.customers?.phone,
        receiptNumber: row.receipt.number,
        receiptTotal: row.receipt.total,
      })),
      total: count || 0,
      page: query.page,
    };
  }
  function redemptionRole(admin) {
    if (!['owner', 'admin', 'cashier', 'branch_manager'].includes(admin?.role))
      throw failure('FORTUNE_FORBIDDEN', 403);
  }
  async function voucher(admin, id) {
    redemptionRole(admin);
    const { data, error } = await db
      .from('fortune_draws')
      .select('*,customers(name)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw databaseError(error);
    const scope = branchScopeForAdmin(admin);
    if (
      !data ||
      !data.customer_id ||
      data.prize_snapshot.kind !== 'gift' ||
      (scope.length && !scope.includes(data.branch_id))
    )
      throw failure('FORTUNE_CLAIM_INVALID', 404);
    const branches = await locations();
    return {
      voucher: {
        ...safePrize(data, branches.find((b) => b.id === data.branch_id)?.name),
        branchId: data.branch_id,
        customerName: data.customers?.name || null,
      },
    };
  }
  async function redeem(admin, id) {
    redemptionRole(admin);
    const { data, error } = await db.rpc('fortune_redeem_gift', {
      p_draw_id: id,
      p_branches: branchScopeForAdmin(admin),
      p_actor: admin.username || admin.sub || admin.subject || admin.id || admin.role,
    });
    if (error) throw databaseError(error);
    return {
      winner: { ...safePrize(data), campaignId: data.campaign_id, branchId: data.branch_id },
      prize: safePrize(data),
    };
  }
  return { list, save, qr, winners, voucher, redeem };
}
module.exports = { createFortuneAdminService, fortuneAdmin: createFortuneAdminService() };
