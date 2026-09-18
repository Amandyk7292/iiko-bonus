import type { InventoryItem } from './api';

export type InventoryDraft = {
  quantity: string;
  stopped: boolean;
};

export type InventoryConflicts = Record<string, InventoryDraft>;

export const inventoryItemKey = (item: Pick<InventoryItem, 'branch_id' | 'product_id'>) =>
  `${item.branch_id}:${item.product_id}`;

export const inventoryDraftFromItem = (item: InventoryItem): InventoryDraft => ({
  quantity: item.source_quantity == null ? '' : String(item.source_quantity),
  stopped: item.manual_stop,
});

export const inventoryDraftsEqual = (left: InventoryDraft, right: InventoryDraft) =>
  left.quantity === right.quantity && left.stopped === right.stopped;

export const inventoryQuantity = (draft: string, quantityStep = 1) => {
  if (draft.trim() === '') return { valid: true as const, value: null };
  const value = Number(draft);
  const scaled = Math.round(value * 1000);
  const step = Math.round(quantityStep * 1000);
  const valid =
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100000 &&
    Math.abs(value * 1000 - scaled) <= 0.000001 &&
    step > 0 &&
    scaled % step === 0;
  return valid
    ? { valid: true as const, value }
    : { valid: false as const, value: null };
};

export function mergeInventoryDrafts({
  previousItems,
  nextItems,
  drafts,
  dirtyKeys,
  conflicts,
}: {
  previousItems: InventoryItem[];
  nextItems: InventoryItem[];
  drafts: Record<string, InventoryDraft>;
  dirtyKeys: ReadonlySet<string>;
  conflicts: InventoryConflicts;
}) {
  const previousByKey = new Map(previousItems.map((item) => [inventoryItemKey(item), item]));
  const nextDrafts: Record<string, InventoryDraft> = {};
  const nextConflicts: InventoryConflicts = {};

  for (const item of nextItems) {
    const key = inventoryItemKey(item);
    const serverDraft = inventoryDraftFromItem(item);
    if (!dirtyKeys.has(key) || !drafts[key]) {
      nextDrafts[key] = serverDraft;
      continue;
    }

    nextDrafts[key] = drafts[key];
    const previousItem = previousByKey.get(key);
    const previousServerDraft = previousItem ? inventoryDraftFromItem(previousItem) : null;
    if (
      conflicts[key] ||
      !previousServerDraft ||
      !inventoryDraftsEqual(previousServerDraft, serverDraft)
    ) {
      nextConflicts[key] = serverDraft;
    }
  }

  return { drafts: nextDrafts, conflicts: nextConflicts };
}
