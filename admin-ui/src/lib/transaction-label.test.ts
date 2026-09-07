import { describe, expect, it } from 'vitest';
import { transactionLabel } from './transaction-label';

const t = (key: string, params?: Record<string, string>) => `${key}:${params?.id || ''}`;

describe('transaction labels', () => {
  it('presents historical and current online payment identities without provider or refund suffix', () => {
    expect(transactionLabel({ order_id: 'kaspi:abc-123' }, t)).toBe(
      'transactions.onlinePurchase:abc-123',
    );
    expect(transactionLabel({ order_id: 'kaspi:abc-123:refund' }, t)).toBe(
      'transactions.onlineRefund:abc-123',
    );
    expect(transactionLabel({ order_id: 'kaspi:abc-123', type: 'refund_bonus_restore' }, t)).toBe(
      'transactions.onlineRefund:abc-123',
    );
  });
  it('preserves ordinary receipt numbers and manual or expiration labels', () => {
    expect(transactionLabel({ order_id: '12345' }, t)).toBe('transactions.receipt:12345');
    expect(transactionLabel({ order_id: 'MANUAL' }, t)).toBe('transactions.manual:');
    expect(transactionLabel({ order_id: 'EXPIRED_90_DAYS' }, t)).toBe('transactions.expiration:');
  });
});
