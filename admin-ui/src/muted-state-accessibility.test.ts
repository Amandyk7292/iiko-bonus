import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssRule = (source: string, selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

describe('muted state accessibility', () => {
  it('uses explicit surfaces and text colors instead of fading whole containers', () => {
    const contacts = readFileSync(resolve(process.cwd(), 'src/styles/contacts.css'), 'utf8');
    const release = readFileSync(resolve(process.cwd(), 'src/styles/release.css'), 'utf8');

    const loyaltyRow = cssRule(release, '.row-muted');
    const loyaltyCells = cssRule(release, '.row-muted > td');
    expect(loyaltyRow).toContain('background');
    expect(loyaltyRow).not.toContain('opacity');
    expect(loyaltyCells).toContain('border');
    expect(loyaltyCells).toContain('color');

    for (const [source, selector] of [
      [contacts, '.contact-admin-muted'],
      [contacts, '.contact-admin-action-muted'],
      [release, '.courier-card.is-muted'],
    ] as const) {
      const rule = cssRule(source, selector);
      expect(rule, selector).toContain('background');
      expect(rule, selector).toContain('border');
      expect(rule, selector).not.toContain('opacity');
      expect(rule, selector).not.toContain('filter');
    }
  });
});
