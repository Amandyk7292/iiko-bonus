const assert = require('node:assert/strict');
const test = require('node:test');

const {
  readinessSnapshot,
  registerWorker,
  renderWorkerMetrics,
  runMonitoredWorker,
  workerSnapshot,
} = require('../src/services/operational-health.service');

test('worker monitoring records successful and failed runs without exposing messages', async () => {
  registerWorker('test-success', { intervalMs: 1000 });
  await runMonitoredWorker('test-success', async () => {});
  registerWorker('test-failure', { intervalMs: 1000 });
  await runMonitoredWorker('test-failure', async () => {
    const error = new Error('sensitive worker detail');
    error.code = 'EXPECTED_FAILURE';
    throw error;
  });

  const snapshots = workerSnapshot();
  assert.equal(snapshots.find((worker) => worker.name === 'test-success').runs, 1);
  const failed = snapshots.find((worker) => worker.name === 'test-failure');
  assert.equal(failed.failures, 1);
  assert.equal(failed.lastErrorCode, 'EXPECTED_FAILURE');
  assert.doesNotMatch(JSON.stringify(failed), /sensitive worker detail/);
  assert.match(renderWorkerMetrics(), /bulka_worker_failures_total\{worker="test-failure"\} 1/);
});

test('readiness reports database state without retired payment dependencies', async () => {
  const ready = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
  });
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.dependencies, { database: { ok: true } });

  const unavailable = await readinessSnapshot({
    databaseCheck: async () => ({ ok: false }),
  });
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.dependencies, { database: { ok: false } });
});
