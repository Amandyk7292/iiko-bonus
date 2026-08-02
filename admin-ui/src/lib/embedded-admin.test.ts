import { describe, expect, it } from 'vitest';
import { isEmbeddedAdminPortal } from './embedded-admin';

describe('embedded admin navigation', () => {
  it('detects only the explicit in-app mode', () => {
    expect(isEmbeddedAdminPortal('?embedded=app')).toBe(true);
    expect(isEmbeddedAdminPortal('?city=all&embedded=app')).toBe(true);
    expect(isEmbeddedAdminPortal('?embedded=browser')).toBe(false);
    expect(isEmbeddedAdminPortal('')).toBe(false);
  });
});
