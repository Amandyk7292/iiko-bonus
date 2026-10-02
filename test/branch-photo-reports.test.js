const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const sharp = require('sharp');
const express = require('express');
const service = require('../src/services/branch-photo-reports.service');
const { preparePhotos, submitPhotos } = require('../src/services/branch-photo-upload.service');
const { cleanupPhotos, photoForAdmin } = require('../src/services/branch-photo-storage.service');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const realtime = require('../src/services/realtime.service');
const OWNER = { role: 'owner' };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const { database } = require('./helpers/photo-report-database.cjs');

test('business date switches at 04:00 Kazakhstan time, including month/year boundaries', () => {
  assert.equal(service.businessDate(new Date('2026-10-01T22:59:59Z')), '2026-10-01');
  assert.equal(service.businessDate(new Date('2026-10-01T23:00:00Z')), '2026-10-02');
  assert.equal(service.businessDate(new Date('2026-12-31T22:59:59Z')), '2026-12-31');
  assert.equal(service.businessDate(new Date('2026-12-31T23:00:00Z')), '2027-01-01');
});

test('camera images are normalized and unsafe/oversized inputs never enter storage', async () => {
  const image = await sharp({
    create: { width: 1900, height: 1000, channels: 3, background: '#aaa' },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const prepared = await preparePhotos([{ buffer: image }], randomUUID());
  assert.equal(prepared[0].width, 1600);
  assert.equal(prepared[0].height, 842);
  const normalized = await sharp(prepared[0].buffer).metadata();
  assert.equal(normalized.exif, undefined);
  assert.equal(normalized.format, 'jpeg');
  await assert.rejects(preparePhotos(Array(11).fill({ buffer: image }), randomUUID()), {
    statusCode: 413,
  });
  await assert.rejects(
    preparePhotos(
      [{ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>') }],
      randomUUID(),
    ),
    { statusCode: 415 },
  );
  await assert.rejects(preparePhotos([], randomUUID()), { statusCode: 413 });
});

test('private QR, durable reports, retries and automatic retention work against the migration', async (t) => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key, name text,city text,active boolean,sort_order int default 0);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text);alter table storage.objects enable row level security;
    insert into bulka_locations(id,name,city,active) values('${A}','Точка А','Актау',true),('${B}','Точка Б','Астана',true);`);
  await pg.exec(
    readFileSync('supabase/migrations/20261001150000_branch_closing_photo_reports.sql', 'utf8'),
  );
  await pg.exec(
    readFileSync('supabase/migrations/20261002120000_round_the_clock_shifts.sql', 'utf8'),
  );
  const db = database(pg);
  const qr = await service.ensureQr(OWNER, A, { db });
  const qrAgain = await service.ensureQr(OWNER, A, { db });
  assert.equal(qr.url, qrAgain.url);
  assert.equal(new URL(qr.url).search, '');
  const token = new URLSearchParams(new URL(qr.url).hash.slice(1)).get('t');
  const link = (await pg.query('select * from branch_closing_links')).rows[0];
  assert.equal(link.token_hash, service.tokenHash(token));
  assert.equal(link.token_ciphertext.includes(token), false);
  const session = await service.openSession(token, { db });
  assert.equal(session.date, service.businessDate());
  assert.equal((await service.resolveSession(session.sessionToken, { db })).branch_id, A);
  await assert.rejects(service.ensureQr({ role: 'branch_manager', branchIds: [B] }, A, { db }), {
    statusCode: 403,
  });
  await assert.rejects(service.ensureQr({ role: 'viewer', branchIds: [A] }, A, { db }), {
    statusCode: 403,
  });
  assert.equal(
    (await service.calendar({ role: 'viewer', branchIds: [] }, {}, { db })).branches.length,
    0,
  );
  const storedObjects = new Map();
  let shouldFail = true;
  const storage = {
    from(bucket) {
      assert.equal(bucket, 'branch-closing-photos');
      return {
        async upload(path, buffer) {
          if (shouldFail) return { error: new Error('Storage unavailable') };
          storedObjects.set(path, buffer);
          return {};
        },
        async remove(paths) {
          if (shouldFail) return { error: new Error('Delete unavailable') };
          paths.forEach((path) => storedObjects.delete(path));
          return {};
        },
        async download(path) {
          return { data: new Blob([storedObjects.get(path)]) };
        },
      };
    },
  };
  const files = [
    {
      buffer: await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ddd' } })
        .jpeg()
        .toBuffer(),
    },
  ];
  const uploadId = randomUUID();
  await assert.rejects(
    submitPhotos(session.sessionToken, { uploadId, kind: 'hall' }, files, { db, storage }),
    /Storage unavailable/,
  );
  assert.equal(
    (await service.calendar(OWNER, {}, { db })).reports.length,
    0,
    'a failed storage write must never be green',
  );
  shouldFail = false;
  assert.equal(
    (await submitPhotos(session.sessionToken, { uploadId, kind: 'hall' }, files, { db, storage }))
      .submitted,
    true,
  );
  assert.equal(
    (await submitPhotos(session.sessionToken, { uploadId, kind: 'hall' }, files, { db, storage }))
      .submitted,
    true,
    'a retry after a lost success response is idempotent',
  );
  await assert.rejects(
    submitPhotos(session.sessionToken, { uploadId: randomUUID(), kind: 'hall' }, files, {
      db,
      storage,
    }),
    { code: 'PHOTO_REPORT_ALREADY_SUBMITTED' },
  );
  const detail = await service.details(OWNER, A, session.date, { db });
  assert.equal(detail.reports[0].photoCount, 1);
  assert.equal(detail.reports[0].photos[0].available, true);
  const photoId = detail.reports[0].photos[0].id;
  assert.ok((await photoForAdmin(OWNER, photoId, { db, storage })).length > 0);
  await assert.rejects(
    photoForAdmin({ role: 'viewer', branchIds: [B] }, photoId, { db, storage }),
    { statusCode: 403 },
  );
  const seconds = (
    await pg.query(
      'select extract(epoch from (p.expires_at-r.submitted_at)) as seconds from branch_closing_photos p join branch_closing_reports r on r.upload_id=p.upload_id',
    )
  ).rows[0].seconds;
  assert.equal(Number(seconds), 3 * 86400);
  await pg.exec("update branch_closing_photos set expires_at=now()-interval '1 second'");
  shouldFail = true;
  await assert.rejects(cleanupPhotos({ db, storage }), /Delete unavailable/);
  assert.equal(
    (await pg.query('select deleted_at from branch_closing_photos')).rows[0].deleted_at,
    null,
  );
  assert.equal(
    (await service.details(OWNER, A, session.date, { db })).reports[0].photos[0].url,
    null,
    'expired photos are inaccessible even if storage deletion failed',
  );
  await assert.rejects(photoForAdmin(OWNER, photoId, { db, storage }), { statusCode: 410 });
  shouldFail = false;
  await pg.exec("update branch_closing_photos set cleanup_lease_until=now()-interval '1 second'");
  assert.equal((await cleanupPhotos({ db, storage })).deleted, 1);
  assert.equal(storedObjects.size, 0);
  const history = await service.calendar(OWNER, {}, { db });
  assert.equal(history.reports.length, 1);
  assert.equal(history.reports[0].photoCount, 1);
  const access = (
    await pg.query(`select public, has_function_privilege('anon','public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid)','execute') as anon,
    has_table_privilege('authenticated','branch_closing_reports','select') as authenticated from storage.buckets where id='branch-closing-photos'`)
  ).rows[0];
  assert.deepEqual(access, { public: false, anon: false, authenticated: false });
  await pg.exec('update branch_closing_links set generation=gen_random_uuid()');
  await assert.rejects(service.resolveSession(session.sessionToken, { db }), { statusCode: 401 });
});

test('claims protect the ten-photo limit and isolate simultaneous submissions', async (t) => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table bulka_locations(id uuid primary key,name text,city text,active boolean);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text);
    insert into bulka_locations values('${A}','Точка','Актау',true);`);
  await pg.exec(
    readFileSync('supabase/migrations/20261001150000_branch_closing_photo_reports.sql', 'utf8'),
  );
  await pg.exec(
    readFileSync('supabase/migrations/20261002120000_round_the_clock_shifts.sql', 'utf8'),
  );
  const db = database(pg);
  const qr = await service.ensureQr(OWNER, A, { db });
  const session = await service.openSession(
    new URLSearchParams(new URL(qr.url).hash.slice(1)).get('t'),
    { db },
  );
  const upload = randomUUID(),
    claim = randomUUID();
  const params = {
    p_session_hash: service.tokenHash(session.sessionToken),
    p_upload_id: upload,
    p_kind: 'baker',
    p_manifest_hash: 'a'.repeat(64),
    p_claim: claim,
    p_photos: Array.from({ length: 10 }, (_, position) => ({
      id: randomUUID(),
      path: `uploads/${upload}/${position}.jpg`,
      position,
      width: 10,
      height: 10,
      bytes: 100,
    })),
  };
  assert.equal(
    (
      await service.rows(
        db.rpc('claim_branch_closing_upload', {
          ...params,
          p_photos: [...params.p_photos, params.p_photos[0]],
        }),
      )
    ).error,
    'photo_limit',
  );
  assert.equal((await service.rows(db.rpc('claim_branch_closing_upload', params))).accepted, true);
  assert.equal(
    (
      await service.rows(
        db.rpc('claim_branch_closing_upload', { ...params, p_claim: randomUUID() }),
      )
    ).error,
    'upload_busy',
  );
  assert.equal(
    (
      await service.rows(
        db.rpc('claim_branch_closing_upload', { ...params, p_manifest_hash: 'b'.repeat(64) }),
      )
    ).error,
    'upload_conflict',
  );
  assert.equal(
    (
      await service.rows(
        db.rpc('finish_branch_closing_upload', { p_upload_id: upload, p_claim: claim }),
      )
    ).error,
    'photos_incomplete',
  );
  await pg.exec(
    `update branch_closing_photos set stored_at=now();update branch_closing_uploads set lease_until=now()-interval '1 second';update branch_closing_photos set expires_at=now()-interval '1 second'`,
  );
  const cleanup = await service.rows(
    db.rpc('claim_branch_closing_photo_cleanup', { p_claim: randomUUID(), p_limit: 100 }),
  );
  assert.equal(cleanup.length, 10);
  assert.equal(
    (await service.rows(db.rpc('claim_branch_closing_upload', params))).error,
    'upload_expired',
  );
});

