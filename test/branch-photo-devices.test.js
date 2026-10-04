const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const { PGlite } = require('@electric-sql/pglite');
// This isolated test process never connects externally; its client methods are replaced below.
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'photo-report-test-client-no-production-access';
const service = require('../src/services/branch-photo-reports.service');
const devices = require('../src/services/branch-photo-devices.service');
const adminDevices = require('../src/services/branch-photo-device-admin.service');
const { submitPhotos } = require('../src/services/branch-photo-upload.service');
const { cleanupPhotos } = require('../src/services/branch-photo-storage.service');
const { supabase } = require('../src/config/supabase');
const { database } = require('./helpers/photo-report-database.cjs');
const {
  applyDeviceMigration,
  approveDevice,
} = require('./helpers/photo-report-device-fixture.cjs');
const {
  COOKIE_NAME,
  MAX_AGE,
  readDeviceCookie,
  writeDeviceCookie,
} = require('../src/utils/branch-photo-device-cookie.util');
const {
  registerBranchPhotoReportRoutes,
} = require('../src/routes/admin/branch-photo-reports.routes');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OWNER = { role: 'owner', sub: 'test-owner' };
async function fixture(t) {
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
  await applyDeviceMigration(pg);
  const db = database(pg);
  const qr = async (branch) =>
    new URLSearchParams(
      new URL((await service.ensureQr(OWNER, branch, { db })).url).hash.slice(1),
    ).get('t');
  return { pg, db, qr: await qr(A), otherQr: await qr(B) };
}
async function approved(f) {
  const token = await approveDevice(f.qr, { db: f.db, name: 'Планшет №1' });
  const d = await devices.findDevice(token, { db: f.db });
  const session = await service.openSession(f.qr, { db: f.db, deviceToken: token });
  return { token, d, session };
}
const files = async () => [
  {
    buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aaa' } })
      .jpeg()
      .toBuffer(),
  },
];
const claimArgs = (session, token) => {
  const id = randomUUID();
  return {
    p_session_hash: service.tokenHash(session.sessionToken),
    p_upload_id: id,
    p_kind: 'hall',
    p_manifest_hash: 'a'.repeat(64),
    p_claim: randomUUID(),
    p_device_hash: service.tokenHash(token),
    p_photos: [
      {
        id: randomUUID(),
        path: `uploads/${id}/0.jpg`,
        position: 0,
        width: 20,
        height: 20,
        bytes: 200,
      },
    ],
  };
};
test('QR only is read-only; explicit enrollment code and active approval unlock only the bound browser', async (t) => {
  const f = await fixture(t);
  assert.equal((await devices.status(f.qr, '', { db: f.db })).device.status, 'unregistered');
  assert.equal(
    (await f.pg.query('select count(*)::int n from branch_closing_devices')).rows[0].n,
    0,
  );
  await assert.rejects(service.openSession(f.qr, { db: f.db }), {
    code: 'PHOTO_REPORT_DEVICE_REQUIRED',
  });
  const pending = await devices.request(f.qr, '', { db: f.db });
  assert.match(pending.body.pairingCode, /^\d{6}$/);
  assert.equal(pending.body.device.status, 'pending');
  assert.equal(JSON.stringify(pending.body).includes(pending.token), false);
  const stored = await devices.findDevice(pending.token, { db: f.db });
  assert.equal(stored.code_ciphertext.includes(pending.body.pairingCode), false);
  assert.equal(stored.token_hash, service.tokenHash(pending.token));
  assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 5 * 60000);
  assert.equal(
    (await devices.status(f.qr, pending.token, { db: f.db })).pairingCode,
    pending.body.pairingCode,
  );
  const again = await devices.request(f.qr, pending.token, { db: f.db });
  assert.equal(again.token, pending.token);
  assert.equal(again.body.pairingCode, pending.body.pairingCode);
  await assert.rejects(service.openSession(f.qr, { db: f.db, deviceToken: pending.token }), {
    code: 'PHOTO_REPORT_DEVICE_REQUIRED',
  });
  await adminDevices.approve(
    OWNER,
    stored.id,
    { code: pending.body.pairingCode, name: 'Планшет №1' },
    { db: f.db },
  );
  const status = await devices.status(f.qr, pending.token, { db: f.db });
  assert.equal(status.device.status, 'active');
  assert.equal(status.device.expiresAt, null);
  assert.equal(status.pairingCode, undefined);
  const active = await devices.request(f.qr, pending.token, { db: f.db });
  assert.equal(active.token, pending.token);
  assert.equal(active.body.device.id, stored.id);
  const session = await service.openSession(f.qr, { db: f.db, deviceToken: pending.token });
  await assert.rejects(service.resolveSession(session.sessionToken, { db: f.db }), {
    code: 'PHOTO_REPORT_DEVICE_REQUIRED',
  });
  const otherToken = await approveDevice(f.qr, { db: f.db, name: 'Планшет №2' });
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: otherToken }),
    { code: 'PHOTO_REPORT_DEVICE_REQUIRED' },
  );
  assert.equal(
    (await service.rows(f.db.rpc('claim_branch_closing_upload', claimArgs(session, otherToken))))
      .error,
    'device_required',
  );
  assert.equal(
    (await service.rows(f.db.rpc('claim_branch_closing_upload', claimArgs(session, pending.token))))
      .accepted,
    true,
  );
});
test('foreign branch QR cannot rebind an approved, pending or revoked browser', async (t) => {
  const f = await fixture(t);
  const { token, d } = await approved(f);
  for (const before of [null, () => adminDevices.revoke(OWNER, d.id, { db: f.db })]) {
    if (before) await before();
    assert.deepEqual((await devices.status(f.otherQr, token, { db: f.db })).device, {
      status: 'wrong_branch',
    });
    await assert.rejects(devices.request(f.otherQr, token, { db: f.db }), {
      code: 'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH',
    });
    await assert.rejects(service.openSession(f.otherQr, { db: f.db, deviceToken: token }), {
      code: 'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH',
    });
  }
  const pending = await devices.request(f.qr, '', { db: f.db });
  await assert.rejects(devices.request(f.otherQr, pending.token, { db: f.db }), {
    code: 'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH',
  });
  const replacement = await devices.request(f.qr, token, { db: f.db });
  assert.notEqual(replacement.token, token);
  assert.notEqual(replacement.body.device.id, d.id);
  assert.equal(replacement.body.device.status, 'pending');
});
test('pending codes expire, wrong guesses are atomic and bounded, and re-enrollment issues a new credential', async (t) => {
  const f = await fixture(t);
  const pending = await devices.request(f.qr, '', { db: f.db });
  const id = pending.body.device.id;
  const wrong = pending.body.pairingCode === '000000' ? '000001' : '000000';
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      adminDevices.approve(OWNER, id, { code: wrong, name: 'Тест' }, { db: f.db }),
    ),
  );
  assert.equal(
    attempts.filter((r) => r.reason?.code === 'PHOTO_REPORT_DEVICE_CODE_INVALID').length,
    5,
  );
  assert.equal(attempts.filter((r) => r.reason?.code === 'PHOTO_REPORT_DEVICE_EXPIRED').length, 3);
  assert.equal((await devices.findDevice(pending.token, { db: f.db })).code_attempts, 5);
  await assert.rejects(
    adminDevices.approve(OWNER, id, { code: pending.body.pairingCode, name: 'Тест' }, { db: f.db }),
    { code: 'PHOTO_REPORT_DEVICE_EXPIRED' },
  );
  assert.equal((await devices.status(f.qr, pending.token, { db: f.db })).pairingCode, undefined);
  const renewed = await devices.request(f.qr, pending.token, { db: f.db });
  assert.notEqual(renewed.token, pending.token);
  await f.pg.query(
    "update branch_closing_devices set expires_at=now()-interval '1 second' where id=$1",
    [renewed.body.device.id],
  );
  assert.equal((await devices.status(f.qr, renewed.token, { db: f.db })).device.status, 'expired');
  await assert.rejects(service.openSession(f.qr, { db: f.db, deviceToken: renewed.token }), {
    code: 'PHOTO_REPORT_DEVICE_EXPIRED',
  });
  await assert.rejects(
    adminDevices.approve(
      OWNER,
      renewed.body.device.id,
      { code: renewed.body.pairingCode, name: 'Тест' },
      { db: f.db },
    ),
    { code: 'PHOTO_REPORT_DEVICE_EXPIRED' },
  );
});
test('only scoped managers can list or change tablets; admin responses contain no credential or code', async (t) => {
  const f = await fixture(t);
  const pending = await devices.request(f.qr, '', { db: f.db });
  const other = await devices.request(f.otherQr, '', { db: f.db });
  for (const role of ['viewer', 'cashier', 'iiko_dashboard']) {
    await assert.rejects(adminDevices.list({ role, branchIds: [A] }, {}, { db: f.db }), {
      statusCode: 403,
    });
    await assert.rejects(
      adminDevices.approve(
        { role, branchIds: [A] },
        pending.body.device.id,
        { code: pending.body.pairingCode, name: 'Тест' },
        { db: f.db },
      ),
      { statusCode: 403 },
    );
    await assert.rejects(
      adminDevices.revoke({ role, branchIds: [A] }, pending.body.device.id, { db: f.db }),
      { statusCode: 403 },
    );
  }
  const manager = { role: 'branch_manager', branchIds: [A] };
  assert.equal((await adminDevices.list(manager, {}, { db: f.db })).devices.length, 1);
  assert.equal(
    (await adminDevices.list({ role: 'branch_manager' }, {}, { db: f.db })).devices.length,
    0,
  );
  await assert.rejects(adminDevices.list(manager, { branchId: B }, { db: f.db }), {
    statusCode: 403,
  });
  await assert.rejects(
    adminDevices.approve(
      manager,
      other.body.device.id,
      { code: other.body.pairingCode, name: 'Тест' },
      { db: f.db },
    ),
    { statusCode: 403 },
  );
  await assert.rejects(adminDevices.revoke(manager, other.body.device.id, { db: f.db }), {
    statusCode: 403,
  });
  await assert.rejects(
    adminDevices.list({ role: 'owner', selectedBranchIds: [B] }, { branchId: A }, { db: f.db }),
    { statusCode: 403 },
  );
  const list = await adminDevices.list(OWNER, {}, { db: f.db });
  for (const secret of [
    pending.token,
    pending.body.pairingCode,
    other.token,
    other.body.pairingCode,
  ])
    assert.equal(JSON.stringify(list).includes(secret), false);
  assert.deepEqual(
    Object.keys(list.devices[0]).sort(),
    [
      'approvedAt',
      'branchId',
      'branchName',
      'city',
      'createdAt',
      'expiresAt',
      'id',
      'lastSeenAt',
      'name',
      'status',
    ].sort(),
  );
  const approvedResponse = await adminDevices.approve(
    manager,
    pending.body.device.id,
    { code: pending.body.pairingCode, name: 'Планшет А' },
    { db: f.db },
  );
  assert.equal(approvedResponse.device.name, 'Планшет А');
  const row = await devices.findDevice(pending.token, { db: f.db });
  assert.equal(row.code_hash, null);
  assert.equal(row.code_ciphertext, null);
  await f.pg.query(
    `insert into branch_closing_devices(id,branch_id,token_hash,status,created_at)
    select gen_random_uuid(),$1,encode(sha256(i::text::bytea),'hex'),'revoked',now()-interval '1 day'
    from generate_series(1,1001) i`,
    [A],
  );
  const paginated = await adminDevices.list(manager, {}, { db: f.db });
  assert.equal(paginated.devices.length, 1002);
  assert.ok(
    paginated.devices.some(
      (device) => device.id === pending.body.device.id && device.status === 'active',
    ),
  );
});
test('approval lasts beyond reboot and cookie is persistent, HttpOnly, same-origin and renewed', async (t) => {
  const f = await fixture(t);
  const { token, d } = await approved(f);
  assert.equal(
    (await devices.status(f.qr, token, { db: f.db, now: new Date(Date.now() + 366 * 86400000) }))
      .device.status,
    'active',
  );
  assert.equal((await devices.findDevice(token, { db: f.db })).expires_at, null);
  const app = express();
  app.get('/', (_req, res) => {
    writeDeviceCookie(res, token, { NODE_ENV: 'production' });
    res.json({ ok: true });
  });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const header = response.headers.get('set-cookie');
  assert.match(header, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(header, /Max-Age=34560000/);
  assert.match(header, /Expires=/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\/api\/branch-reports/);
  assert.doesNotMatch(header, /Domain=/);
  assert.equal(MAX_AGE, 400 * 86400000);
  const savedCookie = header.split(';')[0];
  assert.equal(
    readDeviceCookie({ headers: { cookie: savedCookie } }),
    token,
    'new request/browser launch reuses the saved cookie',
  );
  assert.equal(
    readDeviceCookie({ headers: { cookie: `${savedCookie}; ${savedCookie}` } }),
    '',
    'ambiguous cookies are never accepted',
  );
  assert.equal((await devices.findDevice(token, { db: f.db })).id, d.id);
});
test('revocation between service authorization and SQL claim blocks upload without storing photos', async (t) => {
  const f = await fixture(t);
  const { token, d, session } = await approved(f);
  let writes = 0;
  const raceDb = {
    ...f.db,
    async rpc(name, args) {
      if (name === 'claim_branch_closing_upload')
        await adminDevices.revoke(OWNER, d.id, { db: f.db });
      return f.db.rpc(name, args);
    },
  };
  await assert.rejects(
    submitPhotos(session.sessionToken, { uploadId: randomUUID(), kind: 'hall' }, await files(), {
      db: raceDb,
      deviceToken: token,
      storage: {
        from: () => ({
          async upload() {
            writes++;
            return {};
          },
        }),
      },
    }),
    { code: 'PHOTO_REPORT_DEVICE_REVOKED' },
  );
  assert.equal(writes, 0);
  assert.equal(
    (await f.pg.query('select count(*)::int n from branch_closing_uploads')).rows[0].n,
    0,
  );
  assert.equal((await devices.status(f.qr, token, { db: f.db })).device.status, 'revoked');
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: token }),
    { code: 'PHOTO_REPORT_DEVICE_REVOKED' },
  );
});
test('revocation during storage write is checked again in SQL finish; old RPCs and legacy sessions fail closed', async (t) => {
  const f = await fixture(t);
  const { token, d, session } = await approved(f);
  const uploadId = randomUUID();
  await assert.rejects(
    submitPhotos(session.sessionToken, { uploadId, kind: 'hall' }, await files(), {
      db: f.db,
      deviceToken: token,
      storage: {
        from: () => ({
          async upload() {
            await adminDevices.revoke(OWNER, d.id, { db: f.db });
            return {};
          },
        }),
      },
    }),
    { code: 'PHOTO_REPORT_DEVICE_REVOKED' },
  );
  assert.equal(
    (await f.pg.query('select count(*)::int n from branch_closing_reports')).rows[0].n,
    0,
  );
  const upload = (await f.pg.query('select * from branch_closing_uploads where id=$1', [uploadId]))
    .rows[0];
  assert.equal(upload.device_id, d.id);
  assert.equal(upload.submitted_at, null);
  assert.equal(
    (
      await service.rows(
        f.db.rpc('finish_branch_closing_upload', {
          p_upload_id: uploadId,
          p_claim: upload.claim,
          p_device_hash: service.tokenHash(token),
        }),
      )
    ).error,
    'device_revoked',
  );
  const { p_device_hash: ignored, ...legacyClaim } = claimArgs(session, token);
  assert.equal(
    (await service.rows(f.db.rpc('claim_branch_closing_upload', legacyClaim))).error,
    'device_required',
  );
  assert.equal(
    (
      await service.rows(
        f.db.rpc('finish_branch_closing_upload', { p_upload_id: uploadId, p_claim: upload.claim }),
      )
    ).error,
    'device_required',
  );
  const otherToken = await approveDevice(f.qr, { db: f.db });
  await f.pg.query('update branch_closing_sessions set device_id=null where token_hash=$1', [
    service.tokenHash(session.sessionToken),
  ]);
  await assert.rejects(
    service.resolveSession(session.sessionToken, { db: f.db, deviceToken: otherToken }),
    { code: 'PHOTO_REPORT_DEVICE_REQUIRED' },
  );
  assert.equal(
    (await service.rows(f.db.rpc('claim_branch_closing_upload', claimArgs(session, otherToken))))
      .error,
    'device_required',
  );
});
test('report audit snapshot remains permanently after three-day photo cleanup and device revocation', async (t) => {
  const f = await fixture(t);
  const { token, d, session } = await approved(f);
  const uploadId = randomUUID();
  const storage = {
    from: () => ({
      async upload() {
        return {};
      },
      async remove() {
        return {};
      },
    }),
  };
  await submitPhotos(session.sessionToken, { uploadId, kind: 'hall' }, await files(), {
    db: f.db,
    storage,
    deviceToken: token,
  });
  const before = (await service.details(OWNER, A, session.date, { db: f.db })).reports[0];
  assert.equal(before.deviceId, d.id);
  assert.equal(before.deviceName, 'Планшет №1');
  assert.deepEqual(before.checks, {
    deviceAuthorized: true,
    branchMatched: true,
    imagesValidated: true,
  });
  assert.ok(before.submittedAt);
  await adminDevices.revoke(OWNER, d.id, { db: f.db });
  await f.pg.exec("update branch_closing_photos set expires_at=now()-interval '1 second'");
  assert.equal((await cleanupPhotos({ db: f.db, storage })).deleted, 1);
  const after = (await service.details(OWNER, A, session.date, { db: f.db })).reports[0];
  for (const key of ['deviceId', 'deviceName', 'submittedAt', 'checks'])
    assert.deepEqual(after[key], before[key]);
  assert.equal(after.photos[0].available, false);
  assert.equal(after.photos[0].url, null);
  assert.equal((await service.calendar(OWNER, {}, { db: f.db })).reports[0].deviceId, d.id);
});
test('pairing request abuse is bounded by durable branch quota and device table/RPCs are private', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 30; i++) await devices.request(f.qr, '', { db: f.db });
  await assert.rejects(devices.request(f.qr, '', { db: f.db }), {
    statusCode: 429,
    code: 'PHOTO_REPORT_DEVICE_RATE_LIMIT',
  });
  const pending = (await f.pg.query('select * from branch_closing_devices limit 1')).rows[0];
  const code = require('../src/utils/secret-envelope.util').decryptSecret(pending.code_ciphertext, {
    purpose: 'branch-photo-device-code',
    aad: pending.id,
  });
  await adminDevices.approve(OWNER, pending.id, { code, name: 'Планшет' }, { db: f.db });
  const privileges = (
    await f.pg.query(`select
    has_table_privilege('anon','branch_closing_devices','select') as anon_table,
    has_table_privilege('authenticated','branch_closing_devices','update') as authenticated_table,
    has_function_privilege('anon','approve_branch_closing_device(uuid,uuid,text,text,text)','execute') as anon_rpc,
    has_function_privilege('authenticated','finish_branch_closing_upload(uuid,uuid,text)','execute') as authenticated_rpc,
    has_function_privilege('service_role','finish_branch_closing_upload(uuid,uuid,text)','execute') as service_rpc`)
  ).rows[0];
  assert.deepEqual(privileges, {
    anon_table: false,
    authenticated_table: false,
    anon_rpc: false,
    authenticated_rpc: false,
    service_rpc: true,
  });
});
test('real public/admin routes enforce cookie binding before multipart and reject client-selected IDs', async (t) => {
  const f = await fixture(t);
  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;
  supabase.from = f.db.from;
  supabase.rpc = f.db.rpc;
  t.after(() => {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
  });
  const app = express();
  app.use(express.json());
  app.use(require('../src/routes/branch-photo-reports.routes'));
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-role'] || 'owner', branchIds: [A] };
    next();
  });
  registerBranchPhotoReportRoutes(app);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-bulka-report-token': f.qr, 'content-type': 'application/json' };
  let result = await fetch(`${base}/api/branch-reports/device`, { headers });
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal((await result.json()).device.status, 'unregistered');
  result = await fetch(`${base}/api/branch-reports/session`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(result.status, 403);
  assert.equal((await result.json()).code, 'PHOTO_REPORT_DEVICE_REQUIRED');
  result = await fetch(`${base}/api/branch-reports/device`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId: randomUUID(), name: 'Подделка' }),
  });
  assert.equal(result.status, 400);
  result = await fetch(`${base}/api/branch-reports/device`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(result.status, 200);
  const cookie = result.headers.get('set-cookie').split(';')[0];
  const pending = await result.json();
  assert.equal(pending.device.status, 'pending');
  result = await fetch(`${base}/admin/api/photo-reports/devices`, {
    headers: { 'x-role': 'viewer' },
  });
  assert.equal(result.status, 403);
  result = await fetch(`${base}/admin/api/photo-reports/devices/${pending.device.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pending.pairingCode, name: 'Планшет HTTP' }),
  });
  assert.equal(result.status, 200);
  result = await fetch(`${base}/api/branch-reports/device`, { headers: { ...headers, cookie } });
  assert.match(result.headers.get('set-cookie'), /Max-Age=34560000/);
  assert.equal((await result.json()).device.status, 'active');
  result = await fetch(`${base}/api/branch-reports/session`, {
    method: 'POST',
    headers: { ...headers, cookie },
    body: '{}',
  });
  assert.equal(result.status, 200);
  const session = await result.json();
  const copied = await fetch(`${base}/api/branch-reports/submit`, {
    method: 'POST',
    headers: {
      'x-bulka-report-session': session.sessionToken,
      'content-type': 'multipart/form-data; boundary=invalid',
    },
    body: 'invalid multipart',
  });
  assert.equal(copied.status, 403);
  assert.equal((await copied.json()).code, 'PHOTO_REPORT_DEVICE_REQUIRED');
  await adminDevices.revoke(OWNER, pending.device.id, { db: f.db });
  result = await fetch(`${base}/api/branch-reports/submit`, {
    method: 'POST',
    headers: {
      cookie,
      'x-bulka-report-session': session.sessionToken,
      'content-type': 'multipart/form-data; boundary=invalid',
    },
    body: 'invalid multipart',
  });
  assert.equal(result.status, 403);
  assert.equal((await result.json()).code, 'PHOTO_REPORT_DEVICE_REVOKED');
  for (let i = 0; i < 5; i++) {
    result = await fetch(`${base}/api/branch-reports/device`, {
      method: 'POST',
      headers,
      body: '{}',
    });
  }
  assert.equal(result.status, 429);
  assert.equal((await result.json()).code, 'PHOTO_REPORT_DEVICE_RATE_LIMIT');
});
