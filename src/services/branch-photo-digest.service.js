const { supabase } = require('../config/supabase');
const {
  clockMinutes,
  isRoundTheClock,
  photoPeriod,
  shiftTimes,
} = require('../utils/branch-schedule.util');

const TIME_ZONE = 'Asia/Oral';
const DAY = 86400000;
const MINUTE = 60000;
const PAGE_SIZE = 1000;
const KINDS = ['hall', 'baker'];
const KIND_LABELS = { hall: 'Зал', baker: 'Пекарь' };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const localFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const digestError = (code) =>
  Object.assign(new Error('Не удалось подготовить сводку фотоотчётов.'), { code });

function dateStamp(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))
    throw digestError('PHOTO_REPORT_DIGEST_DATE_INVALID');
  const stamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date)
    throw digestError('PHOTO_REPORT_DIGEST_DATE_INVALID');
  return stamp;
}

function localClock(now = new Date()) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw digestError('PHOTO_REPORT_DIGEST_DATE_INVALID');
  const parts = Object.fromEntries(
    localFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

const previousCalendarDate = (now = new Date()) =>
  new Date(dateStamp(localClock(now).date) - DAY).toISOString().slice(0, 10);

async function pages(query) {
  const all = [];
  const ids = new Set();
  for (let offset = 0; offset < PAGE_SIZE * 1000; offset += PAGE_SIZE) {
    const { data, error } = await query()
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw digestError('PHOTO_REPORT_DIGEST_READ_FAILED');
    for (const row of data) {
      if (!row || typeof row.id !== 'string' || ids.has(row.id))
        throw digestError('PHOTO_REPORT_DIGEST_READ_FAILED');
      ids.add(row.id);
      all.push(row);
    }
    if (data.length < PAGE_SIZE) return all;
  }
  throw digestError('PHOTO_REPORT_DIGEST_READ_FAILED');
}

const hoursMinute = (value) => (value === '24:00' ? 1440 : clockMinutes(value));
function worksOn(branch, stamp) {
  if (isRoundTheClock(branch)) return true;
  const hours = branch.hours;
  if (
    hours == null ||
    (typeof hours === 'object' && !Array.isArray(hours) && !Object.keys(hours).length)
  )
    return true;
  if (typeof hours !== 'object' || Array.isArray(hours))
    throw digestError('PHOTO_REPORT_DIGEST_SCHEDULE_INVALID');
  for (const [day, schedule] of Object.entries(hours)) {
    if (
      !['daily', ...WEEKDAYS].includes(day) ||
      !schedule ||
      typeof schedule !== 'object' ||
      Array.isArray(schedule)
    )
      throw digestError('PHOTO_REPORT_DIGEST_SCHEDULE_INVALID');
    if (schedule.closed === true) continue;
    const open = hoursMinute(schedule.open),
      close = hoursMinute(schedule.close);
    if (open == null || close == null || open === close || open === 1440)
      throw digestError('PHOTO_REPORT_DIGEST_SCHEDULE_INVALID');
  }
  const schedule = hours[WEEKDAYS[new Date(stamp).getUTCDay()]] ?? hours.daily;
  return Boolean(schedule && schedule.closed !== true);
}

function slotsFor(branch, date, stamp) {
  // Daily business dates close at 04:00 next day in UTC+5, which is 23:00 UTC.
  if (!isRoundTheClock(branch))
    return [{ shift: 'daily', label: '', endsAt: stamp + DAY - 60 * MINUTE }];
  const times = shiftTimes(branch);
  const day = clockMinutes(times.day),
    night = clockMinutes(times.night);
  if (day == null || night == null || day >= night)
    throw digestError('PHOTO_REPORT_DIGEST_SCHEDULE_INVALID');
  const anchor = new Date(stamp + (1440 - 300) * MINUTE - 1);
  return ['day', 'night'].map((shift) => {
    const period = photoPeriod(branch, shift, anchor);
    if (period.date !== date) throw digestError('PHOTO_REPORT_DIGEST_SCHEDULE_INVALID');
    return {
      shift,
      label:
        shift === 'day'
          ? `дневная ${times.day}–${times.night}`
          : `ночная ${times.night}–${times.day}`,
      endsAt: Date.parse(period.shiftEndsAt),
    };
  });
}

const cleanLabel = (value, fallback) =>
  String(value ?? '')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim() || fallback;
const key = (branch, shift, kind) => `${branch}/${shift}/${kind}`;

function appendGroup(lines, title, entries) {
  if (!entries.length) return;
  lines.push('', title);
  let city = null;
  for (const entry of entries) {
    if (entry.city !== city) {
      city = entry.city;
      lines.push(city);
    }
    lines.push(entry.line);
  }
}

function chunkLines(lines, header) {
  const limit = 4096 - header.length - 20;
  const chunks = [];
  let chunk = '';
  for (let line of lines) {
    while (line.length > limit) {
      let cut = limit;
      if (/^[\uDC00-\uDFFF]$/.test(line[cut])) cut--;
      if (chunk) {
        chunks.push(chunk);
        chunk = '';
      }
      chunks.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    if (chunk && chunk.length + line.length + 1 > limit) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += `${chunk ? '\n' : ''}${line}`;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 20) throw digestError('PHOTO_REPORT_DIGEST_TOO_LARGE');
  return chunks.map(
    (body, index) =>
      `${header}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ''}\n${body}`,
  );
}

async function generateDigest(date, { db = supabase, now = new Date() } = {}) {
  const stamp = dateStamp(date);
  const instant = new Date(now);
  if (date > localClock(instant).date) throw digestError('PHOTO_REPORT_DIGEST_DATE_INVALID');
  const [branches, reports] = await Promise.all([
    pages(() =>
      db
        .from('bulka_locations')
        .select(
          'id,name,city,active,hours,round_the_clock,photo_day_shift_start,photo_night_shift_start',
        )
        .eq('active', true),
    ),
    pages(() =>
      db
        .from('branch_closing_reports')
        .select('id,branch_id,business_date,shift,kind,submitted_at')
        .eq('business_date', date),
    ),
  ]);
  const received = new Set();
  for (const report of reports) {
    if (
      report.business_date !== date ||
      !KINDS.includes(report.kind) ||
      !['daily', 'day', 'night'].includes(report.shift || 'daily') ||
      !Number.isFinite(Date.parse(report.submitted_at))
    )
      throw digestError('PHOTO_REPORT_DIGEST_READ_FAILED');
    received.add(key(report.branch_id, report.shift || 'daily', report.kind));
  }
  const summary = {
    date,
    activeBranches: 0,
    expectedBranches: 0,
    closedBranches: 0,
    expectedReports: 0,
    submittedReports: 0,
    missingReports: 0,
    pendingReports: 0,
    missingBranches: 0,
    pendingBranches: 0,
  };
  const missing = [],
    pending = [];
  const active = branches
    .filter((branch) => branch.active === true)
    .map((branch) => ({
      ...branch,
      cityLabel: cleanLabel(branch.city, 'Без города'),
      nameLabel: cleanLabel(branch.name, 'Точка'),
    }))
    .sort(
      (a, b) =>
        a.cityLabel.localeCompare(b.cityLabel, 'ru') ||
        a.nameLabel.localeCompare(b.nameLabel, 'ru') ||
        a.id.localeCompare(b.id),
    );
  summary.activeBranches = active.length;
  for (const branch of active) {
    if (!worksOn(branch, stamp)) {
      summary.closedBranches++;
      continue;
    }
    summary.expectedBranches++;
    let hasMissing = false,
      hasPending = false;
    for (const slot of slotsFor(branch, date, stamp)) {
      const absent = KINDS.filter((kind) => !received.has(key(branch.id, slot.shift, kind)));
      summary.expectedReports += 2;
      summary.submittedReports += 2 - absent.length;
      if (!absent.length) continue;
      const running = instant.getTime() < slot.endsAt;
      const label = `${branch.nameLabel}${slot.label ? ` · ${slot.label}` : ''}`;
      const entry = {
        city: branch.cityLabel,
        line: `• ${label} — ${absent.map((kind) => KIND_LABELS[kind]).join(', ')}`,
      };
      if (running) {
        hasPending = true;
        summary.pendingReports += absent.length;
        entry.line += `; до ${localClock(new Date(slot.endsAt)).time}`;
        pending.push(entry);
      } else {
        hasMissing = true;
        summary.missingReports += absent.length;
        missing.push(entry);
      }
    }
    if (hasMissing) summary.missingBranches++;
    if (hasPending) summary.pendingBranches++;
  }
  const lines = [
    `Получено: ${summary.submittedReports}/${summary.expectedReports} · нет: ${summary.missingReports}${summary.pendingReports ? ` · ожидаем: ${summary.pendingReports}` : ''}`,
  ];
  if (!summary.activeBranches) lines.push('Нет активных точек.');
  else if (!summary.expectedBranches) lines.push('В этот день точки не работали.');
  else if (!missing.length && !pending.length) lines.push('Все отчёты отправлены.');
  else if (!missing.length) lines.push('Все завершённые смены отчитались.');
  if (summary.closedBranches) lines.push(`Не работали: ${summary.closedBranches}.`);
  appendGroup(lines, `Нет отчётов · точек: ${summary.missingBranches}`, missing);
  appendGroup(lines, 'Смена ещё идёт · не считается пропуском', pending);
  const header = `Фотоотчёты за ${date.split('-').reverse().join('.')}`;
  return { parts: chunkLines(lines, header), summary };
}

const createDigestWorker = (options) =>
  require('./branch-photo-digest-worker.service').createDigestWorker(options);
module.exports = {
  generateDigest,
  localClock,
  previousCalendarDate,
  TIME_ZONE,
  createDigestWorker,
};
