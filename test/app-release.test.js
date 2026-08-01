const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeAppReleasePolicy } = require('../src/services/app-release.service');

test('app release policy exposes safe Android and iOS store configuration', () => {
  assert.deepEqual(
    normalizeAppReleasePolicy('android', {
      app_release_policy: {
        android: {
          latest_version: '1.4.0',
          minimum_version: '1.2.0',
          store_url: 'https://play.google.com/store/apps/details?id=com.bulka.bonus',
        },
      },
    }),
    {
      platform: 'android',
      latestVersion: '1.4.0',
      minimumVersion: '1.2.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.bulka.bonus',
    },
  );

  assert.deepEqual(normalizeAppReleasePolicy('ios', {}), {
    platform: 'ios',
    latestVersion: '1.0.0',
    minimumVersion: '1.0.0',
    storeUrl: '',
  });
});

test('app release policy rejects malformed versions and unsafe URLs', () => {
  const policy = normalizeAppReleasePolicy('android', {
    app_release_policy: {
      android: {
        latest_version: '<script>',
        minimum_version: '1',
        store_url: 'javascript:alert(1)',
      },
    },
  });

  assert.equal(policy.latestVersion, '1.0.0');
  assert.equal(policy.minimumVersion, '1.0.0');
  assert.equal(
    policy.storeUrl,
    'https://play.google.com/store/apps/details?id=com.bulka.bonus',
  );
});
