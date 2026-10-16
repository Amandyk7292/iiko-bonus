const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoundsService } = require('../src/services/rounds.service');

const branchId = '10000000-0000-4000-8000-000000000001';
const branch = { id: branchId, name: 'Точка', city: 'Актау', active: true };
const period = { from: '2026-10-16', to: '2026-10-16', city: 'Актау' };
const owner = { role: 'owner', selectedBranchId: branchId };

function dashboardFixture(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: 'Осмотр',
    round_date: period.from,
    deadline: '2026-10-16T18:00:00+05:00',
    branch_id: branchId,
    inspector_id: '30000000-0000-4000-8000-000000000001',
    branch,
    inspector: { name: 'Алия' },
    tasks: [{ id: 'task', completed_at: null }],
  }));
  const pages = [];
  const db = {
    from(table) {
      const calls = [];
      const query = {
        then(resolve, reject) {
          let data;
          if (table === 'bulka_locations') data = [branch];
          else if (table === 'inspection_inspectors') data = [];
          else {
            assert.equal(table, 'inspection_rounds');
            pages.push(calls);
            const range = calls.find(([method]) => method === 'range');
            const offset = range?.[1] || 0;
            const requested = range ? range[2] - offset + 1 : 1000;
            // Production PostgREST truncates every response at 1,000 rows,
            // even when a larger .limit() was requested by the client.
            data = rows.slice(offset, offset + Math.min(requested, 1000));
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      for (const method of ['select', 'in', 'eq', 'gte', 'lte', 'order', 'range', 'limit'])
        query[method] = (...args) => {
          calls.push([method, ...args]);
          return query;
        };
      return query;
    },
  };
  return { service: createRoundsService({ db }), rows, pages };
}

function assertPageQueries(pages, expectedOffsets) {
  assert.deepEqual(
    pages.map((calls) => calls.find(([method]) => method === 'range')?.slice(1)),
    expectedOffsets.map((offset) => [offset, offset + 499]),
  );
  for (const calls of pages) {
    assert.deepEqual(
      calls.filter(([method]) => method === 'order'),
      [
        ['order', 'round_date', { ascending: false }],
        ['order', 'deadline'],
        ['order', 'id'],
      ],
    );
    assert.ok(
      calls.some(
        (call) => JSON.stringify(call) === JSON.stringify(['in', 'branch_id', [branchId]]),
      ),
    );
    assert.ok(
      calls.some(
        (call) => JSON.stringify(call) === JSON.stringify(['gte', 'round_date', period.from]),
      ),
    );
    assert.ok(
      calls.some(
        (call) => JSON.stringify(call) === JSON.stringify(['lte', 'round_date', period.to]),
      ),
    );
  }
}

test('dashboard returns all 1,001 rounds across the PostgREST row cap', async () => {
  const { service, rows, pages } = dashboardFixture(1001);
  const result = await service.dashboard(owner, period);
  assert.equal(result.rounds.length, 1001);
  assert.deepEqual(
    result.rounds.map((round) => round.id),
    rows.map((round) => round.id),
  );
  assertPageQueries(pages, [0, 500, 1000]);
});

test('dashboard permits exactly 2,000 rounds and probes the next bounded page', async () => {
  const { service, pages } = dashboardFixture(2000);
  const result = await service.dashboard(owner, period);
  assert.equal(result.rounds.length, 2000);
  assert.equal(new Set(result.rounds.map((round) => round.id)).size, 2000);
  assertPageQueries(pages, [0, 500, 1000, 1500, 2000]);
});

test('dashboard rejects 2,001 rounds rather than silently showing an incomplete calendar', async () => {
  const { service, pages } = dashboardFixture(2001);
  await assert.rejects(service.dashboard(owner, period), {
    statusCode: 400,
    code: 'ROUNDS_RANGE_LIMIT',
  });
  assertPageQueries(pages, [0, 500, 1000, 1500, 2000]);
});
