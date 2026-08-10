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
  const metrics = renderWorkerMetrics();
  assert.match(metrics, /bulka_worker_failures_total\{worker="test-failure"\} 1/);
  assert.match(metrics, /bulka_loyalty_pos_safety_rejections_total\{kind="transaction"\}/);
});

test('readiness reports database state without retired payment dependencies', async () => {
  const branchPosCheck = async () => ({
    activeBranches: 17,
    configuredActiveBranches: 17,
    missingActiveBranches: 0,
    activeLegacyReservations: 0,
    readyForEnforcement: true,
  });
  const ready = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck,
  });
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.dependencies, {
    database: { ok: true },
    branchPosCredentials: {
      ok: true,
      mode: 'compatibility',
      activeBranches: 17,
      configuredActiveBranches: 17,
      missingActiveBranches: 0,
      activeLegacyReservations: 0,
      readyForEnforcement: true,
    },
  });

  const unavailable = await readinessSnapshot({
    databaseCheck: async () => ({ ok: false }),
    branchPosCheck,
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.dependencies.database.ok, false);
});

test('required POS enforcement fails readiness until every active branch is provisioned', async (t) => {
  const previousMode = process.env.LOYALTY_BRANCH_POS_ENFORCEMENT;
  process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = 'required';
  t.after(() => {
    if (previousMode === undefined) delete process.env.LOYALTY_BRANCH_POS_ENFORCEMENT;
    else process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = previousMode;
  });
  const result = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck: async () => ({
      activeBranches: 17,
      configuredActiveBranches: 16,
      missingActiveBranches: 1,
      activeLegacyReservations: 0,
      readyForEnforcement: false,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.dependencies.branchPosCredentials.ok, false);
});

test('required POS enforcement also waits for active legacy reservations to drain', async (t) => {
  const previousMode = process.env.LOYALTY_BRANCH_POS_ENFORCEMENT;
  process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = 'required';
  t.after(() => {
    if (previousMode === undefined) delete process.env.LOYALTY_BRANCH_POS_ENFORCEMENT;
    else process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = previousMode;
  });
  const result = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck: async () => ({
      activeBranches: 17,
      configuredActiveBranches: 17,
      missingActiveBranches: 0,
      activeLegacyReservations: 1,
      readyForEnforcement: false,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.dependencies.branchPosCredentials.activeLegacyReservations, 1);
});
