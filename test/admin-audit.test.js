const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyAuditLogFilters,
  boundedContext,
  parseAuditLogQuery,
  setAdminAuditContext,
  writeAdminAudit,
} = require('../src/services/admin-audit.service');

test('admin audit stores bounded business context without request bodies', async () => {
  let inserted;
  const db = {
    from(table) {
      assert.equal(table, 'admin_audit_logs');
      return {
        async insert(record) {
          inserted = record;
          return { error: null };
        },
      };
    },
  };
  const req = {
    id: 'request-audit-1234',
    method: 'POST',
    path: '/customers/123/bonus',
    baseUrl: '/admin/api',
    route: { path: '/customers/:id/bonus' },
    params: { id: 'customer-123' },
    body: {
      amount: 125,
      reason: 'Корректировка после проверки',
      password: 'must-never-be-copied',
    },
    query: {},
    headers: { 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
    admin: { sub: 'admin', role: 'owner' },
  };
  setAdminAuditContext(req, {
    actionCode: 'customer.bonus.adjust',
    targetType: 'customer',
    targetId: 'customer-123',
    context: {
      changedFields: ['balance', 'note'],
      oversized: 'x'.repeat(1_000),
      nested: { secret: true },
    },
  });
  await writeAdminAudit(req, 200, { db });

  assert.equal(inserted.request_id, req.id);
  assert.equal(inserted.action_code, 'customer.bonus.adjust');
  assert.equal(inserted.target_type, 'customer');
  assert.equal(inserted.amount_change, 125);
  assert.equal(inserted.reason, req.body.reason);
  assert.deepEqual(inserted.context.changedFields, ['balance', 'note']);
  assert.equal(inserted.context.oversized.length, 500);
  assert.equal(inserted.context.nested, undefined);
  assert.equal(JSON.stringify(inserted).includes(req.body.password), false);
});

test('audit context normalizer accepts only bounded scalar values', () => {
  const context = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [`field ${index}`, index]),
  );
  const normalized = boundedContext(context);
  assert.equal(Object.keys(normalized).length, 20);
  assert.equal(Object.hasOwn(normalized, 'field0'), true);
});

test('audit pagination and filters are validated and applied before range', () => {
  const steps = [];
  const query = {
    eq(column, value) {
      steps.push(['eq', column, value]);
      return this;
    },
    or(value) {
      steps.push(['or', value]);
      return this;
    },
    range(from, to) {
      steps.push(['range', from, to]);
      return this;
    },
  };
  const filters = parseAuditLogQuery({
    page: '3',
    pageSize: '25',
    method: 'post',
    outcome: 'rejected',
    search: 'customer-123',
  });
  applyAuditLogFilters(query, filters).range(
    (filters.page - 1) * filters.pageSize,
    filters.page * filters.pageSize - 1,
  );
  assert.deepEqual(steps.slice(0, 2), [
    ['eq', 'action', 'POST'],
    ['eq', 'outcome', 'rejected'],
  ]);
  assert.match(steps[2][1], /request_id\.ilike.*admin_subject\.ilike.*target_id\.ilike/);
  assert.deepEqual(steps[3], ['range', 50, 74]);
  assert.throws(
    () => parseAuditLogQuery({ page: '-1', pageSize: '50' }),
    (error) => error.code === 'AUDIT_QUERY_INVALID',
  );
  assert.throws(
    () => parseAuditLogQuery({ search: 'unsafe,value' }),
    (error) => error.code === 'AUDIT_QUERY_INVALID',
  );
});
