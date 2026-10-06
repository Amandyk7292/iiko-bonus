const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { posHealthHeartbeatSchema } = require('../src/contracts/pos-health.contract');
const { recordHeartbeat } = require('../src/services/pos-health.service');

function heartbeat(extra = {}) {
  return {
    terminalId: randomUUID(),
    pluginVersion: '1.14.1',
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
    ...extra,
  };
}

test('photo printer diagnostics accept old clients and bound new capability telemetry', () => {
  const old = posHealthHeartbeatSchema.parse(heartbeat());
  assert.equal(old.photoPrinterReady, false);
  assert.equal(old.photoPrinterStatus, 'unknown');
  const configured = heartbeat({
    photoPrinterReady: true,
    photoPrinterStatus: 'ready',
    photoPrinterKind: 'bill',
    photoPrinterWidthDots: 384,
  });
  assert.equal(posHealthHeartbeatSchema.safeParse(configured).success, true);
  assert.equal(
    posHealthHeartbeatSchema.safeParse(heartbeat({ photoPrinterStatus: 'image_unsupported' }))
      .success,
    true,
  );
  assert.equal(
    posHealthHeartbeatSchema.safeParse({ ...configured, photoPrinterKind: 'device' }).success,
    true,
  );
  for (const reason of [
    'ambiguous_printer',
    'device_unmapped',
    'printer_not_local',
    'invalid_printer_id',
  ]) {
    assert.equal(
      posHealthHeartbeatSchema.safeParse(heartbeat({ photoPrinterStatus: reason })).success,
      true,
    );
  }
  for (const invalid of [
    { photoPrinterStatus: 'unbounded device error' },
    { photoPrinterKind: 'external-url' },
    { photoPrinterWidthDots: 2000 },
    { photoPrinterWidthDots: 0 },
  ]) {
    assert.equal(posHealthHeartbeatSchema.safeParse(heartbeat(invalid)).success, false);
  }
});

test('heartbeat persists photo reason and selected printer separately from general readiness', async () => {
  let saved;
  const branch = randomUUID();
  const db = {
    from(table) {
      let isUpdate = false;
      const result = () => ({
        data:
          table === 'pos_plugin_policy'
            ? {
                latest_version: '1.14.1',
                minimum_version: '1.13.0',
                enforce_minimum: false,
                download_url: '/downloads/BulkaPlugin-1.14.1-update.zip',
              }
            : table === 'pos_devices' && isUpdate
              ? { terminal_id: 'paired' }
              : [],
        error: null,
      });
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        not() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        update(value) {
          isUpdate = true;
          if (table === 'pos_devices') saved = value;
          return this;
        },
        async single() {
          return result();
        },
        async maybeSingle() {
          return result();
        },
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const unsupported = posHealthHeartbeatSchema.parse(
    heartbeat({ photoPrinterStatus: 'image_unsupported' }),
  );
  await recordHeartbeat(branch, unsupported, db);
  assert.equal(saved.printer_status, 'ready');
  assert.equal(saved.health_payload.photoPrinterReady, false);
  assert.equal(saved.health_payload.photoPrinterStatus, 'image_unsupported');
  assert.equal(saved.health_payload.photoPrinterKind, null);
  const configured = posHealthHeartbeatSchema.parse(
    heartbeat({
      photoPrinterReady: true,
      photoPrinterStatus: 'ready',
      photoPrinterKind: 'document',
      photoPrinterWidthDots: 576,
    }),
  );
  await recordHeartbeat(branch, configured, db);
  assert.equal(saved.health_payload.photoPrinterReady, true);
  assert.equal(saved.health_payload.photoPrinterKind, 'document');
  assert.equal(saved.health_payload.photoPrinterWidthDots, 576);
});

test('printer release policy advertises 1.14.1 and preserves newer administrator policy', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table pos_plugin_policy(singleton boolean primary key,latest_version text,
    download_url text,guide_url text,updated_at timestamptz,minimum_version text,enforce_minimum boolean);
    insert into pos_plugin_policy values(true,'1.14.0','old','old',now(),'1.13.0',false);`);
  const migration = fs.readFileSync(
    'supabase/migrations/20261006233000_pickup_photo_printer_release.sql',
    'utf8',
  );
  await db.exec(migration);
  let policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, '1.14.1');
  assert.equal(policy.download_url, '/downloads/BulkaPlugin-1.14.1-update.zip');
  assert.equal(policy.minimum_version, '1.13.0');
  assert.equal(policy.enforce_minimum, false);
  await db.exec(
    "update pos_plugin_policy set latest_version='1.15.0',download_url='custom',guide_url='custom'",
  );
  await db.exec(migration);
  policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, '1.15.0');
  assert.equal(policy.download_url, 'custom');
});

test('physical printer release upgrades 1.14.1 without changing enforcement or custom releases', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table pos_plugin_policy(singleton boolean primary key,latest_version text,
    download_url text,guide_url text,updated_at timestamptz,minimum_version text,enforce_minimum boolean);
    insert into pos_plugin_policy values(true,'1.14.1','old','old',now(),'1.9.0',false);`);
  const migration = fs.readFileSync(
    'supabase/migrations/20261006235000_pickup_photo_physical_printer_release.sql',
    'utf8',
  );
  await db.exec(migration);
  let policy = (await db.query('select * from pos_plugin_policy')).rows[0];
  assert.equal(policy.latest_version, '1.14.2');
  assert.equal(policy.download_url, '/downloads/BulkaPlugin-1.14.2-update.zip');
  assert.equal(policy.guide_url, '/docs/iiko-plugin-1.14.2.html');
  assert.equal(policy.minimum_version, '1.9.0');
  assert.equal(policy.enforce_minimum, false);
  for (const existingVersion of ['1.15.0', '2.0.0', 'custom']) {
    await db.query(
      "update pos_plugin_policy set latest_version=$1, download_url='custom', guide_url='custom'",
      [existingVersion],
    );
    await db.exec(migration);
    policy = (await db.query('select * from pos_plugin_policy')).rows[0];
    assert.equal(policy.latest_version, existingVersion);
    assert.equal(policy.download_url, 'custom');
    assert.equal(policy.guide_url, 'custom');
  }
});
