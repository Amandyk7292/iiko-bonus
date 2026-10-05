const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-placeholder';
const { supabase } = require('../src/config/supabase');
const { cashierDirectoryStatus } = require('../src/services/cashier-directory-status.service');
const { getOperationsSummary } = require('../src/services/operations-dashboard.service');

test('operations notification flags stale or failed directory without breaking orders or leaking staff counts', async (t) => {
  const builder = {};
  for (const method of ['select', 'limit']) builder[method] = () => builder;
  t.mock.method(supabase, 'from', () => builder);
  const options = { includeOrders: false, includeSupport: false, includeInventory: false, includeWhatsApp: false };
  const mock = t.mock.method(cashierDirectoryStatus, 'getStatus', async () => ({ state: 'ok', cashierCount: 71 }));
  let summary = await getOperationsSummary(options);
  assert.equal(mock.mock.callCount(), 0);
  assert.equal(summary.counts.cashierSyncIssues, 0);
  for (const state of ['ok', 'error', 'stale', 'never']) {
    mock.mock.mockImplementation(async () => ({ state, cashierCount: 71 }));
    summary = await getOperationsSummary({ ...options, includeCashierDirectory: true });
    assert.equal(summary.capabilities.cashierDirectory, true);
    assert.equal(summary.counts.cashierSyncIssues, state === 'ok' ? 0 : 1);
    assert.equal(JSON.stringify(summary).includes('cashierCount'), false);
  }
  mock.mock.mockImplementation(async () => { throw new Error('source-private'); });
  summary = await getOperationsSummary({ ...options, includeCashierDirectory: true });
  assert.equal(summary.counts.cashierSyncIssues, 1);
  assert.equal(JSON.stringify(summary).includes('source-private'), false);
});
