const test = require('node:test');
const assert = require('node:assert/strict');
const { calendar, businessDate } = require('../src/services/branch-photo-reports.service');

test('calendar starts scoped branch and paginated report reads together before device counts', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const date = businessDate();
  const db = {
    from(table) {
      const query = { table, filters: [] };
      const builder = {};
      for (const method of ['select', 'order', 'in', 'gte', 'lte', 'range', 'eq']) {
        builder[method] = (...args) => {
          query.filters.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve, reject) => {
        calls.push(query);
        return Promise.resolve()
          .then(async () => {
            if (table === 'bulka_locations') {
              await gate;
              return {
                data: [
                  { id: 'active', name: 'Точка', city: 'Актау', active: true },
                  { id: 'historic', name: 'Архивная', city: 'Актау', active: false },
                  { id: 'unused', name: 'Без отчёта', city: 'Актау', active: false },
                ],
              };
            }
            if (table === 'branch_closing_reports') {
              const offset = query.filters.find(([method]) => method === 'range')[1];
              return {
                data:
                  offset === 0
                    ? Array.from({ length: 1000 }, (_, index) => ({
                        id: `report-${index}`,
                        branch_id: 'active',
                        business_date: date,
                        kind: 'hall',
                      }))
                    : [
                        {
                          id: 'last-report',
                          branch_id: 'historic',
                          business_date: date,
                          kind: 'baker',
                        },
                      ],
              };
            }
            assert.equal(table, 'branch_closing_devices');
            return { data: [{ branch_id: 'active' }] };
          })
          .then(resolve, reject);
      };
      return builder;
    },
  };
  const pending = calendar(
    { role: 'editor', branchIds: ['active', 'historic', 'unused'] },
    { end: date, days: 14 },
    { db },
  );
  await new Promise(setImmediate);
  assert.equal(calls[0].table, 'bulka_locations');
  assert.equal(calls.filter((query) => query.table === 'branch_closing_reports').length, 2);
  assert.equal(
    calls.some((query) => query.table === 'branch_closing_devices'),
    false,
  );
  release();
  const result = await pending;
  assert.equal(result.reports.length, 1001);
  assert.deepEqual(
    result.branches.map((branch) => [branch.id, branch.approvedDeviceCount]),
    [
      ['active', 1],
      ['historic', 0],
    ],
  );
  for (const query of calls) {
    assert(
      query.filters.some(
        ([method, field]) =>
          method === 'in' && field === (query.table === 'bulka_locations' ? 'id' : 'branch_id'),
      ),
    );
  }
});
