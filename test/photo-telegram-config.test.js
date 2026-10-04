const test = require('node:test');
const assert = require('node:assert/strict');
const {
  photoTelegramConfigurationErrors,
  shouldRunPhotoTelegram,
} = require('../src/config/photo-telegram');

const valid = {
  PHOTO_REPORT_TELEGRAM_ENABLED: 'true',
  PHOTO_REPORT_TELEGRAM_BOT_TOKEN: '123456789:' + 's'.repeat(35),
  PHOTO_REPORT_TELEGRAM_OWNER_USERNAME: 'synthetic_owner',
  RUN_BACKGROUND_WORKERS: 'true',
};

test('report bot stays off on preflight and staging independently of legacy bots', () => {
  assert.equal(shouldRunPhotoTelegram({ ...valid, RUN_BOTS: 'false' }), true);
  assert.equal(shouldRunPhotoTelegram({ ...valid, RUN_BACKGROUND_WORKERS: 'false' }), false);
  assert.equal(shouldRunPhotoTelegram({ ...valid, PHOTO_REPORT_TELEGRAM_ENABLED: 'false' }), false);
  assert.equal(shouldRunPhotoTelegram({}), false);
  assert.deepEqual(photoTelegramConfigurationErrors({}), []);
});

test('enabled report bot requires a valid secret and a bootstrap owner, without exposing values', () => {
  for (const changes of [
    { PHOTO_REPORT_TELEGRAM_BOT_TOKEN: 'private invalid value' },
    { PHOTO_REPORT_TELEGRAM_OWNER_USERNAME: '', PHOTO_REPORT_TELEGRAM_OWNER_ID: '' },
    { PHOTO_REPORT_TELEGRAM_OWNER_ID: '-1' },
    { PHOTO_REPORT_TELEGRAM_OWNER_ID: '9007199254740992' },
    { PHOTO_REPORT_TELEGRAM_ENABLED: 'yes' },
  ]) {
    const errors = photoTelegramConfigurationErrors({ ...valid, ...changes });
    assert.ok(errors.length);
    assert.equal(shouldRunPhotoTelegram({ ...valid, ...changes }), false);
    assert.ok(!JSON.stringify(errors).includes('private invalid value'));
  }
  assert.deepEqual(
    photoTelegramConfigurationErrors({ ...valid, PHOTO_REPORT_TELEGRAM_OWNER_ID: '1234567890123' }),
    [],
  );
});
