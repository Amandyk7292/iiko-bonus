const assert = require('node:assert/strict');
const test = require('node:test');

const iikoPath = require.resolve('../src/services/iiko.service');
const profilePath = require.resolve('../src/services/iiko-city-profile.service');
const managedEnvironment = [
  'IIKO_API_LOGIN',
  'IIKO_ORGANIZATION_ID',
  'IIKO_EXTERNAL_MENU_ID',
  'IIKO_PRICE_CATEGORY_ID',
  'IIKO_ASTANA_API_LOGIN',
  'IIKO_ASTANA_ORGANIZATION_ID',
  'IIKO_ASTANA_EXTERNAL_MENU_ID',
  'IIKO_ASTANA_PRICE_CATEGORY_ID',
];

test('Astana gets an isolated iiko client while other cities keep the default profile', () => {
  const previousEnvironment = new Map(managedEnvironment.map((key) => [key, process.env[key]]));
  const previousIikoModule = require.cache[iikoPath];
  const previousProfileModule = require.cache[profilePath];

  Object.assign(process.env, {
    IIKO_API_LOGIN: 'default-api-login-1234567890',
    IIKO_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111',
    IIKO_EXTERNAL_MENU_ID: 'default-menu',
    IIKO_PRICE_CATEGORY_ID: 'default-price',
    IIKO_ASTANA_API_LOGIN: 'astana-api-login-12345678901',
  });
  delete process.env.IIKO_ASTANA_ORGANIZATION_ID;
  delete process.env.IIKO_ASTANA_EXTERNAL_MENU_ID;
  delete process.env.IIKO_ASTANA_PRICE_CATEGORY_ID;
  delete require.cache[iikoPath];
  delete require.cache[profilePath];

  try {
    const profiles = require(profilePath);
    const astana = profiles.getIikoClientForCity('Астана');
    const astanaAlias = profiles.getIikoClientForCity('Nur-Sultan');
    const aktau = profiles.getIikoClientForCity('Актау');

    assert.equal(astana.profileKey, 'astana');
    assert.equal(astana.apiLogin, 'astana-api-login-12345678901');
    assert.equal(astana.organizationId, null);
    assert.equal(astana.externalMenuId, '');
    assert.equal(astana.priceCategoryId, '');
    assert.equal(astanaAlias, astana);

    assert.equal(aktau.profileKey, 'default');
    assert.equal(aktau.apiLogin, 'default-api-login-1234567890');
    assert.equal(aktau.organizationId, '11111111-1111-4111-8111-111111111111');
    assert.equal(profiles.profileStatus().astana.configured, true);
  } finally {
    delete require.cache[iikoPath];
    delete require.cache[profilePath];
    if (previousIikoModule) require.cache[iikoPath] = previousIikoModule;
    if (previousProfileModule) require.cache[profilePath] = previousProfileModule;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
