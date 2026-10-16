import { beforeEach, expect, it, vi } from 'vitest';
import { request } from '../../lib/api';
import { roundsApi } from './api';
vi.mock('../../lib/api', () => ({ request: vi.fn().mockResolvedValue({}) }));
beforeEach(() => vi.clearAllMocks());
it('uses the shared authenticated request helper, encoded date/city filters and explicit JSON mutations', async () => {
  const signal = new AbortController().signal;
  await roundsApi.list('2026-10-16', '2026-10-22', 'Актау', signal);
  const [url, options, auth] = vi.mocked(request).mock.calls[0];
  const query = new URL(String(url), 'https://bulka.com.kz').searchParams;
  expect(query.get('city')).toBe('Актау');
  expect(query.get('from')).toBe('2026-10-16');
  expect(options).toEqual({ signal });
  expect(auth).toEqual({ branchScope: '' });
  await roundsApi.updateInspector('unsafe/id', { active: false });
  expect(request).toHaveBeenLastCalledWith(
    '/rounds/inspectors/unsafe%2Fid',
    { method: 'PATCH', body: '{"active":false}' },
    { branchScope: '' },
  );
  await roundsApi.password('person');
  expect(request).toHaveBeenLastCalledWith(
    '/rounds/inspectors/person/password',
    { method: 'POST', body: '{}' },
    { branchScope: '' },
  );
  await roundsApi.cancel('round');
  expect(request).toHaveBeenLastCalledWith(
    '/rounds/round/cancel',
    { method: 'POST', body: '{}' },
    { branchScope: '' },
  );
});
