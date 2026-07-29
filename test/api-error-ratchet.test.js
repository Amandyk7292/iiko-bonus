const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const listJavaScriptFiles = (directory) =>
  fs
    .readdirSync(path.join(projectRoot, directory))
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(projectRoot, directory, name));

const auditedApiHandlers = [
  path.join(projectRoot, 'src/routes/public.routes.js'),
  path.join(projectRoot, 'src/routes/admin.routes.js'),
  ...listJavaScriptFiles('src/controllers'),
  ...listJavaScriptFiles('src/routes/admin'),
];

const RAW_ERROR_MESSAGE_BASELINE = 126;
const rawErrorMessagePattern =
  /error\s*:\s*(?:error|err|caught)\??\.message/g;

test('raw API error.message responses do not grow beyond the audited baseline', () => {
  const occurrences = auditedApiHandlers.reduce((total, file) => {
    const source = fs.readFileSync(file, 'utf8');
    return total + (source.match(rawErrorMessagePattern) || []).length;
  }, 0);

  assert.ok(
    occurrences <= RAW_ERROR_MESSAGE_BASELINE,
    `Raw API error.message responses grew from ${RAW_ERROR_MESSAGE_BASELINE} to ${occurrences}. ` +
      'Use sendApiError or pass the error to the global handler.',
  );
});
