const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { service: reports } = require('./iiko-dashboard.service');
const { logger } = require('../config/logger');

const CACHE_MS = 6 * 60 * 60 * 1000;
const cacheFile = path.join(
  process.env.BOUGHT_TOGETHER_CACHE_DIR || path.join(os.tmpdir(), 'bulka-bought-together'),
  'snapshot-v3.json',
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

async function collectRange(service, serverId, from, to, counts, popularity, departments) {
  try {
    const report = await service.report({
      serverId,
      reportType: 'SALES',
      from,
      to,
      groupBy: ['UniqOrderId.Id', 'DishId', 'Department.Id'],
      aggregate: ['DishAmountInt'],
      filters: [
        { field: 'OrderDeleted', values: ['NOT_DELETED'] },
        { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
        { field: 'Storned', values: ['FALSE'] },
      ],
    });
    countPairs(report.rows, counts, popularity);
    for (const departmentId of new Set(
      report.rows.map((row) => row['Department.Id']).filter(Boolean),
    )) {
      const bucket = departments.get(departmentId) || { counts: new Map(), popularity: new Map() };
      countPairs(
        report.rows.filter((row) => row['Department.Id'] === departmentId),
        bucket.counts,
        bucket.popularity,
      );
      departments.set(departmentId, bucket);
    }
  } catch (error) {
    if (error.message !== 'IIKO_REPORT_TOO_LARGE' || from === to) throw error;
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    const middle = shiftDay(from, Math.floor(span / 2));
    await collectRange(service, serverId, from, middle, counts, popularity, departments);
    await collectRange(service, serverId, shiftDay(middle, 1), to, counts, popularity, departments);
  }
}

async function buildSnapshot(service = reports, now = new Date()) {
  const to = day(now);
  const from = shiftDay(to, -29);
  const sources = selectSources(await service.listServers());
  if (!sources.length) throw new Error('No configured sales report sources');
  const scopes = {};
  // Chain already contains its RMS receipts; never sum both.
  for (const source of sources) {
    const counts = new Map();
    const popularity = new Map();
    const departments = new Map();
    // Daily reports keep the Chain response below its row/body limits.
    for (let date = from; date <= to; date = shiftDay(date, 1)) {
      await collectRange(service, source.id, date, date, counts, popularity, departments);
    }
    scopes[source.id] = {
      city: source.city,
      popularProducts: rankPopularity(popularity),
      products: rankPairs(counts, rankPopularity(popularity)),
      departments: Object.fromEntries(
        [...departments].map(([id, bucket]) => [
          id,
          {
            popularProducts: rankPopularity(bucket.popularity),
            products: rankPairs(bucket.counts, rankPopularity(bucket.popularity)),
          },
        ]),
      ),
    };
  }
  return {
    schemaVersion: 3,
    from,
    to,
    generatedAt: now.toISOString(),
    sources: sources.map((s) => s.id),
    scopes,
  };
}

let snapshot = null;
let pending = null;
let lastAttempt = 0;
let diskRead = null;
function valid(value, now = new Date()) {
  return (
    value?.schemaVersion === 3 &&
    value.to === day(now) &&
    value.from === shiftDay(day(now), -29) &&
    value.scopes &&
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
async function recommendations(productId, branchId) {
  let mappings = {};
  try {
    mappings = JSON.parse(process.env.BOUGHT_TOGETHER_BRANCHES_JSON || '{}');
  } catch (_) {
    /* Unmapped branches use their own online receipts. */
  }
  if (branchId && !mappings[branchId])
    return require('./bought-together-online.service').recommendations(productId, branchId);
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
  return selectRecommendations(snapshot, productId, branchId, mappings);
}

function selectRecommendations(value, productId, branchId, mappings = {}) {
  const raw = String(productId).trim().toLowerCase();
  const separator = raw.indexOf(':');
  const prefix = separator < 0 ? '' : raw.slice(0, separator + 1);
  const key = separator < 0 ? raw : raw.slice(separator + 1);
  const city = prefix === 'astana:' ? 'astana' : 'aktau';
  const binding = mappings[branchId];
  let buckets;
  if (branchId) {
    const source = binding && value.scopes[binding.serverId];
    const bucket = source?.city === city && source.departments?.[binding.departmentId];
    if (!bucket) return { productIds: [], days: 30, ready: true };
    buckets = [bucket];
  } else {
    buckets = Object.values(value.scopes).filter((scope) => scope.city === city);
  }
  const ids = [
    ...new Set(buckets.flatMap((bucket) => bucket.products[key] || bucket.popularProducts || [])),
  ]
    .filter((id) => id !== key)
    .slice(0, 40)
    .map((id) => prefix + id);
  return { productIds: ids, days: 30, ready: true };
}

module.exports = {
  recommendations,
  selectRecommendations,
  refresh,
  buildSnapshot,
  countPairs,
  rankPairs,
  rankPopularity,
  selectSources,
  shiftDay,
};
