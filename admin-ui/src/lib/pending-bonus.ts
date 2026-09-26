export interface PendingBonus {
  operationId: string;
  customerId: string;
  amount: number;
  reason: string;
  branchScope: string;
}
const key = (username: string, customerId: string) =>
  `bulka:pending-bonus:${encodeURIComponent(username)}:${customerId}`;

export function loadPendingBonus(username: string, customerId: string): PendingBonus | null {
  const raw = localStorage.getItem(key(username, customerId));
  if (!raw) return null;
  const pending = JSON.parse(raw) as PendingBonus;
  if (
    !pending ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pending.operationId,
    ) ||
    pending.customerId !== customerId ||
    !Number.isFinite(pending.amount) ||
    pending.amount === 0 ||
    typeof pending.reason !== 'string' ||
    typeof pending.branchScope !== 'string'
  ) {
    throw new Error('Не удалось прочитать незавершённую корректировку. Требуется сверка баланса.');
  }
  return pending;
}
export function savePendingBonus(username: string, pending: PendingBonus) {
  localStorage.setItem(key(username, pending.customerId), JSON.stringify(pending));
}
export function clearPendingBonus(username: string, customerId: string) {
  localStorage.removeItem(key(username, customerId));
}
