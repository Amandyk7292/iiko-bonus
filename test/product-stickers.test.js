const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const supabase = {
  from() {
    throw new Error('Unexpected database call');
  },
};
require.cache[require.resolve('../src/config/supabase')] = { exports: { supabase } };
const { publicBadgeMap } = require('../src/services/product-badges.service');
const { registerProductBadgeRoutes } = require('../src/routes/admin/product-badges.routes');

const stickerId = 'df8e0292-b404-4b19-adeb-7c1c4a10d684';
const textIds = [1, 2, 3].map((n) => `11111111-1111-4111-8111-11111111111${n}`);
const imageUrl = 'https://bulka.com.kz/assets/product-stickers/shamrad-choice-v1.png';

test('sticker migration preserves all three text badges and has no automatic product assignments', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const filename of [
    '20260925060000_product_badges.sql',
    '20260925190000_product_badge_kazakh_labels.sql',
  ])
    await db.exec(fs.readFileSync(`supabase/migrations/${filename}`, 'utf8'));
  for (const id of textIds)
    await db.query(
      "insert into product_badges(id,label,background,foreground) values($1,'Хит','#782b0e','#ffffff')",
      [id],
    );
  await db.query('insert into product_badge_assignments(product_id,badge_ids) values($1,$2)', [
    'bread',
    textIds,
  ]);
  await db.exec(
    fs.readFileSync('supabase/migrations/20261001070000_product_photo_stickers.sql', 'utf8'),
  );
  const before = (await db.query('select badge_ids,sticker_id from product_badge_assignments'))
    .rows[0];
  assert.deepEqual(before, { badge_ids: textIds, sticker_id: null });
  const sticker = (
    await db.query('select label,label_kk,image_url from product_badges where id=$1', [stickerId])
  ).rows[0];
  assert.deepEqual(sticker, {
    label: 'Шамрадтың таңдауы',
    label_kk: 'Шамрадтың таңдауы',
    image_url: imageUrl,
  });
  await db.query('update product_badge_assignments set sticker_id=$1', [stickerId]);
  assert.deepEqual(
    (await db.query('select badge_ids from product_badge_assignments')).rows[0].badge_ids,
    textIds,
  );
  await assert.rejects(
    db.query("update product_badges set image_url='javascript:alert(1)' where id=$1", [stickerId]),
  );
  await assert.rejects(
    db.query('update product_badge_assignments set sticker_id=$1', [
      '22222222-2222-4222-8222-222222222222',
    ]),
  );
});

function memoryDatabase(t) {
  const rows = [
    ...textIds.map((id) => ({
      id,
      label: 'Хит',
      label_kk: 'Хит',
      background: '#782b0e',
      foreground: '#ffffff',
    })),
    {
      id: stickerId,
      label: 'Шамрадтың таңдауы',
      label_kk: 'Шамрадтың таңдауы',
      background: '#782b0e',
      foreground: '#ffffff',
      image_url: imageUrl,
    },
  ];
  const assignments = new Map();
  t.mock.method(supabase, 'from', (table) => {
    let queryValue;
    return {
      select() {
        return this;
      },
      order() {
        return this;
      },
      eq(_field, value) {
        queryValue = value;
        return this;
      },
      limit() {
        return Promise.resolve({
          data: table === 'product_badges' ? rows : [...assignments.values()],
        });
      },
      maybeSingle() {
        return Promise.resolve({
          data:
            table === 'product_badges'
              ? rows.find((r) => r.id === queryValue)
              : assignments.get(queryValue),
        });
      },
      upsert(value) {
        if (table === 'product_badge_assignments') {
          assignments.set(value.product_id, { ...assignments.get(value.product_id), ...value });
          return Promise.resolve({ error: null });
        }
        const row = { ...value, id: value.id || '33333333-3333-4333-8333-333333333333' };
        rows.push(row);
        return { select: () => ({ single: async () => ({ data: row }) }) };
      },
    };
  });
  t.mock.method(require('../src/services/realtime.service'), 'publish', () => {});
  return { rows, assignments };
}

async function api(t) {
  const app = express();
  app.use(express.json());
  registerProductBadgeRoutes(app);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (path, method = 'GET', body) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/menu/${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: response.status, data: await response.json() };
  };
}

test('admin selects, reads, replaces and clears a sticker independently of three text badges', async (t) => {
  const db = memoryDatabase(t);
  const request = await api(t);
  assert.equal(
    (
      await request('badges/assignment', 'PUT', {
        productId: 'bread',
        badgeIds: textIds,
        stickerId,
      })
    ).status,
    200,
  );
  const read = (await request('badges?productId=bread')).data;
  assert.deepEqual(read.selected, textIds);
  assert.equal(read.stickerId, stickerId);
  const projected = (await publicBadgeMap()).get('bread');
  assert.equal(projected.length, 4);
  assert.equal(projected.at(-1).imageUrl, imageUrl);
  assert.equal(
    (await request('badges/assignment', 'PUT', { productId: 'bread', badgeIds: [] })).status,
    200,
  );
  assert.equal(
    db.assignments.get('bread').sticker_id,
    stickerId,
    'legacy payload leaves sticker untouched',
  );
  await request('badges/assignment', 'PUT', {
    productId: 'bread',
    badgeIds: textIds,
    stickerId: null,
  });
  assert.deepEqual(db.assignments.get('bread'), {
    product_id: 'bread',
    badge_ids: textIds,
    sticker_id: null,
  });
});

test('assignment rejects a text badge as a sticker and an image as a text badge', async (t) => {
  const db = memoryDatabase(t);
  const request = await api(t);
  for (const body of [
    { productId: 'bread', badgeIds: [], stickerId: textIds[0] },
    { productId: 'bread', badgeIds: [stickerId] },
    { productId: 'bread', badgeIds: [], stickerId: '22222222-2222-4222-8222-222222222222' },
    { productId: 'bread', badgeIds: [...textIds, textIds[0]] },
  ])
    assert.equal((await request('badges/assignment', 'PUT', body)).status, 400);
  assert.equal(db.assignments.size, 0);
});

test('creating a reusable image sticker validates HTTPS and prevents changing existing badge type', async (t) => {
  memoryDatabase(t);
  const request = await api(t);
  const body = {
    label: 'Выбор пекаря',
    labelKk: 'Наубайшының таңдауы',
    background: '#782b0e',
    foreground: '#ffffff',
  };
  assert.equal(
    (await request('badges', 'POST', { ...body, imageUrl: 'javascript:alert(1)' })).status,
    400,
  );
  assert.equal(
    (await request('badges', 'POST', { ...body, imageUrl: 'http://example.com/a.png' })).status,
    400,
  );
  assert.equal(
    (await request('badges', 'POST', { ...body, id: textIds[0], imageUrl })).status,
    400,
  );
  const created = await request('badges', 'POST', { ...body, imageUrl });
  assert.equal(created.status, 200);
  assert.equal(created.data.badge.imageUrl, imageUrl);
});
