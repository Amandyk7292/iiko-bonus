const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const {
  reorderItemSelection,
  distinctReorderSelections,
} = require('../src/services/personalization.service');
const {
  previewScheduledAt,
  selectionKey,
  saveVariant,
  quoteSavedVariant,
} = require('../src/services/saved-variants.service');
const {
  savedVariantBodySchema,
  savedVariantQuoteBodySchema,
} = require('../src/contracts/customer-api.contract');

test('saved versions belong to the customer and are erased when the account is deleted', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,deleted_at timestamptz);`);
  await db.exec(
    fs.readFileSync('supabase/migrations/20260924060000_customer_saved_variants.sql', 'utf8'),
  );
  const first = randomUUID(),
    second = randomUUID(),
    id = randomUUID();
  await db.query('insert into customers(id) values($1),($2)', [first, second]);
  await db.query(
    `insert into customer_saved_variants(id,customer_id,product_id,name,configuration,selection_key)
    values($1,$2,'bun','My bun',$3,$4)`,
    [id, first, { filling: 'cream' }, 'a'.repeat(64)],
  );
  assert.equal(
    (
      await db.query('select count(*)::int n from customer_saved_variants where customer_id=$1', [
        second,
      ])
    ).rows[0].n,
    0,
  );
  await db.query('update customers set deleted_at=now() where id=$1', [first]);
  assert.equal(
    (
      await db.query('select count(*)::int n from customer_saved_variants where customer_id=$1', [
        first,
      ])
    ).rows[0].n,
    0,
  );
});

test('saved versions reject unselected extras and stale or unavailable options before a cart change', async () => {
  const id = randomUUID(),
    branchId = randomUUID();
  let writes = 0,
    quoted = false;
  const db = {
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      limit: async () => ({ data: [] }),
      upsert() {
        writes++;
        return this;
      },
      single: async () => ({
        data: {
          id,
          customer_id: id,
          product_id: 'bun',
          name: 'Bun',
          configuration: { filling: 'cream' },
          modifiers: [],
        },
      }),
      maybeSingle: async () => ({ data: null }),
    }),
  };
  const options = async () =>
    new Map([
      ['bun', { configuration: { enabled: true, productKind: 'bakery', minLeadHours: 48 } }],
    ]);
  const payload = {
    productId: 'bun',
    name: 'My bun',
    branchId,
    orderType: 'preorder',
    configuration: { filling: 'cream' },
    modifiers: [],
  };
  assert.equal(savedVariantBodySchema.safeParse(payload).success, true);
  assert.equal(
    savedVariantQuoteBodySchema.safeParse({ branchId, orderType: 'preorder', quantity: 2 }).success,
    true,
  );
  const at = await previewScheduledAt(['bun'], { options, now: Date.UTC(2026, 8, 24) });
  assert.equal(at, '2026-09-26T01:00:00.000Z');
  await assert.rejects(
    saveVariant(
      id,
      { ...payload, configuration: { candles: 0 } },
      {
        db,
        options,
        price: async () => {
          quoted = true;
        },
      },
    ),
    /Выберите начинку/,
  );
  assert.equal(writes, 0);
  assert.equal(quoted, false);
  await assert.rejects(
    saveVariant(id, payload, {
      db,
      options,
      price: async () => {
        throw Error('Товар в стоп-листе');
      },
    }),
    /стоп-листе/,
  );
  assert.equal(writes, 0);
  await assert.rejects(
    quoteSavedVariant(
      id,
      randomUUID(),
      { branchId, orderType: 'pickup' },
      {
        db,
        options,
        price: async () => {
          quoted = true;
        },
      },
    ),
    /не найден/,
  );
  assert.equal(quoted, false);
  assert.equal(
    selectionKey('bun', { filling: 'cream', candles: 0 }, [
      { groupId: 'a', optionIds: ['2', '1'] },
    ]),
    selectionKey('bun', { candles: 0, filling: 'cream' }, [
      { groupId: 'a', optionIds: ['1', '2'] },
    ]),
  );
});

test('a previously purchased configured item becomes editable raw choices when repeated', () => {
  const result = reorderItemSelection({
    configuration: {
      weight: { code: 'large', priceDelta: 300 },
      inscription: 'Привет',
      candles: 1,
      readyAt: '2026-09-30T12:00:00Z',
    },
    modifiers: [{ id: 'package', options: [{ id: 'box', priceDelta: 50 }] }],
  });
  assert.deepEqual(result.configuration, { weight: 'large', inscription: 'Привет', candles: 1 });
  assert.deepEqual(result.modifiers, [{ groupId: 'package', optionIds: ['box'] }]);
});

test('repeat keeps each distinct customization aligned after duplicate lines are merged', () => {
  const a = { id: 'bun', configuration: { filling: 'cream' }, modifiers: [] };
  const b = { id: 'bun', configuration: { filling: 'berry' }, modifiers: [] };
  assert.deepEqual(distinctReorderSelections([a, a, b]), [a, b]);
});
