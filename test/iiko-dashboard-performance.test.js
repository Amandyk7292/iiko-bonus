const test = require('node:test');
const assert = require('node:assert/strict');
const { Response } = require('node-fetch');
const { IikoDashboardClient } = require('../src/services/iiko-dashboard-client');
const { ReportCache } = require('../src/services/iiko-dashboard-cache');
const { IikoDashboardService } = require('../src/services/iiko-dashboard.service');
const tick = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test('session limits parallel jobs and waits for all readers before logout', async () => {
  const gates = Array.from({ length: 5 }, deferred);
  let active = 0,
    peak = 0,
    logins = 0,
    logouts = 0;
  const client = new IikoDashboardClient({
    credentials: () => ({ login: 'test', password: 'test' }),
    fetchImpl: async (url) => {
      if (new URL(url).pathname.endsWith('/auth')) {
        logins++;
        return new Response('12345678-1234-1234-1234-123456789012');
      }
      assert.equal(active, 0);
      logouts++;
      return new Response('');
    },
  });
  const jobs = gates.map((gate) =>
    client.withSession('aktau-chain', async () => {
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
    }),
  );
  await tick();
  assert.equal(active, 3);
  assert.equal(logouts, 0);
  gates.slice(0, 3).forEach((gate) => gate.resolve());
  await tick();
  assert.equal(active, 2);
  assert.equal(logouts, 0);
  gates.slice(3).forEach((gate) => gate.resolve());
  await Promise.all(jobs);
  await tick();
  assert.equal(peak, 3);
  assert.equal(logins, 1);
  assert.equal(logouts, 1);
  assert.equal(client.queues.size, 0);
});
test('cache deduplicates in-flight reports, expires, bounds memory and retries failures', async () => {
  let now = 0,
    calls = 0;
  const cache = new ReportCache({ ttlMs: 45, maxBytes: 50, now: () => now });
  const gate = deferred();
  const load = async () => {
    calls++;
    await gate.promise;
    return { rows: [1] };
  };
  const first = cache.get('aktau:query1', load);
  const second = cache.get('aktau:query1', load);
  gate.resolve();
  await Promise.all([first, second]);
  await cache.get('aktau:query1', load);
  assert.equal(calls, 1);
  await cache.get('astana:query1', load);
  assert.equal(calls, 2);
  now = 46;
  await cache.get('aktau:query1', load);
  assert.equal(calls, 3);
  await assert.rejects(cache.get('failed', () => Promise.reject(new Error('failed'))));
  assert.deepEqual(await cache.get('failed', load), { rows: [1] });
  for (let index = 0; index < 10; index++) await cache.get(`key${index}`, load);
  assert(cache.bytes <= 50);
  assert(cache.entries.size <= 4);
  await cache.get('too-large', async () => 'x'.repeat(100));
  assert(!cache.entries.has('too-large'));
  assert.equal(cache.pending.size, 0);
});
test('identical reports share work and different queries share one schema fetch', async () => {
  let schemas = 0,
    reports = 0;
  const service = new IikoDashboardService({
    withSession: async (_id, work) =>
      work(async (path) => {
        await tick();
        if (path.includes('columns')) {
          schemas++;
          return {
            'OpenDate.Typed': { filteringAllowed: true },
            Revenue: { aggregationAllowed: true },
          };
        }
        reports++;
        return { data: [{ Revenue: 10 }] };
      }),
  });
  const query = {
    serverId: 'aktau-chain',
    reportType: 'SALES',
    from: '2026-09-01',
    to: '2026-09-07',
    groupBy: [],
    aggregate: ['Revenue'],
    filters: [],
  };
  const [a, b] = await Promise.all([
    service.report(query),
    service.report(query),
    service.report({ ...query, from: '2026-09-02' }),
  ]);
  assert.deepEqual(a, b);
  assert.equal(schemas, 1);
  assert.equal(reports, 2);
  const again = await service.report(query);
  assert.equal(again.fetchedAt, a.fetchedAt);
  assert.equal(reports, 2);
});
