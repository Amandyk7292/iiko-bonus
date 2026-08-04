import { describe, expect, it } from 'vitest';
import { isCancellationReasonValid, normalizeCancellationReason } from './order-validation';

describe('order cancellation reason', () => {
  it('rejects empty, short and punctuation-only reasons', () => {
    for (const value of ['', '  ', ',', '...', 'не']) {
      expect(isCancellationReasonValid(value), value).toBe(false);
    }
  });

  it('accepts a meaningful customer-facing reason', () => {
    expect(isCancellationReasonValid('Товара нет')).toBe(true);
    expect(isCancellationReasonValid('Брак')).toBe(true);
    expect(isCancellationReasonValid('123')).toBe(true);
  });

  it('normalizes whitespace before sending the reason', () => {
    expect(normalizeCancellationReason('  Товара   нет  ')).toBe('Товара нет');
  });
});
