const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const {
  compareVersions,
  healthStatus,
  telemetryCases,
} = require('../src/services/pos-health.service');
const {
  posHealthHeartbeatSchema,
  reconciliationActionSchema,
} = require('../src/contracts/pos-health.contract');

test('POS health migration stores version policy and auditable reconciliation cases', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key);
    create table pos_devices(terminal_id uuid primary key,branch_id uuid references bulka_locations(id),
      terminal_group_id uuid,name text,token_hash text,active boolean default true,paired_at timestamptz default now(),
      device_role text default 'register',last_seen_at timestamptz default now());`);
  await db.exec(
    fs.readFileSync('supabase/migrations/20260924070000_pos_health_center.sql', 'utf8'),
  );
  const branch = randomUUID();
  const terminal = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    `insert into pos_devices(terminal_id,branch_id,terminal_group_id,name,token_hash)
     values($1,$2,$3,'Касса 1',$4)`,
    [terminal, branch, randomUUID(), 'a'.repeat(64)],
  );
  const policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, '1.10.0');
  assert.equal(policy.enforce_minimum, false);
  await assert.rejects(
    db.query("update pos_devices set printer_status='broken' where terminal_id=$1", [terminal]),
    /pos_devices_printer_status_check/,
  );
  await db.query(
    `insert into pos_reconciliation_cases(source_key,branch_id,terminal_id,kind,title)
     values('device:test:stock',$1,$2,'stock_sync','Остатки')`,
    [branch, terminal],
  );
  await assert.rejects(
    db.query("update pos_reconciliation_cases set status='ignored'"),
    /pos_reconciliation_cases_status_check/,
  );
});

test('version and telemetry rules identify outdated and financially unsafe registers', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.9.0', '1.9.0'), 0);
  assert.equal(compareVersions('1.8.9', '1.9.0'), -1);
  assert.equal(compareVersions('unknown', '1.9.0'), null);
  const payload = {
    pluginVersion: '1.8.0',
    connectedToMain: true,
    printerStatus: 'ready',
    queues: {
      loyaltyPending: 0,
      loyaltyFailed: 0,
      giftPending: 0,
      giftFailed: 0,
      offlineReceipts: 0,
      stockPending: 0,
      automaticReceipts: 0,
      personalAccountPending: 1,
    },
    statuses: {
      loyalty: 'ok',
      gifts: 'ok',
      stock: 'ok',
      receipts: 'ok',
      offlineReceipts: 'ok',
      personalAccount: 'Ожидает закрытия чека',
    },
    errors: [],
  };
  assert.equal(healthStatus(payload, { minimumVersion: '1.9.0', enforceMinimum: true }), 'error');
  const cases = telemetryCases(randomUUID(), randomUUID(), payload);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].kind, 'personal_account');
  assert.equal(cases[0].severity, 'critical');
});

test('health API requires bounded telemetry and a reason for manual closure', () => {
  const heartbeat = {
    terminalId: randomUUID(),
    pluginVersion: '1.10.0',
    apiVersion: 'V9Preview7',
    startedAt: new Date().toISOString(),
    connectedToMain: true,
    printerStatus: 'ready',
    queues: {
      loyaltyPending: 0,
      loyaltyFailed: 0,
      giftPending: 0,
      giftFailed: 0,
      offlineReceipts: 0,
      stockPending: 0,
      automaticReceipts: 0,
      personalAccountPending: 0,
    },
    statuses: {
      loyalty: 'ok',
      gifts: 'ok',
      stock: 'ok',
      receipts: 'ok',
      offlineReceipts: 'ok',
      personalAccount: 'ok',
    },
    errors: [],
  };
  assert.equal(posHealthHeartbeatSchema.safeParse(heartbeat).success, true);
  assert.equal(
    posHealthHeartbeatSchema.safeParse({ ...heartbeat, pluginVersion: 'latest' }).success,
    false,
  );
  assert.equal(reconciliationActionSchema.safeParse({ action: 'close' }).success, false);
  assert.equal(
    reconciliationActionSchema.safeParse({ action: 'close', reason: 'Чек проверен' }).success,
    true,
  );
});
