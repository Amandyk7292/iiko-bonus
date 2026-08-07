import { describe, expect, it } from 'vitest';
import {
  ADMIN_ALLOWED_PATHS,
  availableOrderStatuses,
  canMutateInventory,
  canMutateOrders,
  canRefundOrders,
} from './admin-permissions';

describe('admin permissions shown by the frontend', () => {
  it('keeps viewer controls read-only and refund controls privileged', () => {
    expect(canMutateOrders('viewer')).toBe(false);
    expect(canMutateInventory('viewer')).toBe(false);
    expect(canMutateOrders('operator')).toBe(true);
    expect(canRefundOrders('operator')).toBe(false);
    expect(canRefundOrders('branch_manager')).toBe(true);
  });

  it('offers only valid forward order transitions for the current role', () => {
    expect(availableOrderStatuses('preparing', false)).toEqual(['preparing', 'ready', 'completed']);
    expect(availableOrderStatuses('ready', true)).toEqual(['ready', 'completed', 'cancelled']);
    expect(availableOrderStatuses('completed', true)).toEqual(['completed']);
  });

  it('gives the supported editor role only backend-compatible sections', () => {
    expect(ADMIN_ALLOWED_PATHS.editor).toContain('/orders');
    expect(ADMIN_ALLOWED_PATHS.editor).toContain('/inventory');
    expect(ADMIN_ALLOWED_PATHS.editor).not.toContain('/access');
    expect(ADMIN_ALLOWED_PATHS.editor).not.toContain('/security');
    expect(ADMIN_ALLOWED_PATHS.editor).not.toContain('/settings');
  });

  it('keeps a cashier inside orders and kitchen without financial controls', () => {
    expect(ADMIN_ALLOWED_PATHS.cashier).toEqual(['/orders', '/kitchen']);
    expect(canMutateOrders('cashier')).toBe(false);
    expect(canRefundOrders('cashier')).toBe(false);
    expect(canMutateInventory('cashier')).toBe(false);
  });
});
