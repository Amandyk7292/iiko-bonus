export function transactionLabel(
  transaction: { order_id?: string | null; type?: string },
  t: (key: string, params?: Record<string, string>) => string,
) {
  const id = String(transaction.order_id || '');
  const type = String(transaction.type || '');
  if (id === 'MANUAL' || type.includes('manual')) return t('transactions.manual');
  if (type === 'expiration' || id === 'EXPIRED_90_DAYS') return t('transactions.expiration');
  if (id.startsWith('kaspi:')) {
    const [, operationId, suffix] = id.split(':');
    const refund = suffix === 'refund' || type.startsWith('refund_');
    return t(refund ? 'transactions.onlineRefund' : 'transactions.onlinePurchase', {
      id: operationId || '—',
    });
  }
  return t('transactions.receipt', { id: id || '—' });
}
