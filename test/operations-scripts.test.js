const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('release deployment keeps a healthy staging fallback during graceful reload', () => {
  const deploy = read('scripts/deploy-release.sh');
  const rollback = read('scripts/rollback-vps.sh');
  const packageRelease = read('scripts/deploy-vps.ps1');
  const nginxFallback = read('scripts/enable-nginx-upstream-fallback.sh');

  assert.match(deploy, /wait_for_health 'http:\/\/127\.0\.0\.1:3101\/readyz'/);
  assert.match(deploy, /enable-nginx-upstream-fallback\.sh/);
  assert.match(deploy, /pm2 reload iiko-bonus --update-env/);
  assert.match(deploy, /run_optional_privileged_task/);
  assert.match(deploy, /sudo -n true/);
  assert.doesNotMatch(
    deploy,
    /\n\s*bash "\$temporary_release\/scripts\/enable-nginx-upstream-fallback\.sh"/,
  );
  assert.match(nginxFallback, /server 127\.0\.0\.1:3101 backup/);
  assert.match(nginxFallback, /nginx -t/);
  assert.match(nginxFallback, /trap rollback ERR/);
  assert.match(packageRelease, /enable-nginx-upstream-fallback\.sh/);
  assert.match(packageRelease, /install-database-backup-timer\.sh/);
  assert.match(packageRelease, /ensure-postgres-client\.sh/);
  assert.match(packageRelease, /bulka-ensure-postgres-client/);
  assert.match(deploy, /configure_postgres_client/);
  assert.match(deploy, /start_staging_release "\$backup"/);
  assert.match(rollback, /start_staging_release/);
  assert.match(rollback, /pm2 delete iiko-bonus-staging/);
});

test('database backups are private, verified and restricted to dedicated storage', () => {
  const backup = read('scripts/backup-database.sh');
  const restore = read('scripts/verify-database-restore.sh');
  const installer = read('scripts/install-database-backup-timer.sh');

  assert.match(backup, /umask 077/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /chmod 0600/);
  assert.match(backup, /\/var\/backups\/bulka-database/);
  assert.match(restore, /bulka-disposable-restore-target/);
  assert.match(restore, /\(restore\|recovery\|drill\)/);
  assert.match(installer, /ProtectSystem=strict/);
  assert.match(installer, /systemctl enable --now bulka-database-backup\.timer/);

  const backupIndex = deployScriptIndex(
    read('scripts/deploy-release.sh'),
    'create_pre_migration_backup',
    "npm run db:migrate --",
  );
  assert.ok(
    backupIndex.backup < backupIndex.migration,
    'verified database backup must run before migrations',
  );

  const bash =
    process.platform === 'win32'
      ? 'C:\\Program Files\\Git\\bin\\bash.exe'
      : 'bash';
  const commonEnv = {
    ...process.env,
    DATABASE_URL: ['postgres', '://backup-test:', 'placeholder', '@localhost:5432/bulka'].join(''),
  };
  const allowed = spawnSync(
    bash,
    ['scripts/backup-database.sh', '--validate-config'],
    {
      cwd: root,
      env: {
        ...commonEnv,
        BULKA_DATABASE_BACKUP_DIR:
          '/home/deploy/.bulka-releases/database-backups',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(allowed.status, 0, allowed.stderr);

  const unsafe = spawnSync(
    bash,
    ['scripts/backup-database.sh', '--validate-config'],
    {
      cwd: root,
      env: {
        ...commonEnv,
        BULKA_DATABASE_BACKUP_DIR: '/tmp/bulka-backups',
      },
      encoding: 'utf8',
    },
  );
  assert.notEqual(unsafe.status, 0);
});

test('secret scanner never prints a detected credential value', () => {
  const scanner = read('scripts/check-secrets.js');
  assert.match(scanner, /values are intentionally hidden/);
  assert.doesNotMatch(scanner, /console\.error\([^)]*match\[2\]/);
  assert.match(scanner, /blockedSecretContainerExtensions/);
  assert.match(scanner, /private-key-container/);
  assert.doesNotMatch(scanner, /ignoredExtensions[\s\S]*'\.pem'/);
  assert.doesNotMatch(scanner, /ignoredExtensions[\s\S]*'\.p8'/);
});

test('production server drains requests and monitors payment providers', () => {
  const server = read('src/server.js');

  assert.match(server, /runScheduledSafeProbe/);
  assert.match(server, /registerWorker\('payment-provider-probe'/);
  assert.match(server, /server\.close\(/);
  assert.match(server, /process\.once\('SIGTERM'/);
  assert.match(server, /process\.once\('SIGINT'/);
  assert.match(server, /SHUTDOWN_GRACE_MS/);
});

function deployScriptIndex(script, backupNeedle, migrationNeedle) {
  return {
    backup: script.lastIndexOf(backupNeedle, script.indexOf(migrationNeedle)),
    migration: script.indexOf(migrationNeedle),
  };
}
