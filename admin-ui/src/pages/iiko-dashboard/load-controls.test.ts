import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../lib/api', () => ({ request: vi.fn(), ApiError: class extends Error {} }));
import { request } from '../../lib/api';
import { isIikoRequestPending } from '../../lib/iiko-request-policy';
import { loadControls } from './load-controls';
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
it('waits through pending responses and blocks auto refresh between polls', async () => {
  vi.useFakeTimers();
  vi.mocked(request)
    .mockResolvedValueOnce({ pending: true })
    .mockResolvedValueOnce({ tables: { assortment: { rows: [1] } } });
  const work = loadControls({ from: '2026-08-01' }, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(500);
  expect(isIikoRequestPending()).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(await work).toEqual({ tables: { assortment: { rows: [1] } } });
  expect(isIikoRequestPending()).toBe(false);
});
it('cancels polling immediately when a different period is selected', async () => {
  vi.useFakeTimers();
  vi.mocked(request).mockResolvedValue({ pending: true });
  const controller = new AbortController();
  const work = loadControls({}, controller.signal);
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(2000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(isIikoRequestPending()).toBe(false);
});
