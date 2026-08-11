const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { kitchenStatusBodySchema } = require('../src/contracts/backend-safety.contract');

test('preparing contract requires an explicit boolean iikoFront confirmation', () => {
  for (const body of [
    { status: 'preparing' },
    { status: 'preparing', iikoManualEntryConfirmed: false },
    { status: 'preparing', iikoManualEntryConfirmed: 'true' },
  ]) {
    const result = kitchenStatusBodySchema.safeParse(body);
    assert.equal(result.success, false);
    assert.ok(
      result.error.issues.some((issue) => issue.path.join('.') === 'iikoManualEntryConfirmed'),
    );
  }

  assert.equal(
    kitchenStatusBodySchema.safeParse({
      status: 'preparing',
      preparationMinutes: 20,
      iikoManualEntryConfirmed: true,
    }).success,
    true,
  );
  assert.equal(kitchenStatusBodySchema.safeParse({ status: 'ready' }).success, true);
});

test('kitchen route forwards iiko confirmation and records explicit audit context', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'routes', 'admin.routes.js'),
    'utf8',
  );
  const routeStart = source.search(/router\.patch\(\s*'\/admin\/api\/kitchen\/:id\/status'/);
  assert.notEqual(routeStart, -1);
  const route = source.slice(routeStart, routeStart + 2_500);

  assert.match(route, /iikoManualEntryConfirmed:\s*req\.body\.iikoManualEntryConfirmed/);
  assert.match(route, /setAdminAuditContext\(req,\s*\{/);
  assert.match(route, /actionCode:\s*'KITCHEN_STATUS_UPDATED'/);
  assert.match(route, /targetType:\s*'order'/);
  assert.match(route, /targetId:\s*order\.id/);
  assert.match(route, /branchId:\s*order\.branchId/);
  assert.match(route, /status:\s*req\.body\.status/);
  assert.match(route, /preparationMinutes:\s*req\.body\.preparationMinutes\s*\?\?\s*null/);
  assert.match(
    route,
    /iikoManualEntryConfirmed:\s*req\.body\.iikoManualEntryConfirmed\s*===\s*true/,
  );
});
