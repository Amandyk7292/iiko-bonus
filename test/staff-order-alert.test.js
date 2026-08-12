const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  deliverAlert,
  flushStaffOrderAlerts,
  staffOrderAcceptSlaSeconds,
  staffOrderAlertHealthSnapshot,
} = require('../src/services/staff-order-alert.service');

const ALERT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const alertRow = {
  alert_id: ALERT_ID,
  lease_token: LEASE_ID,
  order_id: ORDER_ID,
  branch_id: BRANCH_ID,
  order_number: 7292,
  alert_type: 'order_unaccepted',
  event_at: '2026-08-12T10:00:00.000Z',
  attempt_count: 1,
};

function dbDouble({ claimed = [], snapshot = {} } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'claim_staff_order_alerts') return { data: claimed, error: null };
      if (name === 'staff_order_alert_snapshot') return { data: [snapshot], error: null };
      if (name === 'complete_staff_order_alert') return { data: true, error: null };
      if (name === 'validate_staff_order_alert_claim') return { data: true, error: null };
      return { data: 0, error: null };
    },
  };
}

test('missing receiver durably defers alerts without claiming or sending them', async () => {
  const db = dbDouble({ snapshot: { config_pending: 3, oldest_pending_seconds: 121 } });
  let fetchCalls = 0;
  const result = await flushStaffOrderAlerts(50, {
    db,
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.receiverConfigured, false);
  assert.equal(result.pending, 3);
  assert.deepEqual(
    db.calls.map(([name]) => name),
    [
      'enqueue_due_staff_order_alerts',
      'defer_staff_order_alerts_configuration',
      'staff_order_alert_snapshot',
    ],
  );
  const health = staffOrderAlertHealthSnapshot({});
  assert.equal(health.receiverConfigured, false);
  assert.equal(health.configPending, 3);
  assert.equal(health.oldestPendingSeconds, 121);
});

test('configured receiver gets a PII-free payload and stable idempotency key', async () => {
  const db = dbDouble({ claimed: [alertRow], snapshot: { sent: 1 } });
  let request;
  const result = await flushStaffOrderAlerts(50, {
    db,
    env: {
      OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test/bulka',
      OPS_ALERT_BEARER_TOKEN: 'receiver-secret',
    },
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, status: 202 };
    },
  });

  assert.equal(result.sent, 1);
  assert.equal(request.headers['Idempotency-Key'], ALERT_ID);
  assert.equal(request.headers.Authorization, 'Bearer receiver-secret');
  const payload = JSON.parse(request.body);
  assert.deepEqual(payload, {
    event: 'bulka_staff_order_alert',
    service: 'bulka-bonus-backend',
    alertId: ALERT_ID,
    alertType: 'order_unaccepted',
    orderId: ORDER_ID,
    branchId: BRANCH_ID,
    orderNumber: '7292',
    occurredAt: '2026-08-12T10:00:00.000Z',
  });
  assert.doesNotMatch(request.body, /phone|address|customer|token|session|receiver-secret/i);
  assert.equal(request.redirect, 'error');
  const completion = db.calls.find(([name]) => name === 'complete_staff_order_alert');
  assert.equal(completion[1].p_sent, true);
  assert.equal(completion[1].p_error_code, null);
});

