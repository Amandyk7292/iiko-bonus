export function transactionLabel(
  transaction: { order_id?: string | null; order_number?: number | null; type?: string },
  t: (key: string, params?: Record<string, string>) => string,
) {
  const id = String(transaction.order_id || '');
  const type = String(transaction.type || '');
  if (id === 'MANUAL' || type.includes('manual')) return t('transactions.manual');
  if (type === 'expiration' || id === 'EXPIRED_90_DAYS') return t('transactions.expiration');
  if (id.startsWith('kaspi:')) {
    const [, operationId, suffix] = id.split(':');
    const refund = suffix === 'refund' || type.startsWith('refund_');
    if (transaction.order_number) {
      return t(refund ? 'transactions.orderRefund' : 'transactions.orderNumber', {
        id: String(transaction.order_number),
      });
    }
    return t(refund ? 'transactions.onlineRefund' : 'transactions.onlinePurchase', {
      id: operationId || '—',
    });
  }
  return t('transactions.receipt', { id: id || '—' });
}

export function transactionItem(item: Record<string, unknown>) {
  const quantity = Number(item.quantity ?? item.amount ?? 0);
  const price = Number(item.price ?? 0);
  return {
    name: String(item.productName || item.name || ''),
    quantity,
    price,
    total: Number(item.total ?? price * quantity),
  };
}
