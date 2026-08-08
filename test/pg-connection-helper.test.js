const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('PostgreSQL helper keeps the password only in a private pgpass file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-pg-'));
  const encodedPassword = ['p', '%40', 'ss', '%3A', 'word'].join('');
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-pg-connection.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        BULKA_DATABASE_URL: [
          'postgresql://bulka_user:',
          encodedPassword,
          '@db.example.test:6543/bulka_restore?sslmode=require',
        ].join(''),
        BULKA_PG_CONNECTION_DIR: directory,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(directory, 'host'), 'utf8'), 'db.example.test');
    assert.equal(fs.readFileSync(path.join(directory, 'port'), 'utf8'), '6543');
    assert.equal(fs.readFileSync(path.join(directory, 'username'), 'utf8'), 'bulka_user');
    assert.equal(fs.readFileSync(path.join(directory, 'database'), 'utf8'), 'bulka_restore');
    assert.equal(fs.readFileSync(path.join(directory, 'sslmode'), 'utf8'), 'require');
    assert.equal(
      fs.readFileSync(path.join(directory, 'pgpass'), 'utf8'),
      'db.example.test:6543:bulka_restore:bulka_user:p@ss\\:word\n',
    );
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(directory, 'pgpass')).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('PostgreSQL helper rejects non-PostgreSQL URLs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-pg-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-pg-connection.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        BULKA_DATABASE_URL: 'https://user:password@example.test/database',
        BULKA_PG_CONNECTION_DIR: directory,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /password/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
