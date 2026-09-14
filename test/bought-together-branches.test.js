const test = require('node:test');
const assert = require('node:assert/strict');
const { branchBindings } = require('../src/config/bought-together-branches');
const { selectRecommendations } = require('../src/services/bought-together.service');

test('verified bakery binding selects its own cash receipts, not another department', () => {
  const branch = '48f71218-aa08-51bf-a6d9-2497c4a1e55b';
  const bindings = branchBindings({});
  const department = bindings[branch].departmentId;
  const snapshot = { scopes: { 'aktau-chain': { city: 'aktau', departments: {
    [department]: { products: { bun: ['coffee'] }, popularProducts: ['tea'] },
    other: { products: { bun: ['wrong-branch'] } },
  } } } };
  assert.deepEqual(selectRecommendations(snapshot, 'bun', branch, bindings).productIds, ['coffee']);
});

test('explicit configuration overrides verified defaults and may disable a mapping', () => {
  const branch = '48f71218-aa08-51bf-a6d9-2497c4a1e55b';
  assert.equal(branchBindings({ BOUGHT_TOGETHER_BRANCHES_JSON: JSON.stringify({ [branch]: null }) })[branch], null);
  assert.equal(Object.keys(branchBindings({ BOUGHT_TOGETHER_BRANCHES_JSON: 'invalid' })).length, 12);
});