test('webhook failures remain durable retries with bounded safe error codes', async () => {
  const db = dbDouble({ claimed: [alertRow], snapshot: { retry: 1 } });
  const result = await flushStaffOrderAlerts(50, {
    db,
    env: { OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test/bulka' },
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });

  assert.equal(result.sent, 0);
  const completion = db.calls.find(([name]) => name === 'complete_staff_order_alert');
  assert.equal(completion[1].p_sent, false);
  assert.equal(completion[1].p_error_code, 'ALERT_HTTP_500');
  assert.equal(completion[1].p_retry_seconds, 60);
});

test('timeouts never persist exception text or receiver details', async () => {
  const db = dbDouble({ claimed: [alertRow], snapshot: { retry: 1 } });
  const timeout = new Error('secret upstream body and URL');
  timeout.name = 'TimeoutError';
  await flushStaffOrderAlerts(50, {
    db,
    env: { OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test/private-path' },
    fetchImpl: async () => {
      throw timeout;
    },
  });
  const completion = db.calls.find(([name]) => name === 'complete_staff_order_alert');
  assert.equal(completion[1].p_error_code, 'ALERT_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(completion), /secret upstream|private-path/);
});

test('state is revalidated immediately before webhook dispatch', async () => {
  const db = dbDouble({ claimed: [alertRow], snapshot: { resolved: 1 } });
  const originalRpc = db.rpc;
  db.rpc = async (name, args) => {
    if (name === 'validate_staff_order_alert_claim') {
      db.calls.push([name, args]);
      return { data: false, error: null };
    }
    return originalRpc(name, args);
  };
  let fetchCalls = 0;
  const result = await flushStaffOrderAlerts(50, {
    db,
    env: { OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test/bulka' },
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.attempted, 0);
  assert.equal(
    db.calls.some(([name]) => name === 'complete_staff_order_alert'),
    false,
  );
});

test('one persistence failure does not strand later claimed alerts', async () => {
  const second = {
    ...alertRow,
    alert_id: '55555555-5555-4555-8555-555555555555',
    lease_token: '66666666-6666-4666-8666-666666666666',
    order_id: '77777777-7777-4777-8777-777777777777',
    order_number: 7293,
  };
  const db = dbDouble({ claimed: [alertRow, second], snapshot: { processing: 1, sent: 1 } });
  const baseRpc = db.rpc;
  db.rpc = async (name, args) => {
    if (name === 'complete_staff_order_alert' && args.p_alert_id === ALERT_ID) {
      db.calls.push([name, args]);
      return { data: null, error: { code: 'DB_WRITE_FAILED' } };
    }
    return baseRpc(name, args);
  };
  let sends = 0;
  await assert.rejects(
    () =>
      flushStaffOrderAlerts(50, {
        db,
        env: { OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test/bulka' },
        fetchImpl: async () => {
          sends += 1;
          return { ok: true, status: 202 };
        },
      }),
    (error) => {
      assert.equal(error.code, 'STAFF_ORDER_ALERT_BATCH_PARTIAL_FAILURE');
      assert.equal(error.failures.length, 1);
      assert.equal(error.failures[0].code, 'DB_WRITE_FAILED');
      return true;
    },
  );
  assert.equal(sends, 2);
  assert.equal(db.calls.filter(([name]) => name === 'complete_staff_order_alert').length, 2);
});

test('delivery concurrency is bounded at five while the full batch completes', async () => {
  const claimed = Array.from({ length: 8 }, (_, index) => ({
    ...alertRow,
    alert_id: `0000000${index + 1}-0000-4000-8000-00000000000${index + 1}`,
    lease_token: `1000000${index + 1}-0000-4000-8000-00000000000${index + 1}`,
    order_id: `2000000${index + 1}-0000-4000-8000-00000000000${index + 1}`,
    order_number: 7300 + index,
  }));
  const db = dbDouble({ claimed, snapshot: { sent: claimed.length } });
  let active = 0;
  let peak = 0;
  let sends = 0;
  const result = await flushStaffOrderAlerts(50, {
    db,
    env: { OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test/bulka' },
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      sends += 1;
      return { ok: true, status: 202 };
    },
  });

  assert.equal(peak, 5);
  assert.equal(sends, claimed.length);
  assert.equal(result.sent, claimed.length);
  assert.equal(db.calls.filter(([name]) => name === 'complete_staff_order_alert').length, 8);
});

test('SLA is configurable with a safe 60 to 900 second bound', () => {
  assert.equal(staffOrderAcceptSlaSeconds({}), 120);
  assert.equal(staffOrderAcceptSlaSeconds({ STAFF_ORDER_ACCEPT_SLA_SECONDS: '119' }), 119);
  assert.equal(staffOrderAcceptSlaSeconds({ STAFF_ORDER_ACCEPT_SLA_SECONDS: '120' }), 120);
  assert.equal(staffOrderAcceptSlaSeconds({ STAFF_ORDER_ACCEPT_SLA_SECONDS: '10' }), 60);
  assert.equal(staffOrderAcceptSlaSeconds({ STAFF_ORDER_ACCEPT_SLA_SECONDS: '5000' }), 900);
  assert.equal(staffOrderAcceptSlaSeconds({ STAFF_ORDER_ACCEPT_SLA_SECONDS: 'invalid' }), 120);
});

test('migration provides dedupe, authorization checks, revalidation and durable retry RPCs', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260812120000_staff_order_alerts.sql'),
    'utf8',
  );
  assert.match(sql, /dedupe_key varchar\(200\) not null unique/i);
  assert.match(sql, /staff_order_alert_branch_episode_active_idx/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('staff-push-registration'/i);
  assert.match(sql, /device\.platform = 'ios'[\s\S]+session\.revoked_at is null/i);
  assert.match(sql, /session\.expires_at > now\(\)[\s\S]+credential\.auth_version/i);
  assert.match(
    sql,
    /outbox\.created_at <= now\(\) - make_interval[\s\S]+orders\.kitchen_status = 'queued'/i,
  );
  assert.match(sql, /orders\.fulfillment_status in \('pending', 'new'\)/i);
  assert.match(sql, /function public\.claim_staff_order_alerts[\s\S]+skip locked/i);
  assert.match(sql, /function public\.validate_staff_order_alert_claim/i);
  assert.match(sql, /status = 'retry'[\s\S]+ALERT_LEASE_EXPIRED/i);
  assert.match(sql, /status in \('queued', 'config_pending', 'processing', 'retry'\)/i);
  assert.match(
    sql,
    /revoke all on public\.staff_order_alerts,[\s\S]+from public, anon, authenticated/i,
  );
});

test('deliverAlert rejects non-operational IDs before contacting the receiver', async () => {
  let called = false;
  await assert.rejects(
    () =>
      deliverAlert(
        { ...alertRow, order_id: 'customer@example.test' },
        {
          env: { OPS_ALERT_WEBHOOK_URL: 'https://alerts.example.test' },
          fetchImpl: async () => {
            called = true;
            return { ok: true, status: 200 };
          },
        },
      ),
    /Invalid staff order alert row/,
  );
  assert.equal(called, false);
});

test('hardening migration claims pending orders and suppresses false failed alerts', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260812130000_staff_order_reliability_hardening.sql',
    ),
    'utf8',
  );
  assert.match(
    sql,
    /function public\.claim_staff_push_deliveries[\s\S]+orders\.fulfillment_status in \('pending', 'new'\)/i,
  );
  assert.match(sql, /new\.status = 'uncertain'[\s\S]+not exists[\s\S]+delivery\.status = 'sent'/i);
  assert.match(
    sql,
    /function public\.touch_staff_push_device_heartbeat[\s\S]+last_seen_at = now\(\)/i,
  );
  assert.match(
    sql,
    /function public\.branch_has_active_staff_ipad[\s\S]+last_seen_at >= now\(\) - interval '90 seconds'/i,
  );
  const openStart = sql.indexOf('function public.open_staff_no_ipad_alert_episode');
  const enqueueStart = sql.indexOf('function public.enqueue_due_staff_order_alerts', openStart);
  const claimStart = sql.indexOf('function public.claim_staff_order_alerts', enqueueStart);
  const validateStart = sql.indexOf('function public.validate_staff_order_alert_claim', claimStart);
  const reconcileStart = sql.indexOf('-- Reconcile any rows', validateStart);
  assert.match(sql.slice(openStart, enqueueStart), /staff-no-ipad:/i);
  assert.doesNotMatch(
    sql.slice(openStart, claimStart),
    /hashtextextended\('staff-push-registration'/i,
  );
  assert.doesNotMatch(sql.slice(validateStart, reconcileStart), /enqueue_due_staff_order_alerts/i);
  assert.match(
    sql.slice(enqueueStart, claimStart),
    /status in \('sent', 'resolved'\)[\s\S]+interval '30 days'[\s\S]+active_episode\.resolved_at is null[\s\S]+limit 1000/i,
  );
  assert.match(sql, /select public\.enqueue_due_staff_order_alerts\(120\)/i);
});

test('rollout migration gives heartbeat grace and deduplicates terminal episodes durably', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260812140000_staff_order_alert_rollout_safety.sql',
    ),
    'utf8',
  );
  assert.match(sql, /add column if not exists terminal_alert_episode bigint/i);
  assert.match(
    sql,
    /old\.status not in \('failed', 'uncertain'\)[\s\S]+old\.terminal_alert_episode \+ 1/i,
  );
  assert.match(sql, /before update of status on public\.staff_push_outbox/i);
  assert.match(
    sql,
    /update public\.staff_push_devices device[\s\S]+set last_seen_at = now\(\)[\s\S]+session\.expires_at > now\(\)/i,
  );
  assert.match(
    sql,
    /function public\.enqueue_staff_new_order_push[\s\S]+session\.branch_ids = array\[device\.branch_id\][\s\S]+credential\.auth_version = device\.auth_version/i,
  );
  assert.match(
    sql,
    /function public\.sanitize_stale_staff_push_devices[\s\S]+staff-device-revoked:[\s\S]+limit least/i,
  );
  assert.match(
    sql,
    /function public\.validate_staff_order_alert_claim[\s\S]+dedupe_key = 'terminal:' \|\| outbox\.id::text \|\| ':'[\s\S]+terminal_alert_episode::text/i,
  );
  assert.match(
    sql,
    /alert\.dedupe_key like 'terminal:%'[\s\S]+alert\.dedupe_key <> 'terminal:' \|\| terminal_outbox\.id::text/i,
  );
  const enqueueStart = sql.indexOf('function public.enqueue_due_staff_order_alerts');
  const enqueueEnd = sql.indexOf('-- Normalize pre-heartbeat', enqueueStart);
  assert.match(
    sql.slice(enqueueStart, enqueueEnd),
    /open_staff_no_ipad_alert_episode\([\s\S]+v_candidate\.branch_id, now\(\)/i,
  );
  assert.doesNotMatch(
    sql.slice(enqueueStart, enqueueEnd),
    /v_candidate\.branch_id, v_candidate\.created_at/i,
  );
});

test('receiver deferral rewrites config-pending alerts only when due', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260812150000_staff_order_alert_defer_efficiency.sql',
    ),
    'utf8',
  );
  assert.match(
    sql,
    /alert\.status in \('queued', 'retry'\)[\s\S]+alert\.status = 'config_pending'[\s\S]+alert\.next_attempt_at <= now\(\)/i,
  );
  assert.doesNotMatch(sql, /where\s+status in \('queued', 'retry', 'config_pending'\)/i);
  assert.match(
    sql,
    /revoke all on function public\.defer_staff_order_alerts_configuration\(integer\)[\s\S]+grant execute[\s\S]+service_role/i,
  );
});
