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

test('readiness reports database and enabled Kaspi state separately', async () => {
  const previous = process.env.KASPI_POS_ENABLED;
  process.env.KASPI_POS_ENABLED = 'true';
  try {
    const ready = await readinessSnapshot({
      kaspiReady: true,
      databaseCheck: async () => ({ ok: true }),
    });
    assert.equal(ready.ok, true);
    assert.equal(ready.dependencies.database.ok, true);

    const unavailable = await readinessSnapshot({
      kaspiReady: false,
      databaseCheck: async () => ({ ok: true }),
    });
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.dependencies.kaspi.ok, false);
  } finally {
    if (previous === undefined) delete process.env.KASPI_POS_ENABLED;
    else process.env.KASPI_POS_ENABLED = previous;
  }
});
