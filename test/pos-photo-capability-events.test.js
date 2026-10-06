const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PGlite } = require('@electric-sql/pglite');
const { recordHeartbeat } = require('../src/services/pos-health.service');
const realtime = require('../src/services/realtime.service');

const heartbeat = (terminalId, ready, extra = {}) => ({
  terminalId,
  pluginVersion: '1.14.1',
  apiVersion: 'V9Preview7',
  startedAt: new Date().toISOString(),
  connectedToMain: true,
  printerStatus: 'ready',
  photoPrinterReady: ready,
  photoPrinterStatus: ready ? 'ready' : 'driver_unavailable',
  queues: Object.fromEntries(
    [
      'loyaltyPending',
      'loyaltyFailed',
      'giftPending',
      'giftFailed',
      'offlineReceipts',
      'stockPending',
      'automaticReceipts',
      'personalAccountPending',
    ].map((key) => [key, 0]),
  ),
  statuses: Object.fromEntries(
    ['loyalty', 'gifts', 'stock', 'receipts', 'offlineReceipts', 'personalAccount'].map((key) => [
      key,
      'ok',
    ]),
  ),
  errors: [],
  ...extra,
});

async function fixture(t) {
  const sql = new PGlite();
  realtime.resetForTests();
  t.after(async () => {
    realtime.resetForTests();
    await sql.close();
  });
  await sql.exec(`create table bulka_locations(id uuid primary key,active boolean default true);
    create table pos_devices(terminal_id uuid primary key,branch_id uuid,active boolean default true,
      plugin_version text default '1.14.1',plugin_api_version text,plugin_started_at timestamptz,
      last_health_at timestamptz,last_seen_at timestamptz,connected_to_main boolean default true,
      printer_status text default 'ready',health_status text,health_payload jsonb default '{}',last_error text);`);
  const migration = fs.readFileSync(
    'supabase/migrations/20261006153000_pickup_photo_gifts.sql',
    'utf8',
  );
  await sql.exec(
    migration.slice(
      migration.indexOf('create function public.pickup_photo_printer_ready'),
      migration.indexOf('create function public.create_pickup_photo_upload'),
    ),
  );
  const branch = randomUUID(),
    otherBranch = randomUUID(),
    terminal = randomUUID();
  await sql.query('insert into bulka_locations(id) values($1),($2)', [branch, otherBranch]);
  await sql.query('insert into pos_devices(terminal_id,branch_id) values($1,$2)', [
    terminal,
    branch,
  ]);
  const rpcModes = [],
    rpcCalls = [];
  const db = {
    rpc(name, args) {
      assert.equal(name, 'pickup_photo_printer_ready');
      assert.deepEqual(args, { p_branch: branch, p_terminal: null });
      const mode = rpcModes.shift();
      rpcCalls.push(args);
      return {
        async abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal, 'optional RPC has a deadline');
          if (mode === 'error') return { error: new Error('RPC unavailable') };
          if (mode === 'throw') throw new Error('Network unavailable');
          if (mode === 'invalid') return { data: { unexpected: true } };
          if (mode === 'hang') {
            // Keep the event loop alive to verify the real abort deadline.
            const keepAlive = setInterval(() => {}, 50);
            try {
              return await new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              });
            } finally {
              clearInterval(keepAlive);
            }
          }
          const result = await sql.query('select pickup_photo_printer_ready($1,$2) ready', [
            args.p_branch,
            args.p_terminal,
          ]);
          return { data: result.rows[0].ready, error: null };
        },
      };
    },
    from(table) {
      const filters = [],
        values = [];
      let fields = '*',
        update;
      const run = async (single = false) => {
        if (table === 'pos_plugin_policy')
          return {
            data: {
              latest_version: '1.14.1',
              minimum_version: '1.13.0',
              enforce_minimum: false,
              download_url: '/downloads/plugin.zip',
            },
          };
        if (table === 'pos_reconciliation_cases') return { data: [] };
        assert.equal(table, 'pos_devices');
        const args = [...values];
        let query;
        if (update) {
          const columns = Object.entries(update).map(([key, value]) => {
            args.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
            return `${key}=$${args.length}`;
          });
          query = `update pos_devices set ${columns.join(',')} where ${filters.join(' and ')} returning ${fields}`;
        } else {
          query = `select ${fields} from pos_devices where ${filters.join(' and ')}`;
        }
        const { rows } = await sql.query(query, args);
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const builder = {
        select(value) {
          fields = value;
          return this;
        },
        eq(key, value) {
          values.push(value);
          filters.push(`${key}=$${values.length}`);
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
          update = value;
          return this;
        },
        single() {
          return run(true);
        },
        maybeSingle() {
          return run(true);
        },
        then(resolve, reject) {
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const req = new EventEmitter();
  req.query = {};
  const frames = [];
  const res = {
    status() {},
    set() {},
    write(text) {
      frames.push(text);
    },
    end() {
      this.writableEnded = true;
    },
  };
  realtime.openStream(req, res, { public: true });
  const events = () =>
    frames
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)))
      .filter((event) => event.type === 'client.data.changed');
  const send = (ready, extra) => recordHeartbeat(branch, heartbeat(terminal, ready, extra), db);
  return { sql, db, branch, otherBranch, terminal, rpcModes, rpcCalls, events, send };
}

