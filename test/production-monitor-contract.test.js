const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('production monitor accepts deployed Git revisions and rejects corrupt manifests', () => {
  const monitor = pathToFileURL(path.resolve('scripts/check-production-edge.mjs')).href;
  for (const [version, checksum, success] of [
    ['42489eb06414', 'a'.repeat(64), true],
    ['42489eb064144105d17ac090dff752ceb3f6b9d0', 'a'.repeat(64), true],
    ['release-test', 'a'.repeat(64), false],
    ['42489eb', 'a'.repeat(64), false],
    ['42489eb06414', 'broken', false],
  ]) {
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
  }
});
