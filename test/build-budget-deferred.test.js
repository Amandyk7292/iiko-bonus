const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('the release budget rejects a large deferred chunk even when the initial bundle is small', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-deferred-budget-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  fs.writeFileSync(path.join(directory, 'main.dart.js'), 'small-initial-bundle');
  const chunk = path.join(directory, 'main.dart.js_1.release-20261003-abcdef0123456789.part.js');
  fs.writeFileSync(chunk, 'x'.repeat(100000));
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'check-build-budgets.js'), '--flutter', directory,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Flutter deferred JavaScript total/);
  assert.doesNotMatch(result.stderr, /Flutter main\.dart\.js:/);
});
