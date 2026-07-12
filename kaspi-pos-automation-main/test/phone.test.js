import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKaspiPhoneNumber } from '../src/phone.js';

describe('Kaspi phone normalization', () => {
  it('accepts a full +7 Kazakhstan number', () => {
    assert.equal(normalizeKaspiPhoneNumber('+7 776 200 35 90'), '77762003590');
  });

  it('converts 8-prefixed numbers to 7-prefixed Kaspi format', () => {
    assert.equal(normalizeKaspiPhoneNumber('8 776 200 35 90'), '77762003590');
  });

  it('adds the country prefix to local 10-digit numbers', () => {
    assert.equal(normalizeKaspiPhoneNumber('776 200 35 90'), '77762003590');
  });

  it('rejects invalid lengths', () => {
    assert.equal(normalizeKaspiPhoneNumber('776200359'), null);
    assert.equal(normalizeKaspiPhoneNumber('777620035900'), null);
  });
});
