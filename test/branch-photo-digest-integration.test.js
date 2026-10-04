const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW } = require('./helpers/photo-report-telegram-fixture.cjs');
const {
  generateDigest,
  createDigestWorker,
} = require('../src/services/branch-photo-digest.service');

test('real submitted metadata drives the digest and SQL outbox, excluding inactive/closed branches and preserving pending shifts', async (t) => {
  const { pg, db } = await fixture(t);
  await pg.exec(`create table bulka_locations(id text primary key,name text,city text,active boolean,hours jsonb,
    round_the_clock boolean,photo_day_shift_start time,photo_night_shift_start time);
    create table branch_closing_reports(id text primary key,branch_id text,business_date date,shift text,kind text,submitted_at timestamptz);
    insert into bulka_locations values
    ('a','Зал <19А>','Актау',true,'{}',false,'08:00','21:00'),
    ('closed','Выходной','Актау',true,'{"daily":{"open":"08:00","close":"21:00"},"sun":{"closed":true}}',false,'08:00','21:00'),
    ('inactive','Архив','Актау',false,'{}',false,'08:00','21:00'),
    ('night','Premium','Астана',true,'{}',true,'10:30','22:15');
    insert into branch_closing_reports values
    ('a-hall','a','2026-10-04','daily','hall','2026-10-04T17:00:00Z'),
    ('night-day-hall','night','2026-10-04','day','hall','2026-10-04T17:00:00Z'),
    ('night-day-baker','night','2026-10-04','day','baker','2026-10-04T17:00:00Z');`);
  // No photo tables exist: permanent submitted metadata is sufficient after retention cleanup.
  const digest = await generateDigest('2026-10-04', { db, now: NOW });
  assert.equal(digest.summary.activeBranches, 3);
  assert.equal(digest.summary.closedBranches, 1);
  assert.equal(digest.summary.submittedReports, 3);
  assert.equal(digest.summary.missingReports, 1);
  assert.equal(digest.summary.pendingReports, 2);
  assert.match(digest.parts[0], /Зал <19А> — Пекарь/);
  assert.match(digest.parts[0], /Premium · ночная 22:15–10:30/);
  assert.doesNotMatch(digest.parts[0], /Выходной|Архив/);
  const sent = [];
  const options = {
    db,
    now: () => NOW,
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      return { status: 'sent', messageId: 42 };
    },
  };
  assert.equal((await createDigestWorker(options).tick()).delivered, 1);
  assert.equal(sent[0].chatId, '101');
  assert.equal(sent[0].text, digest.parts[0]);
  await createDigestWorker(options).tick();
  assert.equal(sent.length, 1);
  const row = (await pg.query('select status,message_id from photo_report_telegram_outbox'))
    .rows[0];
  assert.deepEqual(row, { status: 'sent', message_id: '42' });
});

test('production SQL429 cooldown holds another recipient and multipart delivery survives restart without replacing the snapshot', async (t) => {
  const { pg, db, store, options } = await fixture(t);
  await store.observeUser(
    { id: '202', chatId: '202', username: 'branch_admin', private: true },
    options,
  );
  await store.addAdmin('101', 'branch_admin', options);
  const sent = [];
  let now = NOW;
  const base = { db, now: () => now, generate: async () => ({ parts: ['Часть1', 'Часть2'] }) };
  const first = createDigestWorker({
    ...base,
    sendMessage: async (chatId, text) => {
      sent.push([chatId, text]);
      return { status: 'retryable', retryAfterSeconds: 120 };
    },
  });
  assert.equal((await first.tick()).retried, 1);
  assert.equal(sent.length, 1);
  const resume = () =>
    createDigestWorker({
      ...base,
      generate: async () => {
        throw new Error('persisted digest must not regenerate');
      },
      sendMessage: async (chatId, text) => {
        sent.push([chatId, text]);
        return { status: 'sent', messageId: sent.length };
      },
    });
  now = new Date(NOW.getTime() + 119000);
  assert.equal((await resume().tick()).delivered, 0);
  assert.equal(sent.length, 1);
  now = new Date(NOW.getTime() + 120000);
  assert.equal((await resume().tick()).delivered, 4);
  assert.equal(sent.length, 5);
  assert.equal(
    (await pg.query('select count(*)::int n from photo_report_telegram_digests')).rows[0].n,
    1,
  );
  assert.equal(
    (await pg.query("select count(*)::int n from photo_report_telegram_outbox where status='sent'"))
      .rows[0].n,
    4,
  );
  assert.equal((await resume().tick()).delivered, 0);
  assert.equal(sent.length, 5);
});

