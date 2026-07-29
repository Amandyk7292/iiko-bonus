import { describe, expect, it } from 'vitest';
import { ApiError, adminApiErrorMessage } from './api';

describe('admin API errors', () => {
  it('hides internal messages and gives a recovery path with request id', () => {
    const message = adminApiErrorMessage(
      { error: 'Internal Server Error', requestId: 'req-123' },
      500,
    );

    expect(message).not.toContain('Internal Server Error');
    expect(message).toContain('Обновите данные и повторите попытку');
    expect(message).toContain('req-123');
  });

  it('keeps request id visible for expected validation errors', () => {
    expect(
      adminApiErrorMessage(
        { error: 'Укажите причину отмены', requestId: 'req-validation' },
        400,
      ),
    ).toBe('Укажите причину отмены Код запроса: req-validation.');
  });

  it('shows a useful validation field message when the server provides one', () => {
    expect(
      adminApiErrorMessage(
        {
          error: 'Некорректные параметры запроса',
          code: 'VALIDATION_ERROR',
          fields: [
            { path: 'storage_conditions.0.temperature', message: 'Too small' },
            { path: 'storage_conditions.0.duration_value', message: 'Укажите срок хранения' },
          ],
          requestId: 'req-fields',
        },
        400,
      ),
    ).toBe('Укажите срок хранения Код запроса: req-fields.');
  });

  it('retains request id on the typed error', () => {
    const error = new ApiError('Ошибка', 503, 'SERVICE_UNAVAILABLE', undefined, 'req-503');
    expect(error.requestId).toBe('req-503');
  });
});
