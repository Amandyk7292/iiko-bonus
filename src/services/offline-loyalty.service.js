const { searchCustomers } = require('./customer.service');

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

// Only the branch-authenticated earn-only endpoint supplies a historical QR
// time. Normal search and all write-offs retain the live five-minute QR check.
async function resolveOfflineLoyaltyCustomer(
  payload,
  { lookup = searchCustomers, now = Date.now() } = {},
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
  return customers[0].id;
}

module.exports = { resolveOfflineLoyaltyCustomer };
