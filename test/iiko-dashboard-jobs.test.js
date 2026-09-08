const test = require('node:test');
const assert = require('node:assert/strict');
const { ReportJobs } = require('../src/services/iiko-dashboard-jobs');
const tick = () => new Promise(setImmediate);
test('polling and export share one calculation, with scoped keys and expiring results', async () => {
  let done,
    now = 0,
    calls = 0;
  const jobs = new ReportJobs({ now: () => now, ttlMs: 45 });
  const load = () => {
    calls++;
    return new Promise((resolve) => {
      done = resolve;
    });
  };
  assert.deepEqual(jobs.read('aktau:august', load), { pending: true });
  await tick();
  jobs.read('aktau:august', load);
  const download = jobs.result('aktau:august', load);
  done({ rows: [1] });
  assert.deepEqual(await download, { rows: [1] });
  assert.deepEqual(jobs.read('aktau:august', load), { rows: [1] });
  assert.equal(calls, 1);
  assert.deepEqual(
    jobs.read('astana:august', async () => ({ rows: [2] })),
    { pending: true },
  );
  await tick();
  assert.deepEqual(jobs.read('astana:august', load), { rows: [2] });
  now = 46;
  assert.deepEqual(jobs.read('aktau:august', load), { pending: true });
});
test('pending work and retained data are bounded; errors permit retry and overdue results cannot overwrite failure', async () => {
  let now = 0,
    done;
  const jobs = new ReportJobs({ now: () => now, deadlineMs: 10, maxEntries: 1, maxBytes: 20 });
  const pending = () =>
    new Promise((resolve) => {
      done = resolve;
    });
  jobs.read('one', pending);
  await tick();
  assert.throws(() => jobs.read('two', pending), { code: 'IIKO_REPORT_BUSY' });
  now = 11;
  assert.throws(() => jobs.read('one', pending), { code: 'IIKO_REPORT_TIMEOUT' });
  done({ rows: [1] });
  await tick();
  jobs.read('one', async () => ({ rows: ['x'.repeat(100)] }));
  await tick();
  assert.throws(() => jobs.read('one', pending), { code: 'IIKO_REPORT_TOO_LARGE' });
  jobs.read('one', async () => ({ rows: [] }));
  await tick();
  assert.deepEqual(jobs.read('one', pending), { rows: [] });
});
test('async controls stay owner-only and no-store, return promptly, and reuse the completed result', async (t) => {
  const express = require('express');
  const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
  let done,
    calls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-fixture-role'] };
    next();
  });
  registerIikoDashboardRoutes(app, {
    controls: () => {
      calls++;
      return new Promise((resolve) => {
        done = resolve;
      });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/controls`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Iiko-Async': '1',
      'x-fixture-role': 'cashier',
    },
    body: JSON.stringify({
      serverId: 'aktau-chain',
      mode: 'assortment',
      from: '2026-08-01',
      to: '2026-08-31',
    }),
  };
  assert.equal((await fetch(url, options)).status, 403);
  assert.equal(calls, 0);
  options.headers['x-fixture-role'] = 'owner';
  const response = await fetch(url, options);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { pending: true });
  done({ period: { from: '2026-08-01', to: '2026-08-31' }, tables: {} });
  await tick();
  assert.deepEqual((await (await fetch(url, options)).json()).tables, {});
  assert.equal(calls, 1);
});
