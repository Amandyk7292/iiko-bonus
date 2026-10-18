const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { resolveReleaseVersion } = require('../scripts/finalize-flutter-web');

test('production monitor accepts builder release labels and rejects corrupt manifests using actual mocked fetches', () => {
  const monitor = pathToFileURL(path.resolve('scripts/check-production-edge.mjs')).href;
  for (const [version, checksum, success] of [
    ['42489eb06414', 'a'.repeat(64), true],
    ['42489eb064144105d17ac090dff752ceb3f6b9d0', 'a'.repeat(64), true],
    ['20261015-bonus-credit-lots', 'a'.repeat(64), true],
    ['release-test', 'a'.repeat(64), true],
    ['42489eb', 'a'.repeat(64), true],
    ['safe_6', 'a'.repeat(64), true],
    ['a'.repeat(64), 'a'.repeat(64), true],
    ['a'.repeat(65), 'a'.repeat(64), false],
    ['short', 'a'.repeat(64), false],
    ['../release-test', 'a'.repeat(64), false],
    ['release test', 'a'.repeat(64), false],
    ['_release-test', 'a'.repeat(64), false],
    ['release-test\n', 'a'.repeat(64), false],
    [123456, 'a'.repeat(64), false],
    [null, 'a'.repeat(64), false],
    ['42489eb06414', 'broken', false],
    ['42489eb06414', 'a'.repeat(64) + '\n', false],
  ]) {
    if (success) assert.equal(resolveReleaseVersion(version), version);
    const code = `
      globalThis.fetch = async (url) => {
        const target = new URL(url);
        if (target.hostname.startsWith('www.')) return new Response(null, {status:308,headers:{location:'https://bulka.example/healthz'}});
        const payload = target.pathname === '/release-version.json' ? ${JSON.stringify({ version, mainSha256: checksum })} : {status:target.pathname === '/healthz' ? 'ok' : 'ready'};
        return new Response(JSON.stringify(payload));
      };
      await import(${JSON.stringify(monitor)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PRODUCTION_BASE_URL: 'https://bulka.example',
        MONITOR_REQUIRE_CLOUDFLARE: 'false',
      },
    });
    assert.equal(result.status, success ? 0 : 1, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.checks.find((item) => item.name === 'release-provenance').ok, success);
    assert.equal(
      output.checks.filter((item) => item.name !== 'release-provenance').every((item) => item.ok),
      true,
    );
  }
});
