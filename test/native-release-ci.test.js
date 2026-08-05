const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('CI compiles iOS with a non-production Firebase fixture', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  const fixturePath = path.join(
    root,
    'test',
    'fixtures',
    'firebase-ios',
    'GoogleService-Info.plist',
  );
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.equal(
    (workflow.match(/Create ephemeral Firebase iOS configuration/g) || []).length,
    2,
  );
  assert.match(
    workflow,
    /test\/fixtures\/firebase-ios\/GoogleService-Info\.plist/,
  );
  assert.match(fixture, /<string>ci-placeholder-api-key<\/string>/);
  assert.match(fixture, /<string>com\.bulka\.bonus<\/string>/);
  assert.doesNotMatch(fixture, /bulka-bonus|609090307246|AIza/);
});

test('production Firebase iOS configuration remains excluded from Git', () => {
  const ignore = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'ios', '.gitignore'),
    'utf8',
  );

  assert.match(ignore, /^Runner\/GoogleService-Info\.plist$/m);
});
