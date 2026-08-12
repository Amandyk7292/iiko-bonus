const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('CI compiles iOS with a non-production Firebase fixture', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const fixturePath = path.join(
    root,
    'test',
    'fixtures',
    'firebase-ios',
    'GoogleService-Info.plist',
  );
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.equal((workflow.match(/Create ephemeral Firebase iOS configuration/g) || []).length, 2);
  assert.match(workflow, /test\/fixtures\/firebase-ios\/GoogleService-Info\.plist/);
  assert.match(fixture, /<string>ci-placeholder-api-key<\/string>/);
  assert.match(fixture, /<string>com\.bulka\.bonus<\/string>/);
  assert.doesNotMatch(fixture, /bulka-bonus|609090307246|AIza/);
});

test('production Firebase iOS configuration remains excluded from Git', () => {
  const ignore = fs.readFileSync(path.join(root, 'BulkaAndroid', 'ios', '.gitignore'), 'utf8');

  assert.match(ignore, /^Runner\/GoogleService-Info\.plist$/m);
});

test('Android CI retries transient dependency downloads with bounded backoff', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const retryScript = fs.readFileSync(path.join(root, 'scripts', 'run-with-backoff.mjs'), 'utf8');

  assert.equal((workflow.match(/\.\.\/scripts\/run-with-backoff\.mjs/g) || []).length, 2);
  assert.equal((workflow.match(/--attempts 3 --initial-delay-seconds 10/g) || []).length, 2);
  assert.match(workflow, /flutter build apk --debug/);
  assert.match(workflow, /flutter build appbundle --release/);
  assert.match(retryScript, /attempts > 5/);
  assert.match(retryScript, /initialDelaySeconds \* 2 \*\* \(attempt - 1\)/);
  assert.match(retryScript, /shell: false/);
  assert.doesNotMatch(retryScript, /execSync|eval\(/);
});
