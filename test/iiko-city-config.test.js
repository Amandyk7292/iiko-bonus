const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Astana activation stores only city-scoped iiko settings', () => {
  const activation = read('scripts/configure-iiko-astana-vps.sh');
  assert.match(activation, /\['IIKO_ASTANA_API_LOGIN'/);
  assert.match(activation, /\['IIKO_ASTANA_ORGANIZATION_ID'/);
  assert.match(activation, /\['IIKO_ASTANA_EXTERNAL_MENU_ID'/);
  assert.doesNotMatch(activation, /\['IIKO_API_LOGIN'/);
  assert.match(activation, /The default IIKO_API_LOGIN remains unchanged/);
});

test('deployment contains the safe Astana probe and activation scripts', () => {
  const deployment = read('scripts/deploy-vps.ps1');
  const remoteDeployment = read('scripts/deploy-release.sh');
  const activation = read('scripts/configure-iiko-astana-vps.sh');
  const probe = read('scripts/probe-iiko-city-profile.js');
  assert.match(deployment, /configure-iiko-astana-vps\.sh/);
  assert.match(deployment, /probe-iiko-city-profile\.js/);
  assert.match(remoteDeployment, /configure-iiko-astana-vps\.sh/);
  assert.match(remoteDeployment, /probe-iiko-city-profile\.js/);
  assert.match(activation, /current_user == "\$service_user"/);
  assert.match(activation, /\/home\/deploy\/\.bulka-config-backups/);
  assert.match(probe, /requireExternal:\s*true/);
  assert.match(probe, /productsCount === 0/);
});
