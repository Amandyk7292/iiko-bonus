const fs = require('node:fs');
const path = require('node:path');

const connectionUrl = process.env.BULKA_DATABASE_URL || '';
const outputDirectory = process.env.BULKA_PG_CONNECTION_DIR || '';

function fail(message) {
  throw new Error(`PostgreSQL connection setup failed: ${message}`);
}

function decoded(value, label) {
  let result;
  try {
    result = decodeURIComponent(value);
  } catch {
    fail(`${label} is not valid URL encoding`);
  }
  if (!result || /[\0\r\n]/.test(result)) fail(`${label} is empty or contains a line break`);
  return result;
}

function pgpassEscape(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function writePrivateFile(filename, value) {
  const target = path.join(outputDirectory, filename);
  fs.writeFileSync(target, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

if (!connectionUrl) fail('BULKA_DATABASE_URL is required');
if (!path.isAbsolute(outputDirectory)) fail('BULKA_PG_CONNECTION_DIR must be absolute');

const parsed = new URL(connectionUrl);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  fail('only postgres:// and postgresql:// URLs are accepted');
}

const host = decoded(parsed.hostname.replace(/^\[|\]$/g, ''), 'host');
const port = parsed.port || '5432';
if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) fail('port is invalid');
const username = decoded(parsed.username, 'username');
const password = decoded(parsed.password, 'password');
const database = decoded(parsed.pathname.replace(/^\//, ''), 'database');
const sslmode = parsed.searchParams.get('sslmode') || '';
if (
  sslmode &&
  !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)
) {
  fail('sslmode is invalid');
}

fs.accessSync(outputDirectory, fs.constants.W_OK);
writePrivateFile('host', host);
writePrivateFile('port', port);
writePrivateFile('username', username);
writePrivateFile('database', database);
writePrivateFile('sslmode', sslmode);
writePrivateFile(
  'pgpass',
  `${[host, port, database, username, password].map(pgpassEscape).join(':')}\n`,
);
