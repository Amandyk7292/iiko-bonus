const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateDigest,
  localClock,
  previousCalendarDate,
} = require('../src/services/branch-photo-digest.service');

const DATE = '2026-10-05';
const NOW = new Date('2026-10-06T04:00:00Z');
const branch = (id, extra = {}) => ({
  id,
  name: `Точка ${id}`,
  city: 'Актау',
  active: true,
  hours: {},
  round_the_clock: false,
  ...extra,
});
const report = (id, branchId, kind, extra = {}) => ({
  id,
  branch_id: branchId,
  business_date: DATE,
  shift: 'daily',
  kind,
  submitted_at: '2026-10-05T17:00:00Z',
  ...extra,
});

function database(branches, reports = [], failure = null) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.ok(
        ['bulka_locations', 'branch_closing_reports'].includes(table),
        'photo objects must never be read',
      );
      let filters = [],
        offset = 0,
        end = 999;
      const query = {
        select(fields) {
          calls.push({ table, fields });
          return query;
        },
        eq(field, value) {
          filters.push([field, value]);
          return query;
        },
        order(field) {
          assert.equal(field, 'id');
          return query;
        },
        range(start, last) {
          offset = start;
          end = last;
          calls.push({ table, offset });
          return query;
        },
        then(resolve, reject) {
          if (failure?.table === table && offset >= (failure.offset || 0))
            return Promise.resolve({ data: null, error: new Error('database unavailable') }).then(
              resolve,
              reject,
            );
          const rows = (table === 'bulka_locations' ? branches : reports)
            .filter((row) => filters.every(([field, value]) => row[field] === value))
            .sort((a, b) => a.id.localeCompare(b.id));
          return Promise.resolve({ data: rows.slice(offset, end + 1), error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
  };
}
const generate = (branches, reports = [], options = {}) =>
  generateDigest(DATE, { db: database(branches, reports), now: NOW, ...options });

test('digest calendar uses Asia/Oral midnight rather than the report 04:00 cutoff', () => {
  assert.deepEqual(localClock(new Date('2026-10-05T18:59:59Z')), { date: DATE, time: '23:59' });
  assert.deepEqual(localClock(new Date('2026-10-05T19:00:00Z')), {
    date: '2026-10-06',
    time: '00:00',
  });
  assert.equal(previousCalendarDate(new Date('2026-10-05T19:00:00Z')), DATE);
  assert.equal(previousCalendarDate(new Date('2026-12-31T19:00:00Z')), '2026-12-31');
  assert.equal(previousCalendarDate(new Date('2026-02-28T19:00:00Z')), '2026-02-28');
});

test('missing kinds are grouped by city, inactive branches excluded, and report metadata survives photo cleanup', async () => {
  const db = database(
    [branch('a'), branch('b', { city: 'Астана' }), branch('inactive', { active: false })],
    [report('r', 'a', 'hall')],
  );
  const digest = await generateDigest(DATE, { db, now: NOW });
  assert.deepEqual(digest.summary, {
    date: DATE,
    activeBranches: 2,
    expectedBranches: 2,
    closedBranches: 0,
    expectedReports: 4,
    submittedReports: 1,
    missingReports: 3,
    pendingReports: 0,
    missingBranches: 2,
    pendingBranches: 0,
  });
  const text = digest.parts.join('\n');
  assert.match(text, /Фотоотчёты за 05\.10\.2026/);
  assert.match(text, /Актау\n• Точка a — Пекарь/);
  assert.match(text, /Астана\n• Точка b — Зал, Пекарь/);
  assert.doesNotMatch(text, /inactive/);
  assert.ok(
    db.calls.every((call) => !call.fields || !/photo_count|photos|expires_at/.test(call.fields)),
  );
});

test('configured closed weekdays are skipped, weekly schedules override daily, and no hours keep daily expectation', async () => {
  const digest = await generate([
    branch('closed', {
      hours: { daily: { open: '08:00', close: '21:00' }, mon: { closed: true } },
    }),
    branch('other-day', { hours: { tue: { open: '08:00', close: '21:00' } } }),
    branch('open', { hours: { daily: { closed: true }, mon: { open: '22:00', close: '02:00' } } }),
    branch('legacy', { hours: null }),
  ]);
  assert.equal(digest.summary.closedBranches, 2);
  assert.equal(digest.summary.expectedBranches, 2);
  assert.equal(digest.summary.missingReports, 4);
  assert.doesNotMatch(digest.parts.join('\n'), /Точка closed|Точка other-day/);
});

test('24/7 shifts use yesterday start date and custom shift boundaries without flagging an unfinished night', async () => {
  const digest = await generate(
    [
      branch('a', {
        round_the_clock: true,
        hours: { daily: { closed: true } },
        photo_day_shift_start: '10:30:00',
        photo_night_shift_start: '22:15:00',
      }),
    ],
    [
      report('day-hall', 'a', 'hall', { shift: 'day' }),
      report('day-baker', 'a', 'baker', { shift: 'day' }),
      report('other-night', 'a', 'hall', { shift: 'night', business_date: '2026-10-04' }),
    ],
  );
  assert.equal(digest.summary.expectedReports, 4);
  assert.equal(digest.summary.submittedReports, 2);
  assert.equal(digest.summary.missingReports, 0);
  assert.equal(digest.summary.pendingReports, 2);
  assert.match(digest.parts[0], /Смена ещё идёт · не считается пропуском/);
  assert.match(digest.parts[0], /ночная 22:15–10:30 — Зал, Пекарь; до 10:30/);
  const ended = await generate(
    [
      branch('a', {
        round_the_clock: true,
        photo_day_shift_start: '10:30',
        photo_night_shift_start: '22:15',
      }),
    ],
    [],
    { now: new Date('2026-10-06T05:30:00Z') },
  );
  assert.equal(ended.summary.pendingReports, 0);
  assert.equal(ended.summary.missingReports, 4);
});

test('daily deadline is next-day04:00; a midnight send shows pending and exactly04:00 can show missing', async () => {
  for (const now of ['2026-10-05T19:00:00Z', '2026-10-05T22:59:59Z']) {
    const digest = await generate([branch('a')], [], { now: new Date(now) });
    assert.equal(digest.summary.missingReports, 0);
    assert.equal(digest.summary.pendingReports, 2);
    assert.match(digest.parts[0], /до 04:00/);
  }
  const digest = await generate([branch('a')], [], { now: new Date('2026-10-05T23:00:00Z') });
  assert.equal(digest.summary.missingReports, 2);
  assert.equal(digest.summary.pendingReports, 0);
});

test('all submitted, all closed and no active branches have clear concise results', async () => {
  const complete = await generate(
    [branch('a')],
    [report('hall', 'a', 'hall'), report('baker', 'a', 'baker')],
  );
  assert.match(complete.parts[0], /Все отчёты отправлены/);
  assert.equal(complete.summary.missingReports, 0);
  const closed = await generate([branch('a', { hours: { daily: { closed: true } } })]);
  assert.match(closed.parts[0], /В этот день точки не работали/);
  const empty = await generate([branch('a', { active: false })]);
  assert.match(empty.parts[0], /Нет активных точек/);
});

test('stable pagination covers more than1000 branches/reports and chunks plain text within Telegram bounds', async () => {
  const branches = Array.from({ length: 1200 }, (_, i) =>
    branch(String(i).padStart(4, '0'), { name: `${i} <Зал> & 😀 длинное название` }),
  );
  const reports = branches.map((item, i) => report(`r${i}`, item.id, 'hall'));
  const db = database(branches, reports);
  const digest = await generateDigest(DATE, { db, now: NOW });
  assert.equal(digest.summary.expectedReports, 2400);
  assert.equal(digest.summary.submittedReports, 1200);
  assert.equal(digest.summary.missingReports, 1200);
  assert.ok(db.calls.some((call) => call.table === 'bulka_locations' && call.offset === 1000));
  assert.ok(
    db.calls.some((call) => call.table === 'branch_closing_reports' && call.offset === 1000),
  );
  assert.ok(digest.parts.length > 1 && digest.parts.length <= 20);
  assert.ok(digest.parts.every((part) => part.length <= 4096));
  assert.match(digest.parts.join('\n'), /1199 <Зал> & 😀/);
});

test('database outage or a later-page failure aborts generation without a false all-missing summary', async () => {
  for (const table of ['bulka_locations', 'branch_closing_reports']) {
    await assert.rejects(
      generateDigest(DATE, { db: database([branch('a')], [], { table }), now: NOW }),
      { code: 'PHOTO_REPORT_DIGEST_READ_FAILED' },
    );
  }
  const branches = Array.from({ length: 1001 }, (_, i) => branch(String(i)));
  await assert.rejects(
    generateDigest(DATE, {
      db: database(branches, [], { table: 'bulka_locations', offset: 1000 }),
      now: NOW,
    }),
    { code: 'PHOTO_REPORT_DIGEST_READ_FAILED' },
  );
});

test('invalid dates, malformed schedules and corrupt submitted metadata fail closed', async () => {
  const db = database([branch('a')]);
  await assert.rejects(generateDigest('2026-02-30', { db, now: NOW }), {
    code: 'PHOTO_REPORT_DIGEST_DATE_INVALID',
  });
  await assert.rejects(generateDigest('2026-10-07', { db, now: NOW }), {
    code: 'PHOTO_REPORT_DIGEST_DATE_INVALID',
  });
  await assert.rejects(
    generate([branch('a', { hours: { daily: { open: 'wrong', close: '21:00' } } })]),
    { code: 'PHOTO_REPORT_DIGEST_SCHEDULE_INVALID' },
  );
  await assert.rejects(
    generate([
      branch('a', {
        round_the_clock: true,
        photo_day_shift_start: '22:00',
        photo_night_shift_start: '08:00',
      }),
    ]),
    { code: 'PHOTO_REPORT_DIGEST_SCHEDULE_INVALID' },
  );
  await assert.rejects(
    generate([branch('a')], [report('bad', 'a', 'hall', { submitted_at: null })]),
    { code: 'PHOTO_REPORT_DIGEST_READ_FAILED' },
  );
});

test('branch names cannot inject digest headings with line breaks; overlarge digest refuses truncation', async () => {
  const digest = await generate([
    branch('a', { name: 'Зал\nВсе отчёты отправлены.', city: ' Актау\r\n ' }),
  ]);
  assert.match(digest.parts[0], /• Зал Все отчёты отправлены\. — Зал, Пекарь/);
  const branches = Array.from({ length: 1000 }, (_, i) =>
    branch(String(i), { name: 'длинное имя '.repeat(30) }),
  );
  await assert.rejects(generate(branches), { code: 'PHOTO_REPORT_DIGEST_TOO_LARGE' });
});
