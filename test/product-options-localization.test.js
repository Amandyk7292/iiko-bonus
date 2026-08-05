/* global require */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOptionTranslations,
  summarizeProductOptionFlags,
} = require('../src/services/product-options.service');
const { productOptionSummaryBodySchema } = require('../src/contracts/customer-api.contract');

test('legacy Russian option titles receive Kazakh and English standard translations', () => {
  assert.deepEqual(
    normalizeOptionTranslations({ ru: 'Маленький', kk: 'Маленький', en: 'Маленький' }, 'small'),
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
    normalizeOptionTranslations({ ru: 'Авторский', kk: 'Авторлық', en: 'Signature' }, 'signature'),
    { ru: 'Авторский', kk: 'Авторлық', en: 'Signature' },
  );
});

test('compact product option summary marks builders and modifier groups only', () => {
  const flags = summarizeProductOptionFlags(
    ['builder', 'standard', 'modifier', 'disabled', 'plain'],
    [
      { product_id: 'builder', product_kind: 'cake', enabled: true },
      { product_id: 'standard', product_kind: 'standard', enabled: true },
      { product_id: 'disabled', product_kind: 'cake', enabled: false },
    ],
    [{ product_id: 'modifier' }],
  );

  assert.deepEqual(Object.fromEntries(flags), {
    builder: true,
    standard: false,
    modifier: true,
    disabled: false,
    plain: false,
  });
});

test('compact product option request accepts one full 180-product UUID batch', () => {
  const productIds = Array.from(
    { length: 180 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  const serialized = JSON.stringify({ productIds });

  assert.equal(serialized.length > 2_000, true);
  assert.equal(productOptionSummaryBodySchema.safeParse({ productIds }).success, true);
  assert.equal(
    productOptionSummaryBodySchema.safeParse({ productIds: [...productIds, ...productIds] })
      .success,
    false,
  );
});
