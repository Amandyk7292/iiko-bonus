const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const config = {
  product_kind: 'cake',
  enabled: true,
  allow_inscription: true,
  inscription_max_length: 80,
  allow_candles: true,
  allow_reference_upload: false,
  min_lead_hours: 72,
  max_advance_days: 30,
  weight_options: [],
  filling_options: [],
  design_options: [],
};
const group = (code = 'size', price = 500) => ({
  code,
  title_translations: { ru: 'Размер' },
  selection_type: 'single',
  required: true,
  min_selected: 1,
  max_selected: 1,
  sort_order: 0,
  active: true,
  options: [
    {
      code: 'large',
      title_translations: { ru: 'Большой' },
      price_delta: price,
      is_default: false,
      sort_order: 0,
      active: true,
    },
  ],
});
const save = (id, groups, c = config) =>
  db.query('select replace_product_options($1,$2,$3)', [
    id,
    JSON.stringify(c),
    JSON.stringify(groups),
  ]);
const snapshot = async () => {
  const values = [];
  for (const table of [
    'product_configurations',
    'product_modifier_groups',
    'product_modifier_options',
  ])
    values.push((await db.query(`select * from ${table} order by 1`)).rows);
  return JSON.stringify(values);
};
test.before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  const schema = fs.readFileSync(
    'supabase/migrations/20260715090000_commerce_operations_suite.sql',
    'utf8',
  );
  await db.exec(
    schema.slice(0, schema.indexOf('create table if not exists public.customer_favorites')),
  );
  const migration = fs.readFileSync(
    'supabase/migrations/20260922160000_atomic_product_options.sql',
    'utf8',
  );
  await db.exec(migration);
  await db.exec(migration);
});
test.after(() => db.close());
test.beforeEach(() =>
  db.exec(
    'truncate product_configurations, product_modifier_groups, product_modifier_options cascade',
  ),
);
test('a failure in the last option rolls back configuration and all earlier modifier edits', async () => {
  await save('cake', [group()]);
  const before = await snapshot();
  await assert.rejects(
    save('cake', [group('size', 900), group('packaging', -1)], { ...config, min_lead_hours: 24 }),
    /price_delta/,
  );
  assert.equal(await snapshot(), before);
});
test('editing prices preserves selected group and option IDs; deletion is product-scoped', async () => {
  await save('cake', [group(), group('packaging')]);
  await save('other', [group()]);
  const before = (
    await db.query(
      "select g.id as gid,o.id as oid from product_modifier_groups g join product_modifier_options o on o.group_id=g.id where g.product_id='cake' and g.code='size'",
    )
  ).rows;
  await save('cake', [group('size', 700)]);
  assert.deepEqual(
    (
      await db.query(
        "select g.id as gid,o.id as oid from product_modifier_groups g join product_modifier_options o on o.group_id=g.id where g.product_id='cake' and g.code='size'",
      )
    ).rows,
    before,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from product_modifier_groups where product_id='cake'",
      )
    ).rows[0].n,
    1,
  );
  await save('cake', []);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from product_modifier_groups where product_id='other'",
      )
    ).rows[0].n,
    1,
  );
});
test('duplicate codes and unprivileged calls cannot modify options', async () => {
  await save('cake', [group()]);
  const before = await snapshot();
  await assert.rejects(save('cake', [group(), group()]), /Duplicate/);
  await assert.rejects(
    save('cake', [{ ...group(), options: [...group().options, ...group().options] }]),
    /Duplicate/,
  );
  assert.equal(await snapshot(), before);
  await db.exec('set role authenticated');
  await assert.rejects(save('cake', []), /permission denied/);
  await db.exec('reset role');
});
