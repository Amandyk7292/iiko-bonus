const { searchCustomers } = require('./customer.service');

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function bonusOwnerAt(customerId, scannedAtUtc) {
  if (process.env.CUSTOMER_FAMILY_ENABLED !== 'true') return customerId;
  const { supabase } = require('../config/supabase');
  const { data: ownerId, error } = await supabase.rpc('family_bonus_owner_at', {
    p_customer_id: customerId,
    p_scanned_at: scannedAtUtc,
  });
  if (error) throw error;
  if (!ownerId) throw invalid('Не удалось определить получателя бонусов', 503);
  if (ownerId !== customerId) {
    // Preserve the historical recipient even if their account was deleted.
    // Never redirect a queued receipt to another family or personal account.
    const { data: owner, error: ownerError } = await supabase
      .from('customers')
      .select('id,deleted_at')
      .eq('id', ownerId)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner || owner.deleted_at) throw invalid('Получатель семейных бонусов недоступен', 404);
  }
  return ownerId;
}

// Only the branch-authenticated earn-only endpoint supplies a historical QR
// time. Normal search and all write-offs retain the live five-minute QR check.
async function resolveOfflineLoyaltyCustomer(
  payload,
  {
    lookup = searchCustomers,
    now = Date.now(),
    bonusOwnerAt: resolveBonusOwner = bonusOwnerAt,
  } = {},
) {
  const scannedAt = Date.parse(payload.scannedAtUtc);
  const paidAt = Date.parse(payload.paidAtUtc);
  if (
    !Number.isFinite(scannedAt) ||
    !Number.isFinite(paidAt) ||
    scannedAt > now + 300000 ||
    paidAt > now + 300000 ||
    scannedAt > paidAt + 300000
  ) {
    throw invalid('Некорректное время сканирования или оплаты чека');
  }
  if (!/^(BULKA-OTP-|CARD-)/.test(payload.customerCode || '')) {
    throw invalid('Для отложенного начисления нужен QR-код Bulka');
  }
  let customers;
  try {
    customers = await lookup(payload.customerCode, { qrTime: scannedAt });
  } catch (error) {
    // A bad captured QR is a permanent receipt error, distinct from expired
    // POS credentials (401/403), which the terminal must keep retrying.
    if ([400, 401].includes(error.statusCode)) throw invalid(error.message, 422);
    throw error;
  }
  if (customers.length !== 1 || customers[0].deleted_at) {
    throw invalid('Клиент по QR-коду не найден', 404);
  }
  return resolveBonusOwner(customers[0].id, new Date(scannedAt).toISOString());
}

module.exports = { resolveOfflineLoyaltyCustomer };
