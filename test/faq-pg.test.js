const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { database } = require('./helpers/photo-report-database.cjs');
const { FaqService, validateFaqPayload } = require('../src/services/faq.service');

const pg = new PGlite();
const service = new FaqService({ db: database(pg) });
const input = {
  questionRu: 'Проверка вопроса',
  answerRu: 'Первая строка\nВторая строка',
  questionKk: 'Сұрақ',
  answerKk: 'Жауап',
  sortOrder: 20,
  isActive: true,
};

test.before(async () => {
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(readFileSync('supabase/migrations/20261003223000_loyalty_faq.sql', 'utf8'));
});
test.after(() => pg.close());

test('FAQ migration seeds ten valid bilingual questions and public output follows configured order', async () => {
  const items = await service.listAdmin();
  assert.equal(items.length, 10);
  for (const { id: _id, ...item } of items) {
    validateFaqPayload(item);
    assert.ok(item.questionKk && item.answerKk);
    assert.ok(item.isActive);
    assert.doesNotMatch(item.answerRu, /\d/);
  }
  assert.deepEqual(
    items.map((item) => item.sortOrder),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  const ru = await service.listPublic('ru');
  const kk = await service.listPublic('kk');
  assert.equal(ru.length, 10);
  assert.equal(kk[0].answer, items[0].answerKk);
  assert.equal(ru[0].answer, items[0].answerRu);
  assert.deepEqual(Object.keys(ru[0]), ['id', 'question', 'answer', 'sortOrder']);
});

test('create/edit/hide/show round trip preserves content and hiding leaves a restorable admin item', async () => {
  const created = await service.create(input);
  assert.equal(created.answerRu, input.answerRu);
  assert.ok((await service.listPublic()).some((item) => item.id === created.id));
  const hidden = await service.hide(created.id);
  assert.equal(hidden.isActive, false);
  assert.equal(hidden.answerRu, input.answerRu);
  assert.ok(!(await service.listPublic()).some((item) => item.id === created.id));
  assert.ok((await service.listAdmin()).some((item) => item.id === created.id));
  const restored = await service.update(created.id, {
    ...input,
    questionRu: 'Исправленный вопрос',
    questionKk: '',
    answerKk: '',
    sortOrder: 0,
  });
  assert.equal(restored.questionRu, 'Исправленный вопрос');
  assert.equal(restored.isActive, true);
  const publicItems = await service.listPublic('kk');
  const item = publicItems.find((item) => item.id === created.id);
  assert.equal(item.question, 'Исправленный вопрос');
  assert.equal(item.answer, input.answerRu);
  assert.deepEqual(
    publicItems.filter((item) => item.sortOrder === 0).map((item) => item.id),
    publicItems
      .filter((item) => item.sortOrder === 0)
      .map((item) => item.id)
      .sort(),
  );
  const before = await service.listAdmin();
  await assert.rejects(() => service.update(created.id, { ...input, answerRu: '' }), {
    statusCode: 400,
  });
  assert.deepEqual(await service.listAdmin(), before);
  await assert.rejects(() => service.hide(randomUUID()), {
    statusCode: 404,
    code: 'FAQ_NOT_FOUND',
  });
  await assert.rejects(() => service.update(randomUUID(), input), { statusCode: 404 });
});

test('database constraints reject missing Russian text, broken Kazakh pairs and invalid ordering', async () => {
  const item = await service.create({ ...input, questionKk: '', answerKk: '', isActive: false });
  for (const [field, value] of [
    ['question_ru', '   '],
    ['answer_ru', ''],
    ['question_ru', 'в'.repeat(241)],
    ['answer_ru', 'а'.repeat(4001)],
    ['question_kk', 'только вопрос'],
    ['sort_order', -1],
  ]) {
    await assert.rejects(() =>
      pg.query(`update loyalty_faq set ${field}=$1 where id=$2`, [value, item.id]),
    );
  }
});

test('only the backend service role can read/write FAQ; anonymous access has no RLS policy', async () => {
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(() => pg.query('select * from loyalty_faq'), /permission denied/);
      await assert.rejects(
        () => pg.query("insert into loyalty_faq(question_ru,answer_ru) values('Вопрос','Ответ')"),
        /permission denied/,
      );
    } finally {
      await pg.exec('reset role');
    }
  }
  // Even if a future grant accidentally exposes SELECT, RLS still hides content.
  await pg.exec('grant select on loyalty_faq to anon; set role anon');
  try {
    assert.equal((await pg.query('select * from loyalty_faq')).rows.length, 0);
  } finally {
    await pg.exec('reset role; revoke select on loyalty_faq from anon');
  }
  await pg.exec('set role service_role');
  try {
    assert.ok((await service.listAdmin()).length >= 10);
    const item = await service.create({ ...input, isActive: false });
    assert.equal((await service.update(item.id, input)).isActive, true);
    assert.equal((await service.hide(item.id)).isActive, false);
    await assert.rejects(
      () => pg.query('delete from loyalty_faq where id=$1', [item.id]),
      /permission denied/,
    );
  } finally {
    await pg.exec('reset role');
  }
});
