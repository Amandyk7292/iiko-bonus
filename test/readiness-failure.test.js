const assert = require('node:assert/strict');
const test = require('node:test');
const { createClient } = require('@supabase/supabase-js');

// Exercise the installed SDK's signal handling without network or production keys.
const requests = [];
let transportMode = 'pending';
const fakeDb = createClient('https://readiness.invalid', 'synthetic-readiness-key', {
  global: {
    fetch: async (url, options) => {
      const request = { path: new URL(url).pathname, signal: options.signal, aborted: false };
      requests.push(request);
      if (transportMode === 'failure') {
        return new Response(JSON.stringify({ message: 'synthetic private database detail' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Promise((_resolve, reject) => {
        const abort = () => {
          request.aborted = true;
          reject(new DOMException('synthetic transport abort', 'AbortError'));
        };
        options.signal.addEventListener('abort', abort, { once: true });
        if (options.signal.aborted) abort();
      });
    },
  },
});
const dbModule = require.resolve('../src/config/supabase');
require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: { supabase: fakeDb },
};
const {
  readinessSnapshot,
  renderWorkerMetrics,
} = require('../src/services/operational-health.service');

const readyChecks = () => ({
  databaseCheck: async () => ({ ok: true }),
  branchPosCheck: async () => ({
    activeBranches: 2,
    configuredActiveBranches: 2,
    missingActiveBranches: 0,
    activeLegacyReservations: 0,
    readyForEnforcement: true,
  }),
  staffOrderAlertCheck: async () => ({ queueAvailable: true }),
  pushStatusCheck: () => ({ configured: false, initialized: false }),
});

test('rejected checks fail readiness safely even when their feature is optional', async () => {
  for (const [check, dependency] of [
    ['databaseCheck', 'database'],
    ['branchPosCheck', 'branchPosCredentials'],
    ['staffOrderAlertCheck', 'staffOrderAlerts'],
    ['pushStatusCheck', 'staffPush'],
  ]) {
    let signal;
    const snapshot = await readinessSnapshot({
      ...readyChecks(),
      [check]: (options) => {
        signal = options.signal;
        throw Object.assign(new Error('sensitive dependency message'), {
          code: 'PRIVATE_ERROR_CODE',
        });
      },
    });
    assert.equal(snapshot.ok, false, check);
    assert.equal(snapshot.dependencies[dependency].ok, false, check);
    assert.equal(snapshot.dependencies[dependency].errorCode, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(signal.aborted, true, 'failed aggregate cancels any outstanding siblings');
    assert.doesNotMatch(JSON.stringify(snapshot), /sensitive|PRIVATE_ERROR_CODE/);
  }
});

test('every hung check is bounded and receives an aborted signal', async () => {
  for (const [check, dependency] of [
    ['databaseCheck', 'database'],
    ['branchPosCheck', 'branchPosCredentials'],
    ['staffOrderAlertCheck', 'staffOrderAlerts'],
    ['pushStatusCheck', 'staffPush'],
  ]) {
    let signal;
    const snapshot = await readinessSnapshot({
      ...readyChecks(),
      timeoutMs: 25,
      [check]: (options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    });
    assert.equal(signal.aborted, true, check);
    assert.equal(snapshot.ok, false, check);
    assert.equal(snapshot.dependencies[dependency].errorCode, 'DEPENDENCY_TIMEOUT');
  }
});

test('a failed check never reuses a preceding healthy snapshot and recovery is fresh', async () => {
  assert.equal((await readinessSnapshot(readyChecks())).ok, true);
  const failed = await readinessSnapshot({
    ...readyChecks(),
    branchPosCheck: async () => {
      throw new Error('synthetic failure');
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.dependencies.branchPosCredentials.configuredActiveBranches, 0);
  assert.match(renderWorkerMetrics(), /bulka_branch_pos_enforcement_ready 0/);
  const recovered = await readinessSnapshot(readyChecks());
  assert.equal(recovered.ok, true);
  assert.equal(recovered.dependencies.branchPosCredentials.errorCode, undefined);
  assert.match(renderWorkerMetrics(), /bulka_branch_pos_enforcement_ready 1/);
});

test('default readiness checks abort all six SDK requests without starting a schema fallback', async (t) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    process.env.NODE_ENV = previous;
  });
  transportMode = 'pending';
  requests.length = 0;
  const snapshot = await readinessSnapshot({ timeoutMs: 35 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshot.ok, false);
  assert.equal(requests.length, 6);
  assert.ok(requests.every((request) => request.signal.aborted && request.aborted));
  for (const dependency of ['database', 'branchPosCredentials', 'staffOrderAlerts']) {
    assert.equal(snapshot.dependencies[dependency].errorCode, 'DEPENDENCY_TIMEOUT');
  }
});

test('real SDK dependency failures become safe unavailable snapshots', async (t) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    process.env.NODE_ENV = previous;
  });
  transportMode = 'failure';
  requests.length = 0;
  const snapshot = await readinessSnapshot({ timeoutMs: 100 });
  assert.equal(snapshot.ok, false);
  assert.equal(requests.length, 7, 'non-aborted schema fallback is retained');
  for (const dependency of ['database', 'branchPosCredentials', 'staffOrderAlerts']) {
    assert.equal(
      snapshot.dependencies[dependency].errorCode,
      dependency === 'database' ? 'DATABASE_UNAVAILABLE' : 'DEPENDENCY_UNAVAILABLE',
    );
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /private database detail/);
});

test('returned database failures retain and log a safe code without exposing supplied details', async (t) => {
  const { logger } = require('../src/config/logger');
  const previousWarn = logger.warn;
  const events = [];
  logger.warn = (data) => events.push(data);
  t.after(() => {
    logger.warn = previousWarn;
  });
  const snapshot = await readinessSnapshot({
    ...readyChecks(),
    databaseCheck: async () => ({
      ok: false,
      code: 'DATABASE_UNAVAILABLE',
      details: 'private database detail',
    }),
  });
  assert.equal(snapshot.ok, false);
  assert.deepEqual(snapshot.dependencies.database, {
    ok: false,
    errorCode: 'DATABASE_UNAVAILABLE',
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /private database detail/);
  assert.deepEqual(events, [
    {
      event: 'readiness_dependency_failed',
      dependency: 'database',
      errorCode: 'DATABASE_UNAVAILABLE',
    },
  ]);
});

test('malformed check results fail closed without escaping the snapshot', async () => {
  for (const value of [null, undefined, []]) {
    const snapshot = await readinessSnapshot({
      ...readyChecks(),
      branchPosCheck: async () => value,
    });
    assert.equal(snapshot.ok, false);
    assert.equal(snapshot.dependencies.branchPosCredentials.errorCode, 'DEPENDENCY_UNAVAILABLE');
  }
});

test('production rejects invalid readiness deadlines before the app can serve requests', (t) => {
  const { validateRuntimeConfig } = require('../src/config/env');
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTimeout = process.env.READINESS_TIMEOUT_MS;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousTimeout === undefined) delete process.env.READINESS_TIMEOUT_MS;
    else process.env.READINESS_TIMEOUT_MS = previousTimeout;
  });
  for (const timeout of ['0', '-1', 'invalid', '10001', '500.5']) {
    process.env.READINESS_TIMEOUT_MS = timeout;
    assert.throws(validateRuntimeConfig, /READINESS_TIMEOUT_MS\(500\.\.10000\)/, timeout);
  }
});
