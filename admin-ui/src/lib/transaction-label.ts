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

export function transactionPresentation(transaction: { type?: string; order_id?: string | null }) {
  const type = String(transaction.type || '');
  if (['deposit', 'manual_deposit', 'manual', 'refund_bonus_restore'].includes(type)) {
    return {
      sign: '+',
      valueClass: 'value-positive',
      statusClass: 'status-active',
      paidWithBonuses: false,
    };
  }
  if (type === 'pending_deposit') {
    return {
      sign: '+',
      valueClass: 'value-info',
      statusClass: 'status-warning',
      paidWithBonuses: false,
    };
  }
  if (['withdrawal', 'manual_withdrawal', 'expiration', 'refund_reversal'].includes(type)) {
    return {
      sign: '−',
      valueClass: 'value-negative',
      statusClass: 'status-danger',
      paidWithBonuses: type === 'withdrawal' && Boolean(transaction.order_id),
    };
  }
  // Cancelled credits and order records do not change the bonus balance.
  return { sign: '', valueClass: '', statusClass: 'status-inactive', paidWithBonuses: false };
}
