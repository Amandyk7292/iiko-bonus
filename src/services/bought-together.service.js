const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { service: reports } = require('./iiko-dashboard.service');
const { logger } = require('../config/logger');

const CACHE_MS = 6 * 60 * 60 * 1000;
const cacheFile = path.join(
  process.env.BOUGHT_TOGETHER_CACHE_DIR || path.join(os.tmpdir(), 'bulka-bought-together'),
  'snapshot-v2.json',
);
const day = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(date);
const shiftDay = (date, offset) =>
  new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);

function selectSources(servers) {
  const eligible = servers.filter((s) => s.active && s.configured);
  const chainCities = new Set(eligible.filter((s) => s.kind === 'chain').map((s) => s.city));
  return eligible.filter((s) => s.kind === 'chain' || !chainCities.has(s.city));
}

// Each pair gets one vote per receipt, independent of quantities and split lines.
function countPairs(rows, counts = new Map(), popularity = new Map()) {
  const baskets = new Map();
  for (const row of rows) {
    const receipt = String(row['UniqOrderId.Id'] || '');
    const product = String(row.DishId || '')
      .trim()
      .toLowerCase();
    const quantity = Number(row.DishAmountInt);
    if (!receipt || !product || !Number.isFinite(quantity)) continue;
    const basket = baskets.get(receipt) || new Map();
    basket.set(product, (basket.get(product) || 0) + quantity);
    baskets.set(receipt, basket);
  }
  for (const basket of baskets.values()) {
    const ids = [...basket].filter(([, quantity]) => quantity > 0).map(([id]) => id);
    for (const id of ids) {
      popularity.set(id, (popularity.get(id) || 0) + 1);
      const neighbors = counts.get(id) || new Map();
      for (const other of ids) {
        if (other !== id) neighbors.set(other, (neighbors.get(other) || 0) + 1);
      }
      counts.set(id, neighbors);
    }
  }
  return counts;
}

function rankPopularity(popularity) {
  return [...popularity]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([productId]) => productId);
}

function rankPairs(counts, popularProducts = []) {
  return Object.fromEntries(
    [...counts].map(([id, neighbors]) => {
      const paired = [...neighbors]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([productId]) => productId);
      const ranked = [...new Set([...paired, ...popularProducts])]
        .filter((productId) => productId !== id)
        .slice(0, 40);
      return [id, ranked];
    }),
  );
}

async function collectRange(service, serverId, from, to, counts, popularity) {
  try {
    const report = await service.report({
      serverId,
      reportType: 'SALES',
      from,
      to,
      groupBy: ['UniqOrderId.Id', 'DishId'],
      aggregate: ['DishAmountInt'],
      filters: [
        { field: 'OrderDeleted', values: ['NOT_DELETED'] },
        { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
        { field: 'Storned', values: ['FALSE'] },
      ],
    });
    countPairs(report.rows, counts, popularity);
  } catch (error) {
    if (error.message !== 'IIKO_REPORT_TOO_LARGE' || from === to) throw error;
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    const middle = shiftDay(from, Math.floor(span / 2));
    await collectRange(service, serverId, from, middle, counts, popularity);
    await collectRange(service, serverId, shiftDay(middle, 1), to, counts, popularity);
  }
}

async function buildSnapshot(service = reports, now = new Date()) {
  const to = day(now);
  const from = shiftDay(to, -29);
  const sources = selectSources(await service.listServers());
  if (!sources.length) throw new Error('No configured sales report sources');
  const counts = new Map();
  const popularity = new Map();
  // Chain already contains its RMS receipts; never sum both.
  for (const source of sources) {
    // Daily reports keep the Chain response below its row/body limits.
    for (let date = from; date <= to; date = shiftDay(date, 1)) {
      await collectRange(service, source.id, date, date, counts, popularity);
    }
  }
  return {
    schemaVersion: 2,
    from,
    to,
    generatedAt: now.toISOString(),
    sources: sources.map((s) => s.id),
    popularProducts: rankPopularity(popularity),
    products: rankPairs(counts, rankPopularity(popularity)),
  };
}

let snapshot = null;
let pending = null;
let lastAttempt = 0;
let diskRead = null;
function valid(value, now = new Date()) {
  return (
    value?.schemaVersion === 2 &&
    value.to === day(now) &&
    value.from === shiftDay(day(now), -29) &&
    value.products &&
    Date.parse(value.generatedAt) > now.getTime() - 2 * CACHE_MS
  );
}
async function loadDisk() {
  if (!diskRead)
    diskRead = fs
      .readFile(cacheFile, 'utf8')
      .then((text) => {
        const value = JSON.parse(text);
        if (valid(value)) snapshot = value;
      })
      .catch(() => {});
  return diskRead;
}
async function refresh() {
  if (pending) return pending;
  lastAttempt = Date.now();
  pending = (async () => {
    const next = await buildSnapshot();
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    const temp = cacheFile + '.' + process.pid + '.tmp';
    await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temp, cacheFile);
    snapshot = next;
    return next;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
async function recommendations(productId) {
  await loadDisk();
  if (
    (!valid(snapshot) || Date.parse(snapshot.generatedAt) < Date.now() - CACHE_MS) &&
    !pending &&
    Date.now() - lastAttempt > 60000
  ) {
    void refresh().catch((error) =>
      logger.warn({ event: 'bought_together_refresh_failed', message: error.message }),
    );
  }
  if (!valid(snapshot)) return { productIds: [], days: 30, ready: false };
  const key = String(productId).trim().toLowerCase();
  const ids = Object.hasOwn(snapshot.products, key) ? snapshot.products[key] : [];
  return { productIds: ids, days: 30, ready: true };
}

module.exports = {
  recommendations,
  refresh,
  buildSnapshot,
  countPairs,
  rankPairs,
  rankPopularity,
  selectSources,
  shiftDay,
};
