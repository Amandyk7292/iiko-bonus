const test = require('node:test');
const assert = require('node:assert/strict');
const { faqBodySchema } = require('../src/contracts/faq.contract');
const { FaqService, toPublicFaq, validateFaqPayload } = require('../src/services/faq.service');

const valid = {
  questionRu: 'Как получить бонусы?',
  answerRu: 'Покажите карту перед оплатой.\nПроцент указан на карте.',
  questionKk: 'Бонустарды қалай алуға болады?',
  answerKk: 'Төлем алдында картаны көрсетіңіз.',
  sortOrder: 0,
  isActive: true,
};

test('FAQ validates trimmed plain text, optional translation pairs and full replacement fields', () => {
  assert.equal(validateFaqPayload({ ...valid, questionRu: '  Вопрос  ' }).questionRu, 'Вопрос');
  assert.deepEqual(faqBodySchema.parse({ ...valid, questionKk: undefined, answerKk: undefined }), {
    ...valid,
    questionKk: '',
    answerKk: '',
  });
  assert.equal(faqBodySchema.safeParse({ ...valid, sortOrder: 2_147_483_647 }).success, true);
  const invalidChanges = [
    { questionRu: '  ' },
    { answerRu: '' },
    { questionRu: 'в'.repeat(241) },
    { answerRu: 'а'.repeat(4001) },
    { questionKk: 'қ'.repeat(241) },
    { answerKk: 'а'.repeat(4001) },
    { questionKk: 'Вопрос', answerKk: '  ' },
    { questionKk: '', answerKk: 'Ответ' },
    { sortOrder: -1 },
    { sortOrder: 1.5 },
    { sortOrder: '1' },
    { sortOrder: 2_147_483_648 },
    { isActive: 'true' },
    { questionRu: '<img src=x onerror=alert(1)>' },
    { answerRu: '<script>alert(1)</script>' },
    { answerKk: 'текст\u0000' },
    { unexpected: 'поле' },
    { question_ru: 'snake case' },
  ];
  for (const change of invalidChanges) {
    assert.throws(() => validateFaqPayload({ ...valid, ...change }), { code: 'VALIDATION_ERROR' });
  }
  assert.equal(faqBodySchema.safeParse({ isActive: false }).success, false);
});

test('Kazakh public fallback keeps both halves in Russian when either translation is incomplete', () => {
  const row = {
    id: 'fa010000-0000-4000-8000-000000000001',
    question_ru: 'Вопрос',
    answer_ru: 'Ответ',
    question_kk: 'Сұрақ',
    answer_kk: 'Жауап',
    sort_order: 3,
    is_active: true,
  };
  assert.deepEqual(toPublicFaq(row, 'kk'), {
    id: row.id,
    question: 'Сұрақ',
    answer: 'Жауап',
    sortOrder: 3,
  });
  for (const missing of [{ question_kk: '' }, { answer_kk: null }, { answer_kk: '   ' }]) {
    assert.deepEqual(toPublicFaq({ ...row, ...missing }, 'kk'), toPublicFaq(row, 'ru'));
  }
  assert.deepEqual(Object.keys(toPublicFaq(row, 'ru')), ['id', 'question', 'answer', 'sortOrder']);
});

test('FAQ service rejects invalid writes before DB access and converts database errors safely', async () => {
  let queries = 0;
  const service = new FaqService({
    db: {
      from() {
        queries++;
        const builder = {
          select: () => builder,
          order: () => builder,
          eq: () => builder,
          then: (resolve) => resolve({ error: new Error('database private diagnostic') }),
        };
        return builder;
      },
    },
  });
  await assert.rejects(() => service.create({ ...valid, answerRu: '' }), { statusCode: 400 });
  await assert.rejects(() => service.update('bad-id', valid), { statusCode: 400 });
  await assert.rejects(() => service.hide('bad-id'), { statusCode: 400 });
  await assert.rejects(() => service.listPublic('en'), { statusCode: 400 });
  assert.equal(queries, 0);
  await assert.rejects(() => service.listPublic(), {
    statusCode: 503,
    code: 'FAQ_UNAVAILABLE',
    message: 'FAQ временно недоступен',
  });
});
