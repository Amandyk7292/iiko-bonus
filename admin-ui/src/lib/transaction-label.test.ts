import { describe, expect, it } from 'vitest';
import { transactionItem, transactionLabel } from './transaction-label';

const t = (key: string, params?: Record<string, string>) => `${key}:${params?.id || ''}`;

describe('transaction labels', () => {
  it('uses the same sequential order number for the purchase and its refund', () => {
    expect(transactionLabel({ order_id: 'kaspi:abc-123', order_number: 100039 }, t)).toBe(
      'transactions.orderNumber:100039',
    );
    expect(transactionLabel({ order_id: 'kaspi:abc-123:refund', order_number: 100039 }, t)).toBe(
      'transactions.orderRefund:100039',
    );
  });
  it('reads stored checkout items and legacy iiko items without losing names or quantities', () => {
    expect(transactionItem({ name: 'Плюшка Московская', quantity: 1, price: 35 })).toEqual({
      name: 'Плюшка Московская',
      quantity: 1,
      price: 35,
      total: 35,
    });
    expect(transactionItem({ productName: 'Плюшка', amount: 2, price: 35, total: 60 })).toEqual({
      name: 'Плюшка',
      quantity: 2,
      price: 35,
      total: 60,
    });
  });
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
