const crypto = require('node:crypto');
const messages = {
  FORTUNE_UNAVAILABLE: 'Розыгрыш сейчас недоступен',
  FORTUNE_RECEIPT_UNAVAILABLE: 'Не удалось проверить чек в iiko. Попробуйте позже',
  FORTUNE_RECEIPT_INVALID: 'Чек не найден. Сфотографируйте фискальный чек целиком с QR-кодом',
  FORTUNE_RECEIPT_USED: 'Этот чек уже участвовал в розыгрыше',
  FORTUNE_EXPIRED: 'Срок получения приза истёк',
  FORTUNE_CLAIM_INVALID: 'Приз не найден или уже получен другим аккаунтом',
  FORTUNE_VERSION_CONFLICT: 'Настройки уже изменились. Откройте их заново',
  FORTUNE_FORBIDDEN: 'Нет доступа',
  FORTUNE_CONFIG_INVALID: 'Проверьте настройки розыгрыша',
};
const failure = (code, statusCode = 409) =>
  Object.assign(new Error(messages[code] || messages.FORTUNE_UNAVAILABLE), { code, statusCode });
function databaseError(error) {
  const match = /FORTUNE_[A-Z_]+/.exec(error?.message || '');
  return failure(match?.[0] || 'FORTUNE_UNAVAILABLE', match ? 409 : 503);
}
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const opaqueToken = () => crypto.randomBytes(32).toString('base64url');
function claimToken(drawId, guestHash) {
  const secret = process.env.CUSTOMER_JWT_SECRET;
  if (!secret || secret.length < 24) throw failure('FORTUNE_UNAVAILABLE', 503);
  return crypto
    .createHmac('sha256', secret)
    .update(`bulka:fortune:claim:v1:${drawId}:${guestHash}`)
    .digest('base64url');
}
function safePrize(row, branchName) {
  const p = row.prize_snapshot;
  const expired = row.status !== 'redeemed' && Date.parse(row.expires_at) <= Date.now();
  return {
    id: row.id,
    prizeId: row.prize_id,
    prizeLabel: p.label,
    prizeKind: p.kind,
    bonusAmount: p.bonusAmount || null,
    status: expired ? 'expired' : row.status,
    wonAt: row.won_at,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    redeemedAt: row.redeemed_at,
    branchName: branchName || null,
  };
}
module.exports = { hash, opaqueToken, claimToken, failure, databaseError, safePrize };
