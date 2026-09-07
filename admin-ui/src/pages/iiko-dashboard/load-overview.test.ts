import { expect, it, vi } from 'vitest';
import { loadOverview } from './load-overview';
import type { Query, Report } from './model';
const query: Query = {
  serverId: 'aktau-chain',
  reportType: 'SALES',
  from: '2026-09-01',
  to: '2026-09-07',
  groupBy: [],
  aggregate: ['DishDiscountSumInt'],
  filters: [],
};
const result: Report = {
  rows: [{ DishDiscountSumInt: 123 }],
  columns: {},
  serverId: query.serverId,
  period: { from: query.from, to: query.to },
  fetchedAt: '2026-09-07T00:00:00Z',
};
function deferred() {
  let resolve!: (value: Report) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Report>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('shows real summary before slow comparisons and keeps it after a comparison failure', async () => {
  const jobs = Array.from({ length: 4 }, deferred);
  const publish = vi.fn();
  let index = 0;
  const report = vi.fn(() => jobs[index++].promise);
  const done = loadOverview(
    report,
    query,
    { ...query, from: '2026-08-25', to: '2026-08-31' },
    new AbortController().signal,
    publish,
  );
  expect(report).toHaveBeenCalledTimes(4);
  jobs[0].resolve(result);
  await Promise.resolve();
  expect(publish).toHaveBeenLastCalledWith({ summary: result });
  jobs[1].resolve(result);
  jobs[2].reject(new Error('comparison unavailable'));
  jobs[3].resolve(result);
  await expect(done).rejects.toThrow('comparison unavailable');
  expect(publish.mock.lastCall?.[0].summary).toBe(result);
});
it('does not publish results for a city or period abandoned by the user', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const publish = vi.fn();
  const done = loadOverview(() => gate.promise, query, undefined, controller.signal, publish);
  controller.abort();
  gate.resolve(result);
  await done;
  expect(publish).not.toHaveBeenCalled();
});