test('production outbox preserves an uncertain first part and does not send it or its continuation again', async (t) => {
  const { pg, db } = await fixture(t);
  let now = NOW;
  let sent = 0;
  const options = {
    db,
    now: () => now,
    generate: async () => ({ parts: ['Часть1', 'Часть2'] }),
    sendMessage: async () => {
      sent++;
      return { status: 'uncertain' };
    },
  };
  await assert.rejects(createDigestWorker(options).tick(), {
    code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
    uncertain: 1,
  });
  now = new Date(NOW.getTime() + 180000);
  await assert.rejects(
    createDigestWorker({
      ...options,
      sendMessage: async () => {
        sent++;
        return { status: 'sent', messageId: 2 };
      },
    }).tick(),
    { code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED', uncertain: 1 },
  );
  assert.equal(sent, 1);
  const statuses = (
    await pg.query('select status from photo_report_telegram_outbox order by part_index')
  ).rows.map((row) => row.status);
  assert.deepEqual(statuses, ['uncertain', 'queued']);
});

test('crash-expired SQL delivery stays uncertain and surfaces operational failure after restart', async (t) => {
  const { pg, db, store, options } = await fixture(t);
  await store.enqueueDigest('2026-10-04', ['Часть1', 'Часть2'], options);
  const claimed = await store.claimDeliveries(1, options);
  assert.equal(claimed.length, 1);
  let sent = 0;
  const workerOptions = {
    db,
    now: () => new Date(NOW.getTime() + 91000),
    generate: async () => {
      throw new Error('persisted snapshot must not regenerate');
    },
    sendMessage: async () => {
      sent++;
      return { status: 'sent', messageId: 1 };
    },
  };
  for (let restart = 0; restart < 2; restart++)
    await assert.rejects(createDigestWorker(workerOptions).tick(), {
      code: 'PHOTO_REPORT_TELEGRAM_DELIVERY_FAILED',
      uncertain: 1,
    });
  assert.equal(sent, 0);
  const statuses = (
    await pg.query('select status from photo_report_telegram_outbox order by part_index')
  ).rows.map((row) => row.status);
  assert.deepEqual(statuses, ['uncertain', 'queued']);
});

test('a definite403 disables the SQL recipient without leaving an operational delivery failure', async (t) => {
  const { db, store, options } = await fixture(t);
  const worker = createDigestWorker({
    db,
    now: () => NOW,
    generate: async () => ({ parts: ['Часть1', 'Часть2'] }),
    sendMessage: async () => ({ status: 'forbidden' }),
  });
  assert.equal((await worker.tick()).disabled, 1);
  assert.deepEqual(await store.getUnresolvedDeliveryCounts(options), { uncertain: 0, failed: 0 });
  await store.observeUser(
    { id: '101', chatId: '101', username: 'amandyk7292', private: true },
    options,
  );
  assert.deepEqual(await store.getUnresolvedDeliveryCounts(options), { uncertain: 0, failed: 0 });
  const restarted = createDigestWorker({
    db,
    now: () => NOW,
    sendMessage: async () => {
      throw new Error('disabled recipient must not receive another part');
    },
  });
  assert.equal((await restarted.tick()).failed, 0);
});
