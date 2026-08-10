const { logger } = require('../config/logger');
const { supabase } = require('../config/supabase');
const { getBranchPosCoverage } = require('./branch-pos-credential.service');
const {
  branchPosAuthSnapshot,
  branchPosEnforcementMode,
} = require('../middlewares/branch-pos-auth.middleware');
const { posLoyaltySafetySnapshot } = require('./loyalty-reservation.service');

const bootedAt = Date.now();
const workers = new Map();
const alertTimestamps = new Map();
let latestBranchPosCoverage = {
  activeBranches: 0,
  configuredActiveBranches: 0,
  missingActiveBranches: 0,
  activeLegacyReservations: 0,
  readyForEnforcement: false,
};

const sendOperationalAlert = async (worker, errorCode) => {
  const webhookUrl = String(process.env.OPS_ALERT_WEBHOOK_URL || '').trim();
  if (!webhookUrl) return;
  const alertKey = `${worker.name}:${errorCode}`;
  const now = Date.now();
  if (now - (alertTimestamps.get(alertKey) || 0) < 15 * 60 * 1000) return;
  alertTimestamps.set(alertKey, now);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.OPS_ALERT_BEARER_TOKEN
          ? { Authorization: `Bearer ${process.env.OPS_ALERT_BEARER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        event: 'bulka_worker_unhealthy',
        service: 'bulka-bonus-backend',
        worker: worker.name,
        errorCode,
        failures: worker.failures,
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Alert webhook returned ${response.status}`);
  } catch (error) {
    logger.error(
      { err: error, event: 'operational_alert_failed', worker: worker.name },
      'Operational alert failed',
    );
  }
};

const registerWorker = (name, { enabled = true, intervalMs = 60_000, critical = false } = {}) => {
  const existing = workers.get(name);
  workers.set(name, {
    name,
    enabled,
    intervalMs,
    critical,
    running: existing?.running || false,
    runs: existing?.runs || 0,
    failures: existing?.failures || 0,
    lastStartedAt: existing?.lastStartedAt || null,
    lastSuccessAt: existing?.lastSuccessAt || null,
    lastFailureAt: existing?.lastFailureAt || null,
    lastErrorCode: existing?.lastErrorCode || null,
  });
};

const updateWorker = (name, patch) => {
  const current = workers.get(name);
  if (!current) registerWorker(name);
  workers.set(name, { ...workers.get(name), ...patch });
};

const runMonitoredWorker = async (name, task) => {
  const current = workers.get(name);
  if (!current?.enabled || current.running) return;
  const startedAt = new Date().toISOString();
  updateWorker(name, { running: true, lastStartedAt: startedAt });
  try {
    await task();
    const latest = workers.get(name);
    updateWorker(name, {
      running: false,
      runs: latest.runs + 1,
      lastSuccessAt: new Date().toISOString(),
      lastErrorCode: null,
    });
  } catch (error) {
    const latest = workers.get(name);
    updateWorker(name, {
      running: false,
      runs: latest.runs + 1,
      failures: latest.failures + 1,
      lastFailureAt: new Date().toISOString(),
      lastErrorCode: String(error?.code || 'WORKER_FAILED').slice(0, 80),
    });
    logger.error({ err: error, event: 'background_worker_failed', worker: name }, 'Worker failed');
    if (latest.critical) {
      void sendOperationalAlert(
        { ...latest, failures: latest.failures + 1 },
        String(error?.code || 'WORKER_FAILED').slice(0, 80),
      );
    }
  }
};

const workerSnapshot = (now = Date.now()) =>
  [...workers.values()].map((worker) => {
    const lastSuccessMs = worker.lastSuccessAt ? Date.parse(worker.lastSuccessAt) : 0;
    const graceMs = Math.max(worker.intervalMs * 3, 60_000);
    const stale =
      worker.enabled &&
      !worker.running &&
      now - bootedAt > graceMs &&
      (!lastSuccessMs || now - lastSuccessMs > graceMs);
    return { ...worker, stale };
  });

const withTimeout = async (promise, timeoutMs) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Dependency check timed out');
          error.code = 'DEPENDENCY_TIMEOUT';
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const checkDatabase = async () => {
  if (process.env.NODE_ENV === 'test') {
    return { ok: true, skipped: true };
  }
  try {
    const result = await withTimeout(
      Promise.resolve(supabase.from('customers').select('id').limit(1)),
      Number(process.env.READINESS_TIMEOUT_MS || 3000),
    );
    return result.error
      ? { ok: false, code: 'DATABASE_UNAVAILABLE' }
      : { ok: true, skipped: false };
  } catch {
    return { ok: false, code: 'DATABASE_UNAVAILABLE' };
  }
};

const checkBranchPosCoverage = async () => {
  if (process.env.NODE_ENV === 'test') {
    return { ...latestBranchPosCoverage, skipped: true };
  }
  return getBranchPosCoverage();
};

