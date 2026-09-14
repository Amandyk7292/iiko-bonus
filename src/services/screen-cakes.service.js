const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { service: reports } = require('./iiko-dashboard.service');
const { logger } = require('../config/logger');

const PRODUCT_ID = '481f6762-b42b-46c8-8fe4-6d496b6c7079';
const REFRESH_MS = 60000;
const localDay = (now) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

function aktauSources(servers) {
  const active = servers.filter((s) => s.city === 'aktau' && s.active && s.configured);
  const chain = active.find((s) => s.kind === 'chain');
  return chain ? [chain] : active.filter((s) => s.kind === 'rms');
}

async function buildSnapshot(reporting, now = new Date(), history = {}) {
  const to = localDay(now);
  const sources = aktauSources(await reporting.listServers());
  if (!sources.length) throw new Error('No configured Aktau reporting source');
  const periods = {};
  const ranges = {
    year: `${to.slice(0, 4)}-01-01`,
    month: `${to.slice(0, 7)}-01`,
  };
  for (let year = 2000; year < Number(to.slice(0, 4)); year += 1) ranges[year] = `${year}-01-01`;
  for (const [key, from] of Object.entries(ranges)) {
    let grams = 0;
    const historic = /^\d{4}$/.test(key);
    const end = historic ? `${key}-12-31` : to;
    for (const source of sources) {
      const cacheKey = `${source.id}:${source.host || ''}:${from}`;
      const cached = history[cacheKey];
      if (historic && cached?.day === to && Number.isFinite(cached.grams)) {
        grams += cached.grams;
        continue;
      }
      const result = await reporting.report({
        serverId: source.id,
        reportType: 'SALES',
        from,
        to: end,
        groupBy: ['DishId', 'DishMeasureUnit'],
        aggregate: ['DishAmountInt'],
        filters: [
          { field: 'DishId', values: [PRODUCT_ID] },
          { field: 'OrderDeleted', values: ['NOT_DELETED'] },
          { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
          { field: 'Storned', values: ['FALSE'] },
        ],
      });
      let sourceGrams = 0;
      for (const row of result.rows) {
        if (String(row.DishId).toLowerCase() !== PRODUCT_ID) continue;
        if (String(row.DishMeasureUnit).trim().toLowerCase() !== 'кг') {
          throw new Error('Pancake sales unit changed; conversion needs verification');
        }
        const amount = Number(row.DishAmountInt);
        if (!Number.isFinite(amount)) throw new Error('Invalid pancake sales quantity');
        sourceGrams += Math.round(amount * 1000);
      }
      grams += sourceGrams;
      if (historic) history[cacheKey] = { day: to, grams: sourceGrams };
    }
    if (grams < 0) throw new Error('Negative net pancake sales quantity');
    periods[key] = { from, to: end, quantity: grams / 1000 };
  }
  const totalGrams = Object.entries(periods)
    .filter(([key]) => key !== 'month')
    .reduce((sum, [, period]) => sum + Math.round(period.quantity * 1000), 0);
  const publicPeriods = {
    all: { from: '2000-01-01', to, quantity: totalGrams / 1000 },
    year: periods.year,
    month: periods.month,
  };
  return {
    schemaVersion: 1,
    city: 'Актау',
    product: 'Блины - 17',
    unit: 'kg',
    generatedAt: now.toISOString(),
    periods: publicPeriods,
  };
}

class ScreenCakesService {
  constructor({
    reporting = reports,
    now = () => new Date(),
    file = path.join(os.tmpdir(), 'bulka-screen-cakes', 'aktau-bliny17-v1.json'),
  } = {}) {
    this.reporting = reporting;
    this.now = now;
    this.file = file;
    this.snapshot = null;
    this.pending = null;
    this.diskRead = null;
    this.lastAttempt = -Infinity;
    this.history = {};
  }

  valid(snapshot) {
    return (
      snapshot?.schemaVersion === 1 &&
      snapshot.unit === 'kg' &&
      snapshot.periods?.month?.from === `${localDay(this.now()).slice(0, 7)}-01` &&
      Number.isFinite(Date.parse(snapshot.generatedAt)) &&
      ['all', 'year', 'month'].every(
        (k) =>
          Number.isFinite(snapshot.periods?.[k]?.quantity) && snapshot.periods[k].quantity >= 0,
      )
    );
  }

  async getSnapshot() {
    this.diskRead ??= fs
      .readFile(this.file, 'utf8')
      .then((text) => {
        const cached = JSON.parse(text);
        if (this.valid(cached.snapshot) && !this.snapshot) this.snapshot = cached.snapshot;
        if (cached.history && typeof cached.history === 'object') this.history = cached.history;
      })
      .catch(() => {});
    await this.diskRead;
    const age = this.now().getTime() - Date.parse(this.snapshot?.generatedAt || '');
    if (
      (!this.valid(this.snapshot) || age >= REFRESH_MS) &&
      !this.pending &&
      this.now().getTime() - this.lastAttempt >= REFRESH_MS
    ) {
      void this.refresh().catch(() => {});
    }
    if (!this.valid(this.snapshot)) return { ready: false, updating: Boolean(this.pending) };
    return {
      ...this.snapshot,
      ready: true,
      updating: Boolean(this.pending),
      stale: age >= REFRESH_MS * 2,
    };
  }

  refresh() {
    if (this.pending) return this.pending;
    this.lastAttempt = this.now().getTime();
    this.pending = buildSnapshot(this.reporting, this.now(), this.history)
      .then(async (snapshot) => {
        this.snapshot = snapshot;
        try {
          await fs.mkdir(path.dirname(this.file), { recursive: true });
          const temporary = `${this.file}.${process.pid}.tmp`;
          await fs.writeFile(temporary, JSON.stringify({ snapshot, history: this.history }));
          await fs.rename(temporary, this.file);
        } catch (_) {
          logger.warn({ event: 'screen_cakes_cache_write_failed' });
        }
        return snapshot;
      })
      .catch((error) => {
        logger.warn({ event: 'screen_cakes_refresh_failed', message: error.message });
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}

module.exports = {
  PRODUCT_ID,
  aktauSources,
  buildSnapshot,
  ScreenCakesService,
  service: new ScreenCakesService(),
};
