const assert = require('node:assert/strict');
const test = require('node:test');
const { collectBindingDirectory } = require('../scripts/list-iiko-outgoing-bindings');

const db = (rows) => ({
  from(table) {
    assert.equal(table, 'bulka_locations');
    return {
      select(fields) {
        assert.equal(fields, 'id,name,address,city,active');
        return {
          eq(column, value) {
            assert.equal(column, 'active');
            assert.equal(value, true);
            return { abortSignal: async () => ({ data: rows }) };
          },
        };
      },
    };
  },
});

test('binding directory exports only bakery metadata, reads both cities and never writes or guesses mappings', async () => {
  const calls = [];
  const result = await collectBindingDirectory({
    db: db([
      {
        id: 'branch',
        name: 'Bakery',
        city: 'Astana',
        address: 'Building 1',
        phone: 'secret-phone',
      },
    ]),
    client: {
      listServers: async () =>
        ['aktau', 'astana'].flatMap((city) =>
          ['chain', 'rms'].map((kind) => ({
            id: `${city}-${kind}`,
            city,
            kind,
            active: true,
            configured: true,
            password: 'secret-password',
          })),
        ),
      withSession: async (serverId, work) =>
        work(async (...args) => {
          calls.push([serverId, ...args]);
          return {
            corporateItemDtoes: {
              corporateItemDto: {
                id: serverId,
                name: 'Department',
                address: 'Building 1',
                taxId: 'secret-tax-id',
              },
            },
          };
        }),
    },
  });
  assert.deepEqual(result.branches, [
    { id: 'branch', name: 'Bakery', city: 'Astana', address: 'Building 1' },
  ]);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    calls,
    ['aktau', 'astana'].map((city) => [
      `${city}-chain`,
      'corporation/departments',
      undefined,
      'xml',
    ]),
  );
  assert.doesNotMatch(JSON.stringify(result), /secret|password|taxId|phone|mapping/);
});

test('binding directory keeps safe partial results when one city cannot be read', async () => {
  const result = await collectBindingDirectory({
    db: db([]),
    client: {
      listServers: async () =>
        ['aktau', 'astana'].map((city) => ({
          id: city,
          city,
          kind: 'chain',
          active: true,
          configured: true,
        })),
      withSession: async (serverId, work) => {
        if (serverId === 'aktau')
          throw Object.assign(new Error('https://host/?key=secret-token'), {
            code: 'IIKO_REPORT_TIMEOUT',
          });
        return work(async () => ({ corporateItemDtoes: '' }));
      },
    },
  });
  assert.deepEqual(result.errors, [
    { city: 'aktau', serverId: 'aktau', code: 'IIKO_REPORT_TIMEOUT' },
  ]);
  assert.equal(result.sources.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|https:/);
});
