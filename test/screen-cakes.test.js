const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PRODUCT_ID, aktauSources, buildSnapshot, ScreenCakesService } = require('../src/services/screen-cakes.service');
const chain = { id: 'aktau-chain', city: 'aktau', kind: 'chain', active: true, configured: true };
function reporting(amount = 1234.567) {
  return { listServers: async () => [chain], report: async () => ({ rows: [{ DishId: PRODUCT_ID, DishMeasureUnit: 'кг', DishAmountInt: amount }] }) };
}
test('Aktau chain is counted once; other cities and inactive sources are excluded', () => {
  const rms = { ...chain, id: 'rms', kind: 'rms' };
  assert.deepEqual(aktauSources([rms, chain, { ...chain, city: 'astana' }]), [chain]);
  assert.deepEqual(aktauSources([rms, { ...chain, active: false }]), [rms]);
});
test('exact pancake ID, kilograms, deletion filters and Kazakhstan period boundaries', async () => {
  const calls = [];
  const api = reporting();
  const report = api.report;
  api.report = async query => { calls.push(query); return query.from.startsWith('2027') ? report() : { rows: [] }; };
  const result = await buildSnapshot(api, new Date('2026-12-31T20:00:00Z'));
  assert.equal(calls.length, 29);
  assert.ok(calls.some(x => x.from === '2000-01-01' && x.to === '2000-12-31'));
  assert.equal(calls.filter(x => x.from === '2027-01-01' && x.to === '2027-01-01').length, 2);
  for (const call of calls) {
    assert.deepEqual(call.filters[0], { field: 'DishId', values: [PRODUCT_ID] });
    assert.equal(call.filters.length, 4);
    assert.equal(call.serverId, chain.id);
  }
  assert.equal(result.unit, 'kg');
  assert.equal(result.periods.all.quantity, 1234.567);
});
test('unexpected unit fails instead of presenting kilograms as pieces', async () => {
  const api = reporting();
  api.report = async () => ({ rows: [{ DishId: PRODUCT_ID, DishMeasureUnit: 'шт', DishAmountInt: 3 }] });
  await assert.rejects(buildSnapshot(api), /unit changed/);
});
test('different pancake products are excluded even if the upstream filter fails', async () => {
  const api = reporting();
  api.report = async () => ({ rows: [{ DishId: 'different-id', DishMeasureUnit: 'кг', DishAmountInt: 999 }] });
  assert.equal((await buildSnapshot(api)).periods.all.quantity, 0);
});
test('single-flight refresh, restart cache, failure retention and month rollover', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-cakes-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'snapshot.json');
  let date = new Date('2026-09-14T08:00:00Z');
  const api = reporting();
  const service = new ScreenCakesService({ reporting: api, now: () => date, file });
  const first = service.refresh();
  assert.equal(service.refresh(), first);
  await first;
  const restarted = new ScreenCakesService({ reporting: api, now: () => date, file });
  assert.equal((await restarted.getSnapshot()).periods.month.quantity, 1234.567);
  date = new Date('2026-09-14T08:03:00Z');
  api.report = async () => { throw new Error('offline'); };
  const stale = await service.getSnapshot();
  assert.equal(stale.ready, true);
  assert.equal(stale.stale, true);
  await assert.rejects(service.pending, /offline/);
  assert.equal((await service.getSnapshot()).periods.month.quantity, 1234.567);
  date = new Date('2026-10-01T00:00:00Z');
  assert.equal((await service.getSnapshot()).ready, false);
  await assert.rejects(service.pending, /offline/);
});