test('admin roles and realtime events never expose photo reports to an unrelated branch', async (t) => {
  const app = express();
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-test-role'] };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  app.get('/admin/api/photo-reports', (_req, res) => res.json({ success: true }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  for (const [role, status] of [
    ['iiko_dashboard', 403],
    ['cashier', 403],
    ['viewer', 200],
    ['branch_manager', 200],
    ['owner', 200],
  ]) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/photo-reports`,
      { headers: { 'x-test-role': role } },
    );
    assert.equal(response.status, status, role);
  }
  const event = { type: 'photo-reports.updated', audience: { adminOnly: true, branchId: A } };
  assert.equal(
    realtime.canReceive(
      { admin: true, role: 'viewer', areas: ['photo-reports'], branchIds: [A] },
      event,
    ),
    true,
  );
  assert.equal(
    realtime.canReceive(
      { admin: true, role: 'viewer', areas: ['photo-reports'], branchIds: [B] },
      event,
    ),
    false,
  );
  assert.equal(
    realtime.canReceive(
      { admin: true, role: 'iiko_dashboard', areas: ['iiko-dashboard'], globalBranchAccess: true },
      event,
    ),
    false,
  );
});

test('public camera routes reject an unauthenticated multipart body before reading photos', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(require('../src/routes/branch-photo-reports.routes'));
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${origin}/branch-reports`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('permissions-policy'), /camera=\(self\)/);
  assert.match(await page.text(), /report.js/);
  const result = await fetch(`${origin}/api/branch-reports/submit`, {
    method: 'POST',
    body: 'invalid multipart',
    headers: { 'content-type': 'multipart/form-data; boundary=fixture' },
  });
  assert.equal(result.status, 401);
  assert.equal((await result.json()).code, 'PHOTO_REPORT_SESSION_EXPIRED');
  const session = await fetch(`${origin}/api/branch-reports/session`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(session.status, 401);
});
