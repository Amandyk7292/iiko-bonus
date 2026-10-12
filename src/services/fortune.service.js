const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const {
  hash,
  opaqueToken,
  claimToken,
  failure,
  databaseError,
  safePrize,
} = require('./fortune-common');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { getBulkaLocations } = require('./location.service');
function createFortuneService({
  db = supabase,
  locations = getBulkaLocations,
  verifyReceipt,
  revalidateReceipt,
  sync = queueCustomerLoyaltySync,
} = {}) {
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw databaseError(error);
    return data;
  }
  async function loadWheel(campaignId, branchId) {
    const [{ data, error }, branches] = await Promise.all([
      db.from('fortune_campaigns').select('*').eq('id', campaignId).maybeSingle(),
      locations(),
    ]);
    if (error) throw databaseError(error);
    const branch = branches.find((b) => b.id === branchId && b.active !== false);
    const now = Date.now();
    if (
      !data ||
      !branch ||
      data.status !== 'active' ||
      !data.branch_ids.includes(branchId) ||
      (data.config.startsAt && Date.parse(data.config.startsAt) > now) ||
      (data.config.endsAt && Date.parse(data.config.endsAt) <= now)
    )
      throw failure('FORTUNE_UNAVAILABLE', 404);
    return { row: data, branch };
  }
  async function wheel(campaignId, branchId) {
    const { row, branch } = await loadWheel(campaignId, branchId);
    return {
      enabled: true,
      campaign: {
        id: row.id,
        title: row.title,
        prizes: row.config.prizes
          .filter((p) => p.active)
          .map((p) => ({ id: p.id, label: p.label, color: p.color })),
      },
      branch: { id: branch.id, name: branch.name },
    };
  }
  async function receipt(campaignId, branchId, guestHash, image) {
    const { row } = await loadWheel(campaignId, branchId);
    const verify = verifyReceipt || require('./fortune-receipt.service').verifyFortuneReceipt;
    const result = await verify({
      branchId,
      image,
      maxAgeDays: Math.ceil(row.config.maxReceiptAgeHours / 24),
    });
    if (
      result.branchId !== branchId ||
      !result.serverId ||
      !result.saleGuid ||
      !result.receiptIdentity ||
      !Number.isFinite(result.total) ||
      !Number.isFinite(Date.parse(result.closedAt))
    )
      throw failure('FORTUNE_RECEIPT_INVALID', 422);
    if (
      result.total < row.config.minReceiptAmount ||
      Date.parse(result.closedAt) < Date.now() - row.config.maxReceiptAgeHours * 3600000 ||
      Date.parse(result.closedAt) > Date.now() + 60000
    )
      throw failure('FORTUNE_RECEIPT_INVALID', 422);
    const receiptToken = opaqueToken();
    const value = {
      ...result,
      number: String(result.fiscalSign || result.fiscalReceiptNumber || ''),
    };
    await rpc('fortune_verify_receipt', {
      p_id: crypto.randomUUID(),
      p_token_hash: hash(receiptToken),
      p_guest_hash: guestHash,
      p_campaign_id: campaignId,
      p_branch_id: branchId,
      p_server_id: result.serverId,
      p_sale_guid: result.saleGuid,
      p_receipt_identity: result.receiptIdentity,
      p_receipt: value,
    });
    return {
      receiptToken,
      receipt: { number: value.number, total: value.total, closedAt: value.closedAt },
    };
  }
  async function spin(campaignId, branchId, guestHash, receiptToken) {
    // The proof is additionally bound to this exact URL, not merely its bearer token.
    const { data: proof, error } = await db
      .from('fortune_receipt_proofs')
      .select('campaign_id,branch_id,receipt_identity,receipt,expires_at')
      .eq('token_hash', hash(receiptToken))
      .eq('guest_hash', guestHash)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!proof || proof.campaign_id !== campaignId || proof.branch_id !== branchId)
      throw failure('FORTUNE_RECEIPT_INVALID', 422);
    const existing = await db
      .from('fortune_draws')
      .select('id')
      .eq('receipt_identity', proof.receipt_identity)
      .maybeSingle();
    if (existing.error) throw databaseError(existing.error);
    // Lost responses must still return the original outcome. Only a new draw
    // requires a fresh fiscal/iiko check, so cancellation cannot reuse a
    // previously valid thirty-minute upload proof.
    if (!existing.data) {
      if (
        !Number.isFinite(Date.parse(proof.expires_at)) ||
        Date.parse(proof.expires_at) <= Date.now()
      )
        throw failure('FORTUNE_EXPIRED');
      const { row } = await loadWheel(campaignId, branchId);
      const verify =
        revalidateReceipt || require('./fortune-receipt.service').revalidateFortuneReceipt;
      await verify({
        branchId,
        receipt: proof.receipt,
        maxAgeDays: Math.ceil(row.config.maxReceiptAgeHours / 24),
      });
    }
    const drawId = crypto.randomUUID();
    const candidate = claimToken(drawId, guestHash);
    const random = crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
    const result = await rpc('fortune_spin', {
      p_proof_token_hash: hash(receiptToken),
      p_guest_hash: guestHash,
      p_draw_id: drawId,
      p_claim_hash: hash(candidate),
      p_random: random,
    });
    const row = result.draw || result;
    if (row.guest_hash !== guestHash) throw failure('FORTUNE_RECEIPT_USED');
    return {
      win: safePrize(row),
      wheel: row.wheel_snapshot,
      ...(row.prize_snapshot.kind !== 'none' ? { claimToken: claimToken(row.id, guestHash) } : {}),
    };
  }
  async function list(customerId) {
    const [{ data, error }, branches] = await Promise.all([
      db
        .from('fortune_draws')
        .select('*')
        .eq('customer_id', customerId)
        .order('won_at', { ascending: false })
        .limit(200),
      locations(),
    ]);
    if (error) throw databaseError(error);
    return { items: (data || []).map((row) => accountPrize(row, customerId, branches)) };
  }
  function accountPrize(row, customerId, branches = []) {
    if (row.customer_id !== customerId) throw failure('FORTUNE_CLAIM_INVALID', 404);
    const prize = safePrize(row, branches.find((b) => b.id === row.branch_id)?.name);
    // This identifies the account-owned voucher; only staff authentication can redeem it.
    if (prize.status === 'claimed' && prize.prizeKind === 'gift') prize.redemptionCode = row.id;
    return prize;
  }
  async function claim(customerId, token) {
    const row = await rpc('fortune_claim', {
      p_claim_hash: hash(token),
      p_customer_id: customerId,
    });
    return { prize: accountPrize(row, customerId, await locations()) };
  }
  async function redeemBonus(customerId, drawId) {
    const result = await rpc('fortune_redeem_bonus', {
      p_draw_id: drawId,
      p_customer_id: customerId,
    });
    const row = result.draw || result;
    // A retry can safely enqueue reconciliation again; financial mutation is SQL-idempotent.
    try {
      await sync(customerId);
    } catch {
      // Durable ledger is already committed; reconciliation is retried by the existing queue.
    }
    return { prize: accountPrize(row, customerId, await locations()), balance: result.balance };
  }
  return { wheel, receipt, spin, list, claim, redeemBonus };
}
module.exports = { createFortuneService, fortuneService: createFortuneService() };
