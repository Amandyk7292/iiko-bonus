import { describe, expect, it } from 'vitest';
import { adminApiErrorMessage, ApiError } from './api';

describe('admin API errors', () => {
  it('turns internal errors into an actionable message with the support request id', () => {
    const requestId = '12eaf4f5-d65b-401d-8ad7-12b7e345e567';
    const message = adminApiErrorMessage({ error: 'Internal Server Error', requestId }, 500);

    expect(message).toContain('Повторите попытку');
    expect(message).toContain(requestId);
    expect(message).not.toContain('Internal Server Error');
  });

  it('keeps request id on the typed error', () => {
    const error = new ApiError('Ошибка', 500, 'INTERNAL_ERROR', undefined, 'req-123');
    expect(error.requestId).toBe('req-123');
  });
});
