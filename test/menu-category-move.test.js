const test = require('node:test');
const assert = require('node:assert/strict');
const supabase = {
  from() {
    throw new Error('Unexpected database access');
  },
};
require.cache[require.resolve('../src/config/supabase')] = { exports: { supabase } };
const service = require('../src/services/menu.service');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const { effectiveProductCategory } = require('../src/utils/menu-visibility.util');
const rawMenu = { groups: [{ id: 'buns' }, { id: 'bread' }], products: [{ id: 'a' }, { id: 'b' }] };

test('bulk move scopes one atomic write and only changes category fields', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', (table) => ({
    upsert: async (rows, options) => {
      writes.push({ table, rows, options });
      return { error: null };
    },
  }));
  assert.deepEqual(
    await service.moveProductsToCategory(['a', 'b', 'a'], 'buns', {
      rawMenu,
      profileKey: 'astana',
    }),
    ['a', 'b'],
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.onConflict, 'iiko_profile,iiko_product_id');
  for (const row of writes[0].rows) {
    assert.equal(row.iiko_profile, 'astana');
    assert.equal(row.custom_category_id, 'buns');
    assert.deepEqual(Object.keys(row).sort(), [
      'custom_category_id',
      'iiko_product_id',
      'iiko_profile',
      'updated_at',
    ]);
  }
  await service.moveProductsToCategory(['a'], null, { rawMenu, profileKey: 'default' });
  assert.equal(writes[1].rows[0].custom_category_id, null);
});

test('missing target or a product from another profile rejects entire selection before writing', async (t) => {
  t.mock.method(supabase, 'from', () => assert.fail('Must not write invalid selection'));
  for (const [ids, target] of [
    [['a'], 'missing'],
    [['a', 'other:a'], 'buns'],
    [[], 'buns'],
  ]) {
    await assert.rejects(
      service.moveProductsToCategory(ids, target, { rawMenu, profileKey: 'default' }),
      { statusCode: 400 },
    );
  }
});

test('category order is saved as one profile-scoped batch with a one-based order', async (t) => {
  const writes = [];
  t.mock.method(supabase, 'from', (table) => ({
    upsert: async (rows, options) => {
      writes.push({ table, rows, options });
      return { error: null };
    },
  }));

  await service.setCategoryOrder(['bread', 'buns', 'cakes'], { profileKey: 'astana' });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'menu_category_overrides');
  assert.equal(writes[0].options.onConflict, 'iiko_profile,iiko_category_id');
  assert.deepEqual(
    writes[0].rows.map(({ iiko_profile, iiko_category_id, sort_order }) => ({
      iiko_profile,
      iiko_category_id,
      sort_order,
    })),
    [
      { iiko_profile: 'astana', iiko_category_id: 'bread', sort_order: 1 },
      { iiko_profile: 'astana', iiko_category_id: 'buns', sort_order: 2 },
      { iiko_profile: 'astana', iiko_category_id: 'cakes', sort_order: 3 },
    ],
  );
});

test('category order rejects duplicates and invalid ids before database access', async (t) => {
  t.mock.method(supabase, 'from', () => assert.fail('Must not write an invalid order'));
  await assert.rejects(service.setCategoryOrder(['buns', 'buns']), { statusCode: 400 });
  await assert.rejects(service.setCategoryOrder(['invalid id']), { statusCode: 400 });
});

test('bulk contract requires explicit profile and a bounded non-empty product selection', () => {
  const schema = adminMutationSchemas.moveMenuProducts.body;
  assert.equal(
    schema.safeParse({ productIds: ['a'], categoryId: 'buns', profileKey: 'default' }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ productIds: ['a'], categoryId: null, profileKey: 'default' }).success,
    true,
  );
  for (const payload of [
    { productIds: [], categoryId: 'buns', profileKey: 'default' },
    { productIds: Array(501).fill('a'), categoryId: 'buns', profileKey: 'default' },
    { productIds: ['a'], categoryId: 'buns' },
  ])
    assert.equal(schema.safeParse(payload).success, false);
});

test('category order contract requires a unique category list and profile key', () => {
  const schema = adminMutationSchemas.menuCategoryOrder.body;
  assert.equal(
    schema.safeParse({ categoryIds: ['bread', 'buns'], profileKey: 'default' }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ categoryIds: ['bread', 'bread'], profileKey: 'default' }).success,
    false,
  );
  assert.equal(schema.safeParse({ categoryIds: [], profileKey: 'default' }).success, false);
  assert.equal(schema.safeParse({ categoryIds: ['bread'] }).success, false);
});

test('category overrides survive iiko sync and recover if the destination disappears', () => {
  const product = { parentGroup: 'bread' };
  assert.equal(
    effectiveProductCategory(product, { custom_category_id: 'buns' }, rawMenu.groups),
    'buns',
  );
  assert.equal(
    effectiveProductCategory(product, { custom_category_id: 'gone' }, rawMenu.groups),
    'bread',
  );
  assert.equal(
    effectiveProductCategory(product, { custom_category_id: null }, rawMenu.groups),
    'bread',
  );
});
