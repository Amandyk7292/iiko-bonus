const test = require('node:test');
const assert = require('node:assert/strict');
const { IikoDashboardClient } = require('../src/services/iiko-dashboard-client');
const server = { host: 'fixture.iiko.it' };
test('production import sends raw UTF-8 XML while existing reports remain JSON', async () => {
  const calls = [];
  const client = new IikoDashboardClient({
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return {
        ok: true,
        text: async () =>
          options.headers['Content-Type'] === 'application/json'
            ? '{"rows":[]}'
            : '<documentValidationResult><valid>true</valid></documentValidationResult>',
      };
    },
  });
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><document><comment>Bulka · Жасыл дала</comment></document>';
  const result = await client.request(
    server,
    'documents/import/productionDocument',
    'test-key',
    xml,
    undefined,
    'xml',
    'xml',
  );
  assert.equal(result.documentValidationResult.valid, 'true');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, xml);
  assert.equal(calls[0].options.headers['Content-Type'], 'application/xml; charset=utf-8');
  await client.request(server, 'v2/reports/olap', 'test-key', { reportType: 'SALES' });
  assert.equal(calls[1].options.body, '{"reportType":"SALES"}');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
});
test('raw XML transport refuses unsupported paths and oversized bodies before fetching', async () => {
  let fetched = false;
  const client = new IikoDashboardClient({
    fetchImpl: async () => {
      fetched = true;
    },
  });
  await assert.rejects(
    () =>
      client.request(server, 'documents/delete', 'test', '<document/>', undefined, 'xml', 'xml'),
    { code: 'IIKO_REPORT_QUERY' },
  );
  await assert.rejects(
    () =>
      client.request(
        server,
        'documents/import/productionDocument',
        'test',
        'x'.repeat(2 * 1024 * 1024 + 1),
        undefined,
        'xml',
        'xml',
      ),
    { code: 'IIKO_REPORT_QUERY' },
  );
  assert.equal(fetched, false);
});
