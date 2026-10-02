const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const sharp = require('sharp');
const service = require('../src/services/branch-photo-reports.service');
const { submitPhotos } = require('../src/services/branch-photo-upload.service');
const { photoPeriod } = require('../src/utils/branch-schedule.util');
const { database } = require('./helpers/photo-report-database.cjs');
const A = '11111111-1111-4111-8111-111111111111';
const OWNER = { role: 'owner' };
async function fixture(t, beforeMigration) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key,name text,city text,active boolean,sort_order int default 0);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text);
    insert into bulka_locations(id,name,city,active) values('${A}','Точка А','Актау',true);`);
  await pg.exec(
    readFileSync('supabase/migrations/20261001150000_branch_closing_photo_reports.sql', 'utf8'),
  );
  if (beforeMigration) await beforeMigration(pg);
  await pg.exec(
    readFileSync('supabase/migrations/20261002120000_round_the_clock_shifts.sql', 'utf8'),
  );
  await pg.exec(`update bulka_locations set round_the_clock=true where id='${A}'`);
  const db = database(pg);
  const qr = await service.ensureQr(OWNER, A, { db });
  const token = new URLSearchParams(new URL(qr.url).hash.slice(1)).get('t');
  return { pg, db, token };
}
test('migration preserves legacy report and photo rows and expands uniqueness without losing constraints', async (t) => {
  const upload = randomUUID();
  const photo = randomUUID();
  const { pg } = await fixture(t, async (db) => {
    await db.query(
      `insert into branch_closing_uploads(id,branch_id,business_date,kind,branch_name,city,manifest_hash,claim,lease_until,submitted_at)
      values($1,$2,'2026-10-01','hall','Точка А','Актау',$3,$4,now(),now());`,
      [upload, A, 'a'.repeat(64), randomUUID()],
    );
    await db.query(
      `insert into branch_closing_reports(branch_id,business_date,kind,branch_name,city,upload_id,photo_count)
      values($1,'2026-10-01','hall','Точка А','Актау',$2,1)`,
      [A, upload],
    );
    await db.query(
      `insert into branch_closing_photos(id,upload_id,position,object_path,bytes,width,height,stored_at,expires_at)
      values($1,$2,0,$3,100,20,20,now(),now()+interval '3 days')`,
      [photo, upload, `uploads/${upload}/0.jpg`],
    );
  });
  const saved = (
    await pg.query('select shift,photo_count from branch_closing_reports where upload_id=$1', [
      upload,
    ])
  ).rows[0];
  assert.deepEqual(saved, { shift: 'daily', photo_count: 1 });
  assert.equal(
    (
      await pg.query(
        'select count(*)::int as count from branch_closing_photos where id=$1 and deleted_at is null',
        [photo],
      )
    ).rows[0].count,
    1,
  );
  for (const shift of ['day', 'night']) {
    const id = randomUUID();
    await pg.query(
      `insert into branch_closing_uploads(id,branch_id,business_date,shift,kind,branch_name,city,manifest_hash,claim,lease_until)
      values($1,$2,'2026-10-01',$3,'hall','Точка А','Актау',$4,$5,now())`,
      [id, A, shift, 'b'.repeat(64), randomUUID()],
    );
    await pg.query(
      `insert into branch_closing_reports(branch_id,business_date,shift,kind,branch_name,city,upload_id,photo_count)
      values($1,'2026-10-01',$2,'hall','Точка А','Актау',$3,1)`,
      [A, shift, id],
    );
  }
  assert.equal(
    (await pg.query('select count(*)::int as count from branch_closing_reports')).rows[0].count,
    3,
  );
  const constraints = (
    await pg.query(
      "select conname from pg_constraint where conrelid='branch_closing_reports'::regclass",
    )
  ).rows;
  assert.ok(constraints.some((r) => r.conname === 'branch_closing_reports_shift_unique'));
  assert.ok(constraints.some((r) => r.conname === 'branch_closing_reports_upload_id_key'));
});
test('shift periods agree between API and database across handovers, midnight and year end', async (t) => {
  const { pg, db, token } = await fixture(t);
  const branch = {
    round_the_clock: true,
    photo_day_shift_start: '08:00',
    photo_night_shift_start: '21:00',
  };
  for (const [now, defaultShift, expectedDate] of [
    ['2026-10-02T02:59:59Z', 'day', '2026-10-01'],
    ['2026-10-02T03:00:00Z', 'night', '2026-10-01'],
    ['2026-10-02T15:59:59Z', 'night', '2026-10-01'],
    ['2026-10-02T16:00:00Z', 'day', '2026-10-02'],
    ['2026-12-31T19:00:00Z', 'day', '2026-12-31'],
    ['2027-01-01T03:00:00Z', 'night', '2026-12-31'],
  ]) {
    const chosen = photoPeriod(branch, undefined, new Date(now));
    assert.equal(chosen.shift, defaultShift);
    assert.equal(chosen.date, expectedDate);
    for (const shift of ['day', 'night']) {
      const js = photoPeriod(branch, shift, new Date(now));
      const sql = await service.rows(
        db.rpc('branch_closing_period', { p_branch: A, p_shift: shift, p_now: now }),
      );
      assert.equal(sql.date, js.date);
      assert.equal(Date.parse(sql.startsAt), Date.parse(js.shiftStartsAt));
      assert.equal(Date.parse(sql.endsAt), Date.parse(js.shiftEndsAt));
    }
    const session = await service.openSession(token, { db, now: new Date(now) });
    assert.equal(session.shift, defaultShift);
    assert.equal(session.date, expectedDate);
  }
  await pg.exec(
    `update bulka_locations set photo_day_shift_start='07:30',photo_night_shift_start='22:15'`,
  );
  const session = await service.openSession(token, {
    db,
    shift: 'night',
    now: new Date('2026-10-02T02:30:00Z'),
  });
  assert.equal(session.shiftStartsAt, '2026-10-01T17:15:00.000Z');
  assert.equal(session.shiftEndsAt, '2026-10-02T02:30:00.000Z');
  await assert.rejects(service.openSession(token, { db, shift: 'daily' }));
  const privilege = (
    await pg.query(
      "select has_function_privilege('anon','branch_closing_period(uuid,text,timestamptz)','execute') as allowed",
    )
  ).rows[0];
  assert.equal(privilege.allowed, false);
});
test('each shift has its own immutable reports and 72-hour photo retention, while old daily history survives', async (t) => {
  const { pg, db, token } = await fixture(t);
  const files = [
    {
      buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ddd' } })
        .jpeg()
        .toBuffer(),
    },
  ];
  const objects = new Map();
  const storage = {
    from() {
      return {
        async upload(path, buffer) {
          objects.set(path, buffer);
          return {};
        },
      };
    },
  };
  const sessions = [];
  for (const shift of ['day', 'night']) {
    const session = await service.openSession(token, { db, shift });
    sessions.push(session);
    await service.resolveSession(session.sessionToken, { db });
    for (const kind of ['hall', 'baker']) {
      const body = { uploadId: randomUUID(), kind };
      assert.equal(
        (await submitPhotos(session.sessionToken, body, files, { db, storage })).submitted,
        true,
      );
      assert.equal(
        (await submitPhotos(session.sessionToken, body, files, { db, storage })).submitted,
        true,
      );
      await assert.rejects(
        submitPhotos(session.sessionToken, { ...body, uploadId: randomUUID() }, files, {
          db,
          storage,
        }),
        { code: 'PHOTO_REPORT_ALREADY_SUBMITTED' },
      );
    }
  }
  const rows = (
    await pg.query(
      `select r.*, extract(epoch from(p.expires_at-r.submitted_at)) as lifetime from branch_closing_reports r join branch_closing_photos p on p.upload_id=r.upload_id`,
    )
  ).rows;
  assert.equal(rows.length, 4);
  assert.equal(objects.size, 4);
  assert.equal(new Set(rows.map((r) => r.shift + r.kind)).size, 4);
  rows.forEach((r) => assert.equal(Number(r.lifetime), 72 * 3600));
  for (const session of sessions) {
    const detail = await service.details(OWNER, A, session.date, { db });
    assert.equal(detail.reports.filter((r) => r.shift === session.shift).length, 2);
  }
  await pg.exec(`update bulka_locations set round_the_clock=false`);
  await assert.rejects(service.resolveSession(sessions[0].sessionToken, { db }), {
    code: 'PHOTO_REPORT_SESSION_EXPIRED',
  });
  const daily = await service.openSession(token, { db });
  await submitPhotos(daily.sessionToken, { uploadId: randomUUID(), kind: 'hall' }, files, {
    db,
    storage,
  });
  const dailyReport = (await service.details(OWNER, A, daily.date, { db })).reports.find(
    (r) => r.shift === 'daily',
  );
  assert.ok(dailyReport);
  await pg.exec(`update bulka_locations set round_the_clock=true`);
  await assert.rejects(service.resolveSession(daily.sessionToken, { db }), {
    code: 'PHOTO_REPORT_SESSION_EXPIRED',
  });
  assert.equal(
    (await service.details(OWNER, A, daily.date, { db })).reports.find(
      (r) => r.id === dailyReport.id,
    ).photoCount,
    1,
  );
  const shifted = await service.openSession(token, { db, shift: 'day' });
  await pg.exec(`update bulka_locations set photo_day_shift_start='07:00'`);
  await assert.rejects(service.resolveSession(shifted.sessionToken, { db }), {
    code: 'PHOTO_REPORT_SESSION_EXPIRED',
  });
  assert.equal(
    (await pg.query('select count(*)::int as count from branch_closing_reports')).rows[0].count,
    5,
  );
});
test('timestamp formatting from PostgREST does not invalidate an otherwise valid shift session', async (t) => {
  const { db, token } = await fixture(t);
  const session = await service.openSession(token, { db, shift: 'night' });
  const adapter = {
    ...db,
    from(table) {
      const query = db.from(table);
      if (table === 'branch_closing_sessions') {
        const original = query.then;
        query.then = function (resolve, reject) {
          return original.call(
            this,
            (result) => {
              if (result.data)
                for (const field of ['shift_starts_at', 'shift_ends_at'])
                  result.data[field] = result.data[field].replace('.000Z', '+00:00');
              return resolve(result);
            },
            reject,
          );
        };
      }
      return query;
    },
  };
  assert.equal(
    (await service.resolveSession(session.sessionToken, { db: adapter })).shift,
    'night',
  );
});