test('photo readiness transitions refresh checkout only for the affected branch', async (t) => {
  const f = await fixture(t);
  await f.send(false);
  assert.deepEqual(f.events(), []);
  await f.send(true);
  assert.deepEqual(
    f.events().map((event) => event.data),
    [{ domains: ['checkout'], branchId: f.branch }],
  );
  assert.equal(JSON.stringify(f.events()).includes('driver_unavailable'), false);
  await f.send(true);
  assert.equal(f.events().length, 1, 'ordinary 20-second heartbeats do not broadcast');
  await f.send(false);
  assert.equal(f.events().length, 2);
  assert.deepEqual(f.events()[1].data, { domains: ['checkout'], branchId: f.branch });
  await f.send(false);
  assert.equal(f.events().length, 2);
  assert.equal(f.rpcCalls.length, 10);
});

test('old duplicate devices never block readiness, and another ready POS prevents a false transition', async (t) => {
  const f = await fixture(t);
  const old = randomUUID(),
    peer = randomUUID();
  await f.sql.query(
    `insert into pos_devices(terminal_id,branch_id,health_payload,last_health_at)
    values($1,$2,'{"photoPrinterReady":true}',null)`,
    [old, f.branch],
  );
  await f.send(true);
  assert.equal(f.events().length, 1, 'a never-seen duplicate cannot supply readiness');
  await f.sql.query(
    `insert into pos_devices(terminal_id,branch_id,health_payload,last_health_at)
    values($1,$2,'{"photoPrinterReady":true}',now())`,
    [peer, f.branch],
  );
  await f.send(false);
  assert.equal(f.events().length, 1, 'healthy peer keeps branch photo availability true');
  await f.sql.query('update pos_devices set active=false where terminal_id=$1', [peer]);
  await f.send(true);
  assert.equal(f.events().length, 2);
});

test('expired heartbeat recovery emits, while inactive branches and old plugins stay unavailable', async (t) => {
  const f = await fixture(t);
  await f.send(true);
  await f.sql.query(
    "update pos_devices set last_health_at=now()-interval '121 seconds' where terminal_id=$1",
    [f.terminal],
  );
  await f.send(true);
  assert.equal(f.events().length, 2, 'two-minute SQL expiry is respected before reconnect');
  await f.sql.query('update bulka_locations set active=false where id=$1', [f.branch]);
  await f.send(true);
  assert.equal(f.events().length, 2);
  await f.sql.query('update bulka_locations set active=true where id=$1', [f.branch]);
  await f.send(true, { pluginVersion: '1.13.0' });
  assert.equal(f.events().length, 3, 'unsupported plugin clears actual SQL readiness');
  await f.send(true, { pluginVersion: '1.13.0' });
  assert.equal(f.events().length, 3);
  await f.send(true, { connectedToMain: false });
  assert.equal(f.events().length, 3, 'disconnected POS cannot enable photos');
});

test('failed, invalid or aborted capability reads do not break telemetry or publish guesses', async (t) => {
  const f = await fixture(t);
  for (const mode of ['error', 'throw', 'invalid']) {
    f.rpcModes.push(mode, null);
    await f.send(true);
    f.rpcModes.push(null, mode);
    await f.send(false);
  }
  assert.equal(f.events().length, 0);
  const row = (await f.sql.query('select health_payload,last_health_at from pos_devices')).rows[0];
  assert.equal(row.health_payload.photoPrinterReady, false);
  assert.ok(row.last_health_at);
  f.rpcModes.push('hang', null);
  await f.send(true);
  assert.equal(f.events().length, 0, 'a timed-out optional RPC never fabricates a transition');
});

test('an inactive or foreign terminal cannot emit a checkout event', async (t) => {
  const f = await fixture(t);
  await f.sql.query('update pos_devices set active=false where terminal_id=$1', [f.terminal]);
  await assert.rejects(f.send(true), { code: 'POS_DEVICE_UNAUTHORIZED' });
  assert.equal(f.events().length, 0);
  assert.equal(f.rpcCalls.length, 1, 'no after-read follows an unauthorized update');
  await f.sql.query('update pos_devices set active=true,branch_id=$1 where terminal_id=$2', [
    f.otherBranch,
    f.terminal,
  ]);
  await assert.rejects(f.send(true), { code: 'POS_DEVICE_UNAUTHORIZED' });
  assert.equal(f.events().length, 0);
});
