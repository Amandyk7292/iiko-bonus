import { afterEach, describe, expect, it, vi } from 'vitest';
import { faqApi, type FaqInput } from './faq';

const input: FaqInput = {
  questionRu: 'Вопрос',
  answerRu: 'Ответ',
  questionKk: '',
  answerKk: '',
  sortOrder: 2,
  isActive: true,
};

describe('FAQ API transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('adminSelectedBranchId');
  });

  it('uses the existing authenticated helper for global CRUD without branch filtering', async () => {
    localStorage.setItem('adminSelectedBranchId', '11111111-1111-4111-8111-111111111111');
    const item = { ...input, id: 'faq/1' };
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              options.method ? { success: true, item } : { success: true, items: [item] },
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(await faqApi.list()).toEqual([item]);
    expect(await faqApi.create(input)).toEqual(item);
    expect(await faqApi.update('faq/1', input)).toEqual(item);
    expect(await faqApi.hide('faq/1')).toEqual(item);
    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method ?? 'GET'])).toEqual([
      ['/admin/api/faq', 'GET'],
      ['/admin/api/faq', 'POST'],
      ['/admin/api/faq/faq%2F1', 'PUT'],
      ['/admin/api/faq/faq%2F1', 'DELETE'],
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.credentials).toBe('same-origin');
      expect(options.headers.get('X-Bulka-Branch-Id')).toBeNull();
      expect(options.headers.get('X-Bulka-Branch-Ids')).toBeNull();
    }
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(input);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(input);
  });

  it('passes server errors through for the editor to preserve the draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Нет доступа' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    );
    await expect(faqApi.create(input)).rejects.toMatchObject({
      message: 'Нет доступа',
      status: 403,
    });
  });
});
