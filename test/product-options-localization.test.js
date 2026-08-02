/* global require */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOptionTranslations,
} = require('../src/services/product-options.service');

test('legacy Russian option titles receive Kazakh and English standard translations', () => {
  assert.deepEqual(
    normalizeOptionTranslations(
      { ru: 'Маленький', kk: 'Маленький', en: 'Маленький' },
      'small',
    ),
    { ru: 'Маленький', kk: 'Кішкентай', en: 'Small' },
  );
  assert.deepEqual(normalizeOptionTranslations({ ru: 'Размер' }, 'size'), {
    ru: 'Размер',
    kk: 'Өлшем',
    en: 'Size',
  });
});

test('administrator translations are preserved when they differ from Russian', () => {
  assert.deepEqual(
    normalizeOptionTranslations(
      { ru: 'Авторский', kk: 'Авторлық', en: 'Signature' },
      'signature',
    ),
    { ru: 'Авторский', kk: 'Авторлық', en: 'Signature' },
  );
});
