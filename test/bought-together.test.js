const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countPairs,
  rankPairs,
  rankPopularity,
  selectSources,
  buildSnapshot,
} = require('../src/services/bought-together.service');
const row = (receipt, product, quantity = 1) => ({
  'UniqOrderId.Id': receipt,
  DishId: product,
  DishAmountInt: quantity,
});

test('co-purchases count distinct receipts, not quantities or duplicate lines', () => {
  const counts = countPairs([
    row('r1', 'bun', 9),
    row('r1', 'coffee'),
    row('r1', 'coffee', 2),
    row('r2', 'bun'),
    row('r2', 'coffee'),
    row('r3', 'bun'),
    row('r3', 'milk'),
    row('r4', 'other'),
    row('r4', 'milk'),
  ]);
  assert.equal(counts.get('bun').get('coffee'), 2);
  assert.equal(counts.get('bun').has('bun'), false);
  assert.deepEqual(rankPairs(counts).bun, ['coffee']);
});
test('returns, zero net quantity and missing identifiers do not create recommendations', () => {
  const counts = countPairs([
    row('r1', 'bun'),
    row('r1', 'coffee', 1),
    row('r1', 'coffee', -1),
    row('r2', 'bun'),
    row('r2', 'coffee', -1),
    row('', 'coffee'),
    row('r2', ''),
  ]);
  assert.deepEqual(rankPairs(counts).bun, []);
});
test('ranks by receipt frequency and deterministic product ID on ties', () => {
  const counts = countPairs([
    row('r1', 'bun'),
    row('r1', 'b'),
    row('r1', 'a'),
    row('r2', 'bun'),
    row('r2', 'b'),
    row('r2', 'a'),
    row('r3', 'bun'),
    row('r3', 'b'),
  ]);
  assert.deepEqual(rankPairs(counts).bun, ['b', 'a']);
});
test('uses branch-filtered client availability with a deterministic popularity fallback', () => {
  const popularity = new Map([
    ['coffee', 5],
    ['bun', 4],
    ['tea', 3],
  ]);
  const counts = new Map([['bun', new Map([['coffee', 1]])]]);
  assert.deepEqual(rankPopularity(popularity), ['coffee', 'bun', 'tea']);
  assert.deepEqual(rankPairs(counts, rankPopularity(popularity)).bun, ['coffee', 'tea']);
});
test('Chain and its RMS sources are never double counted', () => {
  const sources = selectSources([
    { id: 'chain', city: 'a', kind: 'chain', active: true, configured: true },
    { id: 'rms-a', city: 'a', kind: 'rms', active: true, configured: true },
    { id: 'rms-b', city: 'b', kind: 'rms', active: true, configured: true },
    { id: 'closed', city: 'b', kind: 'rms', active: false, configured: true },
  ]);
  assert.deepEqual(
    sources.map((s) => s.id),
    ['chain', 'rms-b'],
  );
});
test('snapshot covers exactly the latest 30 Kazakhstan calendar dates and filters deleted/returned sales', async () => {
  const queries = [];
  const snapshot = await buildSnapshot(
    {
      listServers: async () => [
        { id: 'chain', city: 'a', kind: 'chain', active: true, configured: true },
      ],
      report: async (input) => {
        queries.push(input);
        return { rows: [row('receipt', 'bun'), row('receipt', 'coffee')] };
      },
    },
    new Date('2026-09-12T20:00:00Z'),
  );
  assert.equal(queries.length, 30);
  assert.equal(queries[0].from, '2026-08-15');
  assert.equal(queries[29].to, '2026-09-13');
  assert(queries.every((q) => q.from === q.to));
  assert.deepEqual(queries[0].filters, [
    { field: 'OrderDeleted', values: ['NOT_DELETED'] },
    { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
    { field: 'Storned', values: ['FALSE'] },
  ]);
  assert.deepEqual(snapshot.products.bun, ['coffee']);
});
test('a failed reporting source rejects the snapshot instead of publishing partial rankings', async () => {
  await assert.rejects(
    buildSnapshot({
      listServers: async () => [
        { id: 'chain', city: 'a', kind: 'chain', active: true, configured: true },
      ],
      report: async () => {
        throw Error('unavailable');
      },
    }),
    /unavailable/,
  );
});
