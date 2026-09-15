const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { service: reports } = require('./iiko-dashboard.service');
const { logger } = require('../config/logger');
const { branchBindings } = require('../config/bought-together-branches');

const CACHE_MS = 6 * 60 * 60 * 1000;
const cacheFile = path.join(
  process.env.BOUGHT_TOGETHER_CACHE_DIR || path.join(os.tmpdir(), 'bulka-bought-together'),
  'snapshot-v4.json',
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

function usableScope(scope, now = new Date()) {
  return Boolean(
    scope &&
    scope.products &&
    scope.departments &&
    Number.isFinite(Date.parse(scope.generatedAt)) &&
    Date.parse(scope.generatedAt) > now.getTime() - 24 * 60 * 60 * 1000,
  );
}
function freshScope(scope, now = new Date()) {
  return (
    usableScope(scope, now) &&
    scope.to === day(now) &&
    scope.from === shiftDay(day(now), -29) &&
    Date.parse(scope.generatedAt) > now.getTime() - CACHE_MS
  );
}

async function buildSnapshot(
  service = reports,
  now = new Date(),
  previous = null,
  onProgress = () => {},
) {
  const to = day(now);
  const from = shiftDay(to, -29);
  const sources = selectSources(await service.listServers());
  if (!sources.length) throw new Error('No configured sales report sources');
  const scopes = {};
  const failedSources = [];
  let firstError;
  for (const source of sources) {
    const old = previous?.scopes?.[source.id];
    if (usableScope(old, now) && old.city === source.city && old.host === (source.host || ''))
      scopes[source.id] = old;
  }
  const result = () => ({
    schemaVersion: 4,
    from,
    to,
    generatedAt: now.toISOString(),
    sources: sources.map((s) => s.id),
    failedSources: [...failedSources],
    scopes: { ...scopes },
  });
  // Sources run independently; publish a complete city's result as soon as it is ready.
  await Promise.all(
    sources.map(async (source) => {
      if (freshScope(scopes[source.id], now)) return;
      try {
        const counts = new Map();
        const popularity = new Map();
        const departments = new Map();
        for (let date = from; date <= to; date = shiftDay(date, 1)) {
          await collectRange(service, source.id, date, date, counts, popularity, departments);
        }
        scopes[source.id] = {
          city: source.city,
          host: source.host || '',
          from,
          to,
          generatedAt: now.toISOString(),
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
      } catch (error) {
        firstError ||= error;
        failedSources.push(source.id);
        logger.warn({
          event: 'bought_together_source_failed',
          serverId: source.id,
          message: error.message,
        });
      }
      onProgress(result());
    }),
  );
  if (!Object.keys(scopes).length)
    throw firstError || new Error('No available sales report sources');
  return result();
}

let snapshot = null;
let pending = null;
let lastAttempt = 0;
let diskRead = null;
function valid(value, now = new Date()) {
  return (
    value?.schemaVersion === 4 &&
    value.scopes &&
    Object.values(value.scopes).some((scope) => usableScope(scope, now))
  );
}
function needsRefresh(value, now = new Date()) {
  return !valid(value, now) || value.sources.some((id) => !freshScope(value.scopes[id], now));
}
let writeQueue = Promise.resolve();
function saveDisk(value) {
  const text = JSON.stringify(value);
  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      const temp = cacheFile + '.' + process.pid + '.tmp';
      await fs.writeFile(temp, text, { mode: 0o600 });
      await fs.rename(temp, cacheFile);
    })
    .catch((error) =>
      logger.warn({ event: 'bought_together_cache_write_failed', message: error.message }),
    );
  return writeQueue;
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
    const next = await buildSnapshot(reports, new Date(), snapshot, (partial) => {
      snapshot = partial;
      void saveDisk(partial);
    });
    snapshot = next;
    await saveDisk(next);
    return next;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
async function recommendations(productId, branchId) {
  const mappings = branchBindings();
  if (branchId && !mappings[branchId])
    return require('./bought-together-online.service').recommendations(productId, branchId);
  await loadDisk();
  if (needsRefresh(snapshot) && !pending && Date.now() - lastAttempt > 60000) {
    void refresh().catch((error) =>
      logger.warn({ event: 'bought_together_refresh_failed', message: error.message }),
    );
  }
  if (!valid(snapshot)) return { productIds: [], days: 30, ready: false };
  const available = {
    ...snapshot,
    scopes: Object.fromEntries(
      Object.entries(snapshot.scopes).filter(([, scope]) => usableScope(scope)),
    ),
  };
  const result = selectRecommendations(available, productId, branchId, mappings);
  if (!result.ready) return result;
  if (branchId && result.productIds.length === 0)
    return require('./bought-together-online.service').recommendations(productId, branchId);
  return result;
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
    if (binding && !source) return { productIds: [], days: 30, ready: false };
    const bucket = source?.city === city && source.departments?.[binding.departmentId];
    if (!bucket) return { productIds: [], days: 30, ready: true };
    buckets = [bucket];
  } else {
    buckets = Object.values(value.scopes).filter((scope) => scope.city === city);
    if (!buckets.length) return { productIds: [], days: 30, ready: false };
  }
  const ids = [
    ...new Set(buckets.flatMap((bucket) => bucket.products[key] || bucket.popularProducts || [])),
  ]
    .filter((id) => id !== key)
    .slice(0, 40)
    .map((id) => prefix + id);
  const sourceScopes = branchId ? [value.scopes[binding.serverId]] : buckets;
  const dated = sourceScopes.filter((scope) => scope?.generatedAt);
  return {
    productIds: ids,
    days: 30,
    ready: true,
    ...(dated.length
      ? {
          stale: dated.some((scope) => !freshScope(scope)),
          generatedAt: dated.map((scope) => scope.generatedAt).sort()[0],
        }
      : {}),
  };
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
  usableScope,
  freshScope,
  needsRefresh,
};
