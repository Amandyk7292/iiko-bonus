const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const sharp = require('sharp');
const service = require('../src/services/branch-photo-reports.service');
const devices = require('../src/services/branch-photo-devices.service');
const adminDevices = require('../src/services/branch-photo-device-admin.service');
const { submitPhotos } = require('../src/services/branch-photo-upload.service');
const { database } = require('./helpers/photo-report-database.cjs');
const {
  applyDeviceMigration,
  approveDevice,
} = require('./helpers/photo-report-device-fixture.cjs');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OWNER = { role: 'owner', sub: 'test-owner' };
const migration = () =>
  readFileSync(
    'supabase/migrations/20261007150000_persistent_branch_photo_report_sessions.sql',
    'utf8',
  );

async function fixture(t, { persistent = true } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table bulka_locations(id uuid primary key,name text,city text,active boolean,sort_order int default 0);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text);
    insert into bulka_locations values('${A}','Точка А','Актау',true,0),('${B}','Точка Б','Астана',true,1);`);
  for (const file of [
    '20261001150000_branch_closing_photo_reports.sql',
    '20261002120000_round_the_clock_shifts.sql',
  ])
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await applyDeviceMigration(pg, { persistent });
  const db = database(pg);
  const qr = async (id) =>
    new URLSearchParams(new URL((await service.ensureQr(OWNER, id, { db })).url).hash.slice(1)).get(
      't',
    );
  return { pg, db, qr: await qr(A), otherQr: await qr(B) };
}

test('migration repairs expired approved sessions but never promotes pending, revoked, unbound or mismatched access', async (t) => {
  const f = await fixture(t, { persistent: false });
  const token = await approveDevice(f.qr, { db: f.db });
  const device = await devices.findDevice(token, { db: f.db });
  const session = await service.openSession(f.qr, { db: f.db, deviceToken: token });
  const revokedToken = await approveDevice(f.qr, { db: f.db });
  const revoked = await devices.findDevice(revokedToken, { db: f.db });
  await adminDevices.revoke(OWNER, revoked.id, { db: f.db });
  const pending = await devices.request(f.qr, '', { db: f.db });
  const otherToken = await approveDevice(f.otherQr, { db: f.db });
  const other = await devices.findDevice(otherToken, { db: f.db });
  const unsafe = [null, revoked.id, pending.body.device.id, other.id];
  const hashes = [];
  for (const deviceId of unsafe) {
    const hash = service.tokenHash(randomBytes(32).toString('base64url'));
    hashes.push(hash);
    await f.pg.query(
      `insert into branch_closing_sessions(token_hash,branch_id,link_generation,business_date,shift,device_id,expires_at)
      select $1,branch_id,link_generation,business_date,shift,$2,now()-interval '3 hours' from branch_closing_sessions where token_hash=$3`,
      [hash, deviceId, service.tokenHash(session.sessionToken)],
    );
  }
  const staleHash = service.tokenHash(randomBytes(32).toString('base64url'));
  await f.pg.query(
    `insert into branch_closing_sessions(token_hash,branch_id,link_generation,business_date,shift,device_id,expires_at)
    select $1,branch_id,$2,business_date,shift,device_id,now()-interval '3 hours' from branch_closing_sessions where token_hash=$3`,
    [staleHash, randomUUID(), service.tokenHash(session.sessionToken)],
  );
  hashes.push(staleHash);
  await f.pg.query(
    "update branch_closing_sessions set expires_at=now()-interval '3 hours' where token_hash=$1",
    [service.tokenHash(session.sessionToken)],
  );
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: token }),
    { code: 'PHOTO_REPORT_SESSION_EXPIRED' },
  );
  await f.pg.exec(migration());
  const repaired = await service.resolveSession(session.sessionToken, {
    db: f.db,
    deviceToken: token,
  });
  assert.equal(repaired.device_id, device.id);
  assert.equal(repaired.expires_at, null);
  const remaining = (
    await f.pg.query('select expires_at from branch_closing_sessions where token_hash=any($1)', [
      hashes,
    ])
  ).rows;
  assert.equal(remaining.length, unsafe.length + 1);
  assert.ok(remaining.every((row) => row.expires_at != null));
  await assert.rejects(service.resolveSession(session.sessionToken, { db: f.db }), {
    code: 'PHOTO_REPORT_DEVICE_REQUIRED',
  });
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: revokedToken }),
    { code: 'PHOTO_REPORT_DEVICE_REVOKED' },
  );
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: pending.token }),
    { code: 'PHOTO_REPORT_DEVICE_REQUIRED' },
  );
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: otherToken }),
    { code: 'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH' },
  );
  const files = await Promise.all(
    ['#eee', '#aaa', '#ddd'].map(async (background) => ({
      buffer: await sharp({ create: { width: 30, height: 20, channels: 3, background } })
        .jpeg()
        .toBuffer(),
    })),
  );
  const objects = new Map();
  const storage = {
    from: () => ({
      upload: async (path, bytes) => {
        objects.set(path, bytes);
        return {};
      },
    }),
  };
  const result = await submitPhotos(
    session.sessionToken,
    { uploadId: randomUUID(), kind: 'hall' },
    files,
    { db: f.db, deviceToken: token, storage },
  );
  assert.equal(result.submitted, true);
  assert.equal(objects.size, 3);
  assert.equal(
    (await service.details(OWNER, A, session.date, { db: f.db })).reports[0].photoCount,
    3,
  );
});

test('approved cookie restores a fresh report without QR or browser storage; new sessions have no elapsed-time expiry', async (t) => {
  const f = await fixture(t);
  const token = await approveDevice(f.qr, { db: f.db });
  const state = await devices.status(undefined, token, {
    db: f.db,
    now: new Date('2036-10-07T12:00:00Z'),
  });
  assert.equal(state.device.status, 'active');
  assert.equal(state.device.expiresAt, null);
  assert.equal(state.branch.id, A);
  assert.equal(JSON.stringify(state).includes(token), false);
  assert.equal(JSON.stringify(state).includes(f.qr), false);
  const session = await service.openSession(undefined, { db: f.db, deviceToken: token });
  const saved = await service.resolveSession(session.sessionToken, {
    db: f.db,
    deviceToken: token,
  });
  assert.equal(saved.expires_at, null);
  assert.equal(saved.device_id, state.device.id);
  const copy = await service.openSession(undefined, { db: f.db, deviceToken: token });
  assert.notEqual(copy.sessionToken, session.sessionToken);
  await assert.rejects(service.openSession(undefined, { db: f.db }), {
    code: 'PHOTO_REPORT_DEVICE_REQUIRED',
  });
  await assert.rejects(service.openSession(f.otherQr, { db: f.db, deviceToken: token }), {
    code: 'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH',
  });
  await assert.rejects(service.openSession('invalid-qr', { db: f.db, deviceToken: token }), {
    code: 'PHOTO_REPORT_LINK_INVALID',
  });
  await f.pg.exec('update branch_closing_links set generation=gen_random_uuid()');
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: token }),
    { code: 'PHOTO_REPORT_LINK_INVALID' },
  );
  const current = await service.openSession(undefined, { db: f.db, deviceToken: token });
  assert.equal(
    (await service.resolveSession(current.sessionToken, { db: f.db, deviceToken: token }))
      .branch_id,
    A,
  );
  await f.pg.query('update bulka_locations set active=false where id=$1', [A]);
  await assert.rejects(service.openSession(undefined, { db: f.db, deviceToken: token }), {
    code: 'PHOTO_REPORT_LINK_INVALID',
  });
});

test('manual disconnect revokes only the credential owner, invalidates permanent sessions, and expired pairing codes stay unusable', async (t) => {
  const f = await fixture(t);
  const token = await approveDevice(f.qr, { db: f.db });
  const otherToken = await approveDevice(f.otherQr, { db: f.db });
  const session = await service.openSession(undefined, { db: f.db, deviceToken: token });
  await devices.disconnect(token, { db: f.db });
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: token }),
    { code: 'PHOTO_REPORT_DEVICE_REVOKED' },
  );
  assert.equal((await devices.status(undefined, otherToken, { db: f.db })).device.status, 'active');
  await devices.disconnect('not-a-credential', { db: f.db });
  const pending = await devices.request(f.qr, '', { db: f.db });
  await f.pg.query(
    "update branch_closing_devices set expires_at=now()-interval '1 second' where id=$1",
    [pending.body.device.id],
  );
  await assert.rejects(
    adminDevices.approve(
      OWNER,
      pending.body.device.id,
      { code: pending.body.pairingCode, name: 'Планшет' },
      { db: f.db },
    ),
    { code: 'PHOTO_REPORT_DEVICE_EXPIRED' },
  );
  await assert.rejects(service.openSession(undefined, { db: f.db, deviceToken: pending.token }), {
    code: 'PHOTO_REPORT_DEVICE_EXPIRED',
  });
});
