import { describe, expect, it } from 'vitest';
import type { InventoryItem } from './api';
import {
  inventoryDraftFromItem,
  inventoryItemKey,
  inventoryQuantity,
  mergeInventoryDrafts,
} from './inventory-drafts';

const item = (quantity: number, stopped = false): InventoryItem => ({
  branch_id: 'branch-1',
  product_id: 'product-1',
  product_name: 'Круассан',
  source_quantity: quantity,
  manual_stop: stopped,
  source: 'admin',
});
describe('inventory draft merge', () => {
  it('validates whole and fractional stock quantities against the configured step', () => {
    expect(inventoryQuantity('', 1)).toEqual({ valid: true, value: null });
    expect(inventoryQuantity('12', 1)).toEqual({ valid: true, value: 12 });
    expect(inventoryQuantity('1.25', 0.001)).toEqual({ valid: true, value: 1.25 });
    expect(inventoryQuantity('1.25', 1).valid).toBe(false);
    expect(inventoryQuantity('-1', 1).valid).toBe(false);
    expect(inventoryQuantity('100001', 1).valid).toBe(false);
    expect(inventoryQuantity('not-a-number', 1).valid).toBe(false);
  });

  it('refreshes pristine rows from realtime data', () => {
    const previous = item(5);
    const next = item(4);
    const result = mergeInventoryDrafts({
      previousItems: [previous],
      nextItems: [next],
      drafts: { [inventoryItemKey(previous)]: inventoryDraftFromItem(previous) },
      dirtyKeys: new Set(),
      conflicts: {},
    });

    expect(result.drafts[inventoryItemKey(next)]).toEqual({ quantity: '4', stopped: false });
    expect(result.conflicts).toEqual({});
  });

  it('keeps a local edit and exposes a server conflict', () => {
    const previous = item(5);
    const next = item(3, true);
    const key = inventoryItemKey(previous);
    const result = mergeInventoryDrafts({
      previousItems: [previous],
      nextItems: [next],
      drafts: { [key]: { quantity: '8', stopped: false } },
      dirtyKeys: new Set([key]),
      conflicts: {},
    });

    expect(result.drafts[key]).toEqual({ quantity: '8', stopped: false });
    expect(result.conflicts[key]).toEqual({ quantity: '3', stopped: true });
  });

  it('keeps an unresolved conflict visible on the next poll', () => {
    const current = item(3, true);
    const key = inventoryItemKey(current);
    const result = mergeInventoryDrafts({
      previousItems: [current],
      nextItems: [current],
      drafts: { [key]: { quantity: '8', stopped: false } },
      dirtyKeys: new Set([key]),
      conflicts: { [key]: inventoryDraftFromItem(current) },
    });

    expect(result.conflicts[key]).toEqual({ quantity: '3', stopped: true });
  });
});
