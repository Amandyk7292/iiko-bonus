import { describe, expect, it } from 'vitest';
import { mergeCampaign } from './merge-campaign';
import { campaignInput, newCampaign, type Campaign } from './model';

const text = (ru: string) => ru;
const branch = '11111111-1111-4111-8111-111111111111';
function campaign(): Campaign {
  const value = newCampaign(text);
  return {
    ...value,
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Подарки октября',
    branchIds: [branch],
    version: 3,
    createdAt: '2026-10-11T00:00:00Z',
    updatedAt: '2026-10-11T00:00:00Z',
    prizes: value.prizes.map((prize, index) => ({
      ...prize,
      id: `44444444-4444-4444-8444-44444444444${index}`,
    })),
  };
}

describe('fortune campaign concurrent edits', () => {
  it('preserves unrelated local/server edits and authoritative metadata without mutating inputs', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    draft.minReceiptAmount = 10;
    latest.title = 'Подарки ноября';
    latest.prizes[0].color = '#782b0e';
    latest.prizes[0].issuedCount = 3;
    latest.version = 4;
    latest.updatedAt = '2026-10-13T12:00:00Z';
    const before = structuredClone({ base, draft, latest });
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.conflicts).toEqual([]);
    expect(result.issue).toBeFalsy();
    for (const merged of [result.mine, result.theirs]) {
      expect(merged).toMatchObject({
        title: latest.title,
        minReceiptAmount: 10,
        version: 4,
        updatedAt: latest.updatedAt,
      });
      expect(merged.prizes[0]).toMatchObject({ color: '#782b0e', issuedCount: 3 });
      expect(campaignInput(merged).expectedVersion).toBe(4);
      expect(campaignInput(merged).prizes[0]).not.toHaveProperty('issuedCount');
    }
    expect({ base, draft, latest }).toEqual(before);
  });

  it('offers choices only for fields edited differently while keeping unrelated edits in both', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    draft.minReceiptAmount = 10;
    draft.title = 'Моя новая акция';
    latest.minReceiptAmount = 15;
    latest.maxReceiptAgeHours = 48;
    latest.version = 4;
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatch(/сумм/i);
    expect(result.mine.minReceiptAmount).toBe(10);
    expect(result.theirs.minReceiptAmount).toBe(15);
    for (const merged of [result.mine, result.theirs]) {
      expect(merged.title).toBe('Моя новая акция');
      expect(merged.maxReceiptAgeHours).toBe(48);
      expect(merged.version).toBe(4);
    }
  });

  it('accepts equal simultaneous changes and merges different fields of the same prize by id', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    draft.minReceiptAmount = latest.minReceiptAmount = 10;
    draft.prizes[0].label = 'Новый подарок';
    latest.prizes[0].color = '#d28023';
    latest.prizes.reverse();
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.conflicts).toEqual([]);
    for (const merged of [result.mine, result.theirs]) {
      expect(merged.minReceiptAmount).toBe(10);
      expect(merged.prizes.find((prize) => prize.id === base.prizes[0].id)).toMatchObject({
        label: 'Новый подарок',
        color: '#d28023',
      });
    }
  });

  it('merges branch membership changes without treating checkbox order as a conflict', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    base.branchIds = ['a', 'b'];
    draft.branchIds = ['c', 'b', 'a'];
    latest.branchIds = ['a', 'd'];
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.conflicts).toEqual([]);
    for (const merged of [result.mine, result.theirs])
      expect([...merged.branchIds].sort()).toEqual(['a', 'c', 'd']);
  });

  it('offers an explicit sector-list choice when both administrators change its structure', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    draft.prizes = draft.prizes.filter((prize) => prize.id !== base.prizes[0].id);
    const added = { ...latest.prizes[0], id: 'added-server-prize', label: 'Новый приз' };
    latest.prizes.push(added);
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.conflicts).toEqual(['Призы']);
    expect(result.issue).toBeFalsy();
    expect(result.mine.prizes.map((prize) => prize.id)).toEqual(
      draft.prizes.map((prize) => prize.id),
    );
    expect(result.theirs.prizes.map((prize) => prize.id)).toEqual(
      latest.prizes.map((prize) => prize.id),
    );
  });

  it('requires a choice for deleting a sector concurrently edited by another administrator', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    draft.prizes = draft.prizes.filter((prize) => prize.id !== base.prizes[0].id);
    latest.prizes[0].label = 'Изменённый приз';
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.conflicts).toHaveLength(1);
    expect(result.mine.prizes.some((prize) => prize.id === base.prizes[0].id)).toBe(false);
    expect(result.theirs.prizes.find((prize) => prize.id === base.prizes[0].id)?.label).toBe(
      'Изменённый приз',
    );
  });

  it('restores a sector that was issued after editing began rather than silently deleting it', () => {
    const base = campaign(),
      draft = structuredClone(base),
      latest = structuredClone(base);
    draft.prizes = draft.prizes.filter((prize) => prize.id !== base.prizes[0].id);
    latest.prizes[0].issuedCount = 1;
    latest.version = 4;
    const result = mergeCampaign(base, draft, latest, text);
    expect(result.issue).toBeTruthy();
    for (const merged of [result.mine, result.theirs]) {
      expect(merged.prizes.find((prize) => prize.id === base.prizes[0].id)?.issuedCount).toBe(1);
      expect(merged.version).toBe(4);
    }
  });
});
