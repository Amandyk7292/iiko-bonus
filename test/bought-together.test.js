const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countPairs,
  rankPairs,
  rankPopularity,
  selectSources,
  buildSnapshot,
  selectRecommendations,
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
  assert.deepEqual(snapshot.scopes.chain.products.bun, ['coffee']);
});
test('all unavailable sources without a cached result reject the snapshot', async () => {
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

test('scopes recommendations to the selected branch and preserves profile IDs', () => {
  const value = {
    scopes: {
      chain: {
        city: 'astana',
        departments: {
          a: { products: { bun: ['coffee'] }, popularProducts: ['bun', 'coffee'] },
          b: { products: { bun: ['tea'] }, popularProducts: ['bun', 'tea'] },
        },
      },
    },
  };
  const bindings = {
    first: { serverId: 'chain', departmentId: 'a' },
    second: { serverId: 'chain', departmentId: 'b' },
  };
  assert.deepEqual(selectRecommendations(value, 'astana:bun', 'first', bindings).productIds, [
    'astana:coffee',
  ]);
  assert.deepEqual(selectRecommendations(value, 'astana:bun', 'second', bindings).productIds, [
    'astana:tea',
  ]);
  assert.deepEqual(selectRecommendations(value, 'astana:new', 'first', bindings).productIds, [
    'astana:bun',
    'astana:coffee',
  ]);
  assert.deepEqual(selectRecommendations(value, 'bun', 'first', bindings).productIds, []);
  assert.deepEqual(selectRecommendations(value, 'astana:bun', 'unknown', bindings).productIds, []);
});
const { needsRefresh, usableScope } = require('../src/services/bought-together.service');
const sources = ['aktau','astana'].map(city => ({id: city+'-chain',city,host:city+'.iiko.it',kind:'chain',active:true,configured:true}));
const now = new Date('2026-09-15T05:00:00Z');
const reporting = { listServers: async()=>sources, report: async()=>({rows:[row('one','bun'),row('one','coffee')]}) };
test('one failed city does not discard complete recommendations from another city', async()=>{
  const value = await buildSnapshot({...reporting,report:async q=>{if(q.serverId==='astana-chain') throw Error('timeout');return reporting.report(q);}},now);
  assert.deepEqual(value.scopes['aktau-chain'].products.bun,['coffee']);
  assert.equal(value.scopes['astana-chain'],undefined);
  assert.deepEqual(value.failedSources,['astana-chain']);
  assert.equal(needsRefresh(value,now),true);
  assert.equal(selectRecommendations(value,'astana:bun').ready,false);
});
test('a healthy city is published while another source is still waiting',async()=>{
  let unblock;
  const gate=new Promise(resolve=>{unblock=resolve});
  let published;
  const seen=new Promise(resolve=>{published=resolve});
  const pending=buildSnapshot({...reporting,report:async q=>{if(q.serverId==='astana-chain')await gate;return reporting.report(q);}},now,null,value=>{if(value.scopes['aktau-chain'])published(value);});
  const partial=await seen;
  assert.ok(partial.scopes['aktau-chain']);
  assert.equal(partial.scopes['astana-chain'],undefined);
  unblock();
  assert.ok((await pending).scopes['astana-chain']);
});
test('fresh cities are not queried again while a failed city retries',async()=>{
  const previous=await buildSnapshot(reporting,now);
  const calls=[];
  const value=await buildSnapshot({...reporting,report:async q=>{calls.push(q.serverId);return reporting.report(q);}},now,previous);
  assert.deepEqual(calls,[]);
  assert.equal(needsRefresh(value,now),false);
  const nextDay=new Date('2026-09-16T00:00:00Z');
  const failed=await buildSnapshot({...reporting,report:async q=>{if(q.serverId==='astana-chain')throw Error('offline');return reporting.report(q);}},nextDay,value);
  assert.equal(failed.scopes['aktau-chain'].to,'2026-09-16');
  assert.equal(failed.scopes['astana-chain'].to,'2026-09-15');
  assert.equal(failed.scopes['astana-chain'].generatedAt,now.toISOString());
  assert.equal(usableScope(failed.scopes['astana-chain'],new Date('2026-09-17T00:00:00Z')),false);
});
test('changed host never reuses recommendations from the old source',async()=>{
  const previous=await buildSnapshot(reporting,now);
  const next=await buildSnapshot({...reporting,listServers:async()=>sources.map(s=>s.city==='astana'?{...s,host:'new.iiko.it'}:s),report:async()=>{throw Error('offline');}},now,previous);
  assert.ok(next.scopes['aktau-chain']);
  assert.equal(next.scopes['astana-chain'],undefined);
});
