const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validateTierPayload,
  toApiTier,
  toDatabaseTier,
  toPublicTier,
} = require('../src/services/tier.service');
const { getTierInfo } = require('../src/utils/tier.util');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');

const tier = {
  code: 'bronze',
  names: { ru: 'Бронза', kk: 'Қола', en: 'Bronze' },
  descriptions: { ru: 'Бронза', kk: 'Қола', en: 'Bronze' },
  minSpend: 0,
  cashbackPercent: 3,
  sortOrder: 0,
  isActive: true,
};

test('tier artwork survives storage, localization and customer tier selection', () => {
  for (const url of [
    '/assets/loyalty/platinum-v1.webp',
    'https://images.example.test/custom.webp',
  ]) {
    const request = adminMutationSchemas.tierUpdate.body.parse({
      ...tier,
      backgroundImageUrl: url,
    });
    const validated = validateTierPayload(request);
    const stored = toDatabaseTier(validated);
    assert.equal(stored.background_image_url, url);
    assert.equal(toApiTier(stored).backgroundImageUrl, url);
    assert.equal(toPublicTier(stored, 'kk').backgroundImageUrl, url);
    assert.equal(getTierInfo(0, [stored]).backgroundImageUrl, url);
    assert.equal(getTierInfo(0, [stored]).code, 'bronze');
  }
});

test('ordinary tier updates preserve artwork; reset explicitly clears it', () => {
  const existing = { ...tier, backgroundImageUrl: 'https://images.example.test/custom.webp' };
  const changes = validateTierPayload({ cashbackPercent: 4 }, { existing, partial: true });
  assert.equal(
    toDatabaseTier({ ...existing, ...changes }).background_image_url,
    existing.backgroundImageUrl,
  );
  const reset = validateTierPayload({ backgroundImageUrl: null }, { existing, partial: true });
  assert.equal(toDatabaseTier({ ...existing, ...reset }).background_image_url, null);
});

test('tier artwork rejects executable, insecure, arbitrary local and credential URLs', () => {
  for (const backgroundImageUrl of [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'http://example.test/a.png',
    '/private/a.png',
    '//example.test/a.png',
    'https://user:pass@example.test/a.png',
    'https://example.test/a\nb.png',
    {},
    5,
  ]) {
    assert.throws(
      () => validateTierPayload({ backgroundImageUrl }, { existing: tier, partial: true }),
      { code: 'TIER_VALIDATION_ERROR' },
    );
  }
});
