import { describe, expect, it } from 'vitest';
import { cashItemMatches } from './CashReport';

describe('cash report product highlighting', () => {
  it('matches a submitted product regardless of case and surrounding spaces', () => {
    expect(cashItemMatches('Кофе Американо', '  кофе  ')).toBe(true);
    expect(cashItemMatches('Кофе Американо', 'латте')).toBe(false);
  });

  it('does not highlight every receipt item before search is submitted', () => {
    expect(cashItemMatches('Кофе Американо', '')).toBe(false);
    expect(cashItemMatches('Кофе Американо', '   ')).toBe(false);
  });
});
