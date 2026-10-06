const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');

function fixture(rpcError = null) {
  const calls = [];
  const filename = require.resolve('../src/services/cashier-catalog.service');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const mocks = {
    './menu.service': {
      getProductOverrides: async () => [],
      getCategoryOverrides: async () => [],
      getCustomProducts: async () => [],
    },
    './iiko-city-profile.service': {
      getIikoClientForBranch: async () => ({ profileKey: 'city' }),
    },
    './branch-catalog-source.service': {
      branchCatalogSource: async () => ({
        rawMenu: { products: [{ id: 'bun', name: 'Плюшка', price: 100 }] },
        stopIds: new Set(),
      }),
    },
    './product-inventory-unit.service': {
      listProductInventoryUnits: async () => new Map([['bun', 'шт']]),
    },
    './inventory.service': {
      getBranchAvailability: async () => new Map([['bun', { revision: 13, unit: 'шт' }]]),
    },
    '../config/supabase': {
      supabase: {
        from() {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: 'branch', active: true } };
            },
          };
        },
        async rpc(name, args) {
          calls.push({ name, args });
          return { data: { source_quantity: args.p_changes.sourceQuantity }, error: rpcError };
        },
      },
    },
    './realtime.service': { publish() {} },
    './stock-subscription.service': { notifyAvailableStock: async () => {} },
    '../utils/background-task.util': { runBackgroundTask() {} },
  };
  const run = vm.runInThisContext(
    `(function(require,module,exports){${readFileSync(filename, 'utf8')}\n})`,
    { filename },
  );
  run((id) => (Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id)), module, module.exports);
  return {
    calls,
    save: (payload) =>
      module.exports.updateCashierProduct(
        { role: 'cashier', branchIds: ['branch'] },
        'bun',
        payload,
      ),
  };
}

for (const quantity of [0, 2]) {
  test(`legacy physical count ${quantity} is an absolute correction with revision protection`, async () => {
    const f = fixture();
    const payload = { expectedRevision: 13, sourceQuantity: quantity, unit: 'шт' };
    await f.save(payload);
    assert.deepEqual(f.calls, [
      {
        name: 'update_cashier_inventory',
        args: {
          p_branch_id: 'branch',
          p_product_id: 'bun',
          p_product_name: 'Плюшка',
          p_expected_revision: 13,
          p_changes: { sourceQuantity: quantity, unit: 'шт', stockReason: 'correction' },
        },
      },
    ]);
    assert.equal(payload.stockReason, undefined);
  });
}

test('explicit additive arrivals retain their reason and operation identity', async () => {
  const f = fixture();
  const operationId = '48830cdd-76ea-4b7f-bf4d-9b79d0b05245';
  await f.save({
    expectedRevision: 13,
    sourceQuantity: 2,
    stockReason: 'receipt',
    operationId,
    unit: 'шт',
  });
  assert.deepEqual(f.calls[0].args.p_changes, {
    sourceQuantity: 2,
    stockReason: 'receipt',
    operationId,
    unit: 'шт',
  });
});

test('stop toggles remain independent of count changes', async () => {
  const f = fixture();
  await f.save({ expectedRevision: 13, manualStop: false });
  assert.deepEqual(f.calls[0].args.p_changes, { manualStop: false });
});

test('invalid SQL quantity input is a useful 400 without exposing database details', async () => {
  const f = fixture({ code: '22023', message: 'Internal database detail' });
  await assert.rejects(f.save({ expectedRevision: 13, sourceQuantity: 2 }), {
    statusCode: 400,
    message: 'Проверьте количество и единицу товара.',
  });
});

test('concurrent stock changes remain conflicts rather than overwriting current stock', async () => {
  const f = fixture({ code: '40001', message: 'Internal database detail' });
  await assert.rejects(f.save({ expectedRevision: 12, sourceQuantity: 2 }), {
    statusCode: 409,
    message: 'Остаток уже изменился. Проверьте новые данные и повторите сохранение.',
  });
});
