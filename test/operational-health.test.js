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

test('a hung critical worker becomes stale while it is still running', async (t) => {
  registerWorker('test-hung-critical', {
    intervalMs: 1000,
    maxRunMs: 25,
    critical: true,
  });
  t.after(() =>
    registerWorker('test-hung-critical', {
      enabled: false,
      intervalMs: 1000,
      maxRunMs: 25,
      critical: true,
    }),
  );
  void runMonitoredWorker('test-hung-critical', () => new Promise(() => {}));
  await new Promise((resolve) => setImmediate(resolve));
  const running = workerSnapshot();
  const worker = running.find((entry) => entry.name === 'test-hung-critical');
  assert.equal(worker.running, true);
  assert.equal(worker.stale, false);
  const stale = workerSnapshot(Date.parse(worker.lastStartedAt) + 26).find(
    (entry) => entry.name === 'test-hung-critical',
  );
  assert.equal(stale.running, true);
  assert.equal(stale.stale, true);
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
    pushStatusCheck: () => ({ configured: false, initialized: false }),
    staffOrderAlertCheck: async () => ({
      receiverConfigured: false,
      receiverRequired: false,
      queueAvailable: true,
      pending: 2,
      queued: 0,
      configPending: 2,
      processing: 0,
      retry: 0,
      sent: 4,
      resolved: 1,
      oldestPendingSeconds: 130,
    }),
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
    staffOrderAlerts: {
      ok: true,
      receiverConfigured: false,
      receiverRequired: false,
      degraded: true,
      queueAvailable: true,
      pending: 2,
      queued: 0,
      configPending: 2,
      processing: 0,
      retry: 0,
      sent: 4,
      resolved: 1,
      oldestPendingSeconds: 130,
    },
    staffPush: {
      ok: true,
      required: false,
      workersEnabled: process.env.RUN_BACKGROUND_WORKERS === 'true',
      firebaseConfigured: false,
      firebaseInitialized: false,
    },
  });

  const unavailable = await readinessSnapshot({
    databaseCheck: async () => ({ ok: false }),
    branchPosCheck,
    pushStatusCheck: () => ({ configured: false, initialized: false }),
    staffOrderAlertCheck: async () => ({ queueAvailable: true }),
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

test('required alert receiver gates readiness while optional rollout stays degraded', async () => {
  const branchPosCheck = async () => ({ readyForEnforcement: true });
  const required = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck,
    staffOrderAlertCheck: async () => ({
      receiverRequired: true,
      receiverConfigured: false,
      queueAvailable: true,
    }),
  });
  assert.equal(required.ok, false);
  assert.equal(required.dependencies.staffOrderAlerts.ok, false);
  assert.equal(required.dependencies.staffOrderAlerts.degraded, true);

  const optional = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck,
    staffOrderAlertCheck: async () => ({
      receiverRequired: false,
      receiverConfigured: false,
      queueAvailable: true,
    }),
  });
  assert.equal(optional.ok, true);
  assert.equal(optional.dependencies.staffOrderAlerts.ok, true);
  assert.equal(optional.dependencies.staffOrderAlerts.degraded, true);

  const unavailableQueue = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck,
    staffOrderAlertCheck: async () => ({
      receiverRequired: false,
      receiverConfigured: false,
      queueAvailable: false,
    }),
  });
  assert.equal(unavailableQueue.ok, false);
  assert.equal(unavailableQueue.dependencies.staffOrderAlerts.ok, false);

  const staleRequiredBacklog = await readinessSnapshot({
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck,
    staffOrderAlertCheck: async () => ({
      receiverRequired: true,
      receiverConfigured: true,
      queueAvailable: true,
      oldestPendingSeconds: 301,
    }),
  });
  assert.equal(staleRequiredBacklog.ok, false);
  assert.equal(staleRequiredBacklog.dependencies.staffOrderAlerts.oldestPendingSeconds, 301);
});

test('required staff push gates readiness on workers and initialized Firebase', async (t) => {
  const previousRequired = process.env.STAFF_PUSH_REQUIRED;
  const previousWorkers = process.env.RUN_BACKGROUND_WORKERS;
  t.after(() => {
    if (previousRequired === undefined) delete process.env.STAFF_PUSH_REQUIRED;
    else process.env.STAFF_PUSH_REQUIRED = previousRequired;
    if (previousWorkers === undefined) delete process.env.RUN_BACKGROUND_WORKERS;
    else process.env.RUN_BACKGROUND_WORKERS = previousWorkers;
  });
  process.env.STAFF_PUSH_REQUIRED = 'true';
  process.env.RUN_BACKGROUND_WORKERS = 'false';
  const baseChecks = {
    databaseCheck: async () => ({ ok: true }),
    branchPosCheck: async () => ({ readyForEnforcement: true }),
    staffOrderAlertCheck: async () => ({ queueAvailable: true }),
  };

  const workersOff = await readinessSnapshot({
    ...baseChecks,
    pushStatusCheck: () => ({ configured: true, initialized: true }),
  });
  assert.equal(workersOff.ok, false);
  assert.equal(workersOff.dependencies.staffPush.workersEnabled, false);

  process.env.RUN_BACKGROUND_WORKERS = 'true';
  const firebaseDown = await readinessSnapshot({
    ...baseChecks,
    pushStatusCheck: () => ({ configured: true, initialized: false }),
  });
  assert.equal(firebaseDown.ok, false);
  assert.equal(firebaseDown.dependencies.staffPush.firebaseInitialized, false);

  const ready = await readinessSnapshot({
    ...baseChecks,
    pushStatusCheck: () => ({ configured: true, initialized: true }),
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.dependencies.staffPush.ok, true);
});
