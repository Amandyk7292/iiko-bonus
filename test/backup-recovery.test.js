const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readScript = (filename) =>
  fs.readFileSync(path.join(root, 'scripts', filename), 'utf8');

test('database backup workflow produces verifiable encrypted-at-rest candidates', () => {
  const backup = readScript('backup-database.sh');
  const restore = readScript('verify-database-restore.sh');
  const drill = readScript('run-database-restore-drill.sh');
  const timer = readScript('install-database-backup-timer.sh');

  assert.match(backup, /pg_dump/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /\.partial/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /RETENTION_DAYS/);
  assert.match(restore, /BULKA_RESTORE_CONFIRM/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /restore\|recovery\|drill/);
  assert.match(restore, /sha256sum --check --status/);
  assert.match(restore, /--schema=auth/);
  assert.match(restore, /--schema=public/);
  assert.match(restore, /--exit-on-error/);
  assert.match(restore, /create publication supabase_realtime/);
  assert.match(restore, /public\.bulka_schema_migrations/);
  assert.match(restore, /public\.kaspi_orders/);
  assert.match(restore, /auth\.users/);
  assert.match(drill, /bulka_restore_drill_/);
  assert.match(drill, /createdb/);
  assert.match(drill, /dropdb/);
  assert.match(drill, /restore-drills/);
  assert.match(drill, /succeeded/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /OnCalendar=.*02:15:00 UTC/);
  assert.match(timer, /backup-database\.sh/);
});

test('off-site backup and deployment keep recovery independent from the VPS', () => {
  const offsite = readScript('backup-offsite-windows.ps1');
  const deploy = readScript('deploy-release.sh');

  assert.match(offsite, /bulka-vps/);
  assert.match(offsite, /ConvertFrom-SecureString/);
  assert.match(offsite, /DPAPI/);
  assert.match(offsite, /backup-supabase-storage\.js/);
  assert.match(offsite, /sha256/);
  assert.match(deploy, /quarantine_legacy_migrations/);
  assert.match(deploy, /legacy-migrations/);
  assert.match(deploy, /\/var\/www\/iiko-bonus/);
});

test('the legacy top-level migration directory contains no SQL artifacts', () => {
  const legacyDir = path.join(root, 'migrations');
  if (!fs.existsSync(legacyDir)) return;

  const sqlFiles = fs
    .readdirSync(legacyDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));
  assert.deepEqual(sqlFiles, []);
});