const readinessSnapshot = async ({
  databaseCheck = checkDatabase,
  branchPosCheck = checkBranchPosCoverage,
} = {}) => {
  const [database, branchPosCoverage] = await Promise.all([databaseCheck(), branchPosCheck()]);
  latestBranchPosCoverage = { ...latestBranchPosCoverage, ...branchPosCoverage };
  const branchPosMode = branchPosEnforcementMode();
  const branchPosOk =
    branchPosMode !== 'required' || branchPosCoverage.readyForEnforcement === true;
  const workerStates = workerSnapshot();
  const criticalWorkerFailed = workerStates.some(
    (worker) => worker.enabled && worker.critical && worker.stale,
  );
  for (const worker of workerStates) {
    if (worker.enabled && worker.critical && worker.stale) {
      void sendOperationalAlert(worker, 'WORKER_STALE');
    }
  }
  return {
    ok: database.ok && branchPosOk && !criticalWorkerFailed,
    dependencies: {
      database: { ok: database.ok },
      branchPosCredentials: {
        ok: branchPosOk,
        mode: branchPosMode,
        activeBranches: Number(branchPosCoverage.activeBranches || 0),
        configuredActiveBranches: Number(branchPosCoverage.configuredActiveBranches || 0),
        missingActiveBranches: Number(branchPosCoverage.missingActiveBranches || 0),
        activeLegacyReservations: Number(branchPosCoverage.activeLegacyReservations || 0),
        readyForEnforcement: branchPosCoverage.readyForEnforcement === true,
      },
    },
    workers: workerStates.map(
      ({ name, enabled, running, runs, failures, lastSuccessAt, lastFailureAt, stale }) => ({
        name,
        enabled,
        running,
        runs,
        failures,
        lastSuccessAt,
        lastFailureAt,
        stale,
      }),
    ),
  };
};

const renderWorkerMetrics = () => {
  const branchPosAuth = branchPosAuthSnapshot();
  const posLoyaltySafety = posLoyaltySafetySnapshot();
  const lines = [
    '# HELP bulka_worker_runs_total Background worker executions.',
    '# TYPE bulka_worker_runs_total counter',
  ];
  for (const worker of workerSnapshot()) {
    const name = worker.name.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    lines.push(`bulka_worker_runs_total{worker="${name}"} ${worker.runs}`);
    lines.push(`bulka_worker_failures_total{worker="${name}"} ${worker.failures}`);
    lines.push(`bulka_worker_running{worker="${name}"} ${worker.running ? 1 : 0}`);
    lines.push(`bulka_worker_stale{worker="${name}"} ${worker.stale ? 1 : 0}`);
    lines.push(
      `bulka_worker_last_success_timestamp_seconds{worker="${name}"} ${
        worker.lastSuccessAt ? Math.floor(Date.parse(worker.lastSuccessAt) / 1000) : 0
      }`,
    );
  }
  lines.push(
    '# HELP bulka_branch_pos_credential_coverage Branches with active POS credentials.',
    '# TYPE bulka_branch_pos_credential_coverage gauge',
    `bulka_branch_pos_credential_coverage ${latestBranchPosCoverage.configuredActiveBranches}`,
    '# HELP bulka_branch_pos_active_branches Active branches requiring POS credentials.',
    '# TYPE bulka_branch_pos_active_branches gauge',
    `bulka_branch_pos_active_branches ${latestBranchPosCoverage.activeBranches}`,
    '# HELP bulka_loyalty_pos_active_legacy_reservations Legacy reservations that must drain before strict enforcement.',
    '# TYPE bulka_loyalty_pos_active_legacy_reservations gauge',
    `bulka_loyalty_pos_active_legacy_reservations ${latestBranchPosCoverage.activeLegacyReservations}`,
    '# HELP bulka_branch_pos_enforcement_ready Whether every active branch has a POS credential.',
    '# TYPE bulka_branch_pos_enforcement_ready gauge',
    `bulka_branch_pos_enforcement_ready ${latestBranchPosCoverage.readyForEnforcement ? 1 : 0}`,
    '# HELP bulka_loyalty_pos_auth_requests_total Loyalty requests by POS authentication result.',
    '# TYPE bulka_loyalty_pos_auth_requests_total counter',
    `bulka_loyalty_pos_auth_requests_total{mode="branch"} ${branchPosAuth.branch}`,
    `bulka_loyalty_pos_auth_requests_total{mode="legacy"} ${branchPosAuth.legacy}`,
    `bulka_loyalty_pos_auth_requests_total{mode="rejected"} ${branchPosAuth.rejected}`,
    '# HELP bulka_loyalty_pos_safety_rejections_total POS loyalty requests rejected by financial safety limits.',
    '# TYPE bulka_loyalty_pos_safety_rejections_total counter',
    `bulka_loyalty_pos_safety_rejections_total{kind="transaction"} ${posLoyaltySafety.transaction}`,
    `bulka_loyalty_pos_safety_rejections_total{kind="rolling"} ${posLoyaltySafety.rolling}`,
  );
  return `${lines.join('\n')}\n`;
};

module.exports = {
  readinessSnapshot,
  registerWorker,
  renderWorkerMetrics,
  runMonitoredWorker,
  workerSnapshot,
};
