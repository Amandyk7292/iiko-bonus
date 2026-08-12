const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
  const pm2Logrotate = read('scripts/install-pm2-logrotate.sh');

  assert.match(deploy, /wait_for_health 'http:\/\/127\.0\.0\.1:3101\/readyz'/);
  assert.match(deploy, /enable-nginx-upstream-fallback\.sh/);
  assert.match(deploy, /pm2 reload iiko-bonus --update-env/);
  assert.match(deploy, /run_optional_privileged_task/);
  assert.match(deploy, /sudo -n true/);
  assert.match(deploy, /require_nginx_fallback/);
  assert.match(deploy, /nginx_fallback_ready/);
  assert.match(deploy, /BULKA_REQUIRE_NGINX_FALLBACK:-true/);
  assert.match(deploy, /Deployment stopped before production mutation/);
  assert.ok(
    deploy.indexOf(
      'require_nginx_fallback',
      deploy.indexOf('start_staging_release "$temporary_release"'),
    ) < deploy.indexOf('production_changed=1'),
    'fallback must be verified before production files can change',
  );
  assert.doesNotMatch(
    deploy,
    /\n\s*bash "\$temporary_release\/scripts\/enable-nginx-upstream-fallback\.sh"/,
  );
  assert.match(nginxFallback, /server 127\.0\.0\.1:3101 backup/);
  assert.match(nginxFallback, /nginx -t/);
  assert.match(nginxFallback, /trap rollback ERR/);
  assert.match(packageRelease, /enable-nginx-upstream-fallback\.sh/);
  assert.match(packageRelease, /install-database-backup-timer\.sh/);
  assert.match(packageRelease, /install-pm2-logrotate\.sh/);
  assert.match(deploy, /install-pm2-logrotate\.sh/);
  assert.match(deploy, /public\/taplink\/index\.html/);
  assert.match(deploy, /public\/taplink\/assets\/brand\/bulka_logo\.png/);
  assert.match(deploy, /public\/taplink\/assets\/fonts\/GolosText-Regular\.ttf/);
  assert.match(pm2Logrotate, /logrotate_version='3\.0\.0'/);
  assert.match(pm2Logrotate, /pm2 install "\$logrotate_package"/);
  assert.match(pm2Logrotate, /pm2-logrotate:max_size 20M/);
  assert.match(pm2Logrotate, /pm2-logrotate:retain 14/);
  assert.match(pm2Logrotate, /pm2-logrotate:compress true/);
  assert.match(packageRelease, /ensure-postgres-client\.sh/);
  assert.match(packageRelease, /bulka-ensure-postgres-client/);
  assert.match(packageRelease, /public\\taplink\\assets/);
  assert.match(packageRelease, /BulkaAndroid\\assets\\brand\\bulka_logo\.png/);
  assert.match(packageRelease, /GolosText-Regular\.ttf/);
  assert.match(packageRelease, /Montserrat-Regular-subset\.ttf/);
  assert.match(deploy, /configure_postgres_client/);
  assert.match(deploy, /postgresql\/17\/bin/);
  assert.match(read('scripts/ensure-postgres-client.sh'), /postgresql-client-\$client_major/);
  assert.doesNotMatch(read('scripts/ensure-postgres-client.sh'), /postgresql\/16\/bin/);
  assert.match(deploy, /start_staging_release "\$backup"/);
  assert.match(rollback, /start_staging_release/);
  assert.match(rollback, /pm2 delete iiko-bonus-staging/);
  assert.equal(
    (deploy.match(/STAFF_PUSH_REQUIRED=false/g) || []).length,
    2,
    'deployment staging and candidate preflight must explicitly disable required staff workers',
  );
  assert.equal(
    (rollback.match(/STAFF_PUSH_REQUIRED=false/g) || []).length,
    1,
    'rollback staging must explicitly disable required staff workers',
  );
});

test('deployment and rollback are exclusive, transactional and use one artifact inventory', () => {
  const deploy = read('scripts/deploy-release.sh');
  const rollback = read('scripts/rollback-vps.sh');
  const packageRelease = read('scripts/deploy-vps.ps1');
  const pm2Logrotate = read('scripts/install-pm2-logrotate.sh');
  const expectedScripts = [
    'activate-www-domain.sh',
    'apply-migrations.js',
    'backup-database.sh',
    'backup-supabase-storage.js',
    'configure-forte-widget-vps.sh',
    'configure-iiko-astana-vps.sh',
    'deploy-release.sh',
    'enable-nginx-upstream-fallback.sh',
    'ensure-postgres-client.sh',
    'harden-nginx-access-logs.sh',
    'harden-vps-ssh.sh',
    'install-database-backup-timer.sh',
    'install-pm2-logrotate.sh',
    'prepare-cloudflare-origin.sh',
    'prepare-pg-connection.js',
    'probe-iiko-city-profile.js',
    'rollback-vps.sh',
    'run-database-restore-drill.sh',
    'setup-google-wallet.js',
    'verify-database-restore.sh',
  ];

  assert.deepEqual(bashReleaseInventory(deploy), expectedScripts);
  assert.deepEqual(bashReleaseInventory(rollback), expectedScripts);
  assert.deepEqual(powerShellReleaseInventory(packageRelease), expectedScripts);
  assert.match(deploy, /Production deployment requires migration mode apply/);
  assert.doesNotMatch(deploy, /npm run db:migrate:check/);
  assert.match(packageRelease, /-SkipMigrations is retired/);
  assert.match(packageRelease, /\$migrationMode = 'apply'/);

  for (const script of [deploy, rollback, packageRelease]) {
    assert.doesNotMatch(script, /kaspi-pos-automation-main/i);
  }
  assert.match(packageRelease, /bulka-release-\$releaseId\.zip/);
  assert.match(packageRelease, /bulka-deploy-release-\$releaseId\.sh/);
  assert.match(packageRelease, /bulka-ensure-postgres-client-\$releaseId\.sh/);
  assert.doesNotMatch(packageRelease, /['"]\/tmp\/bulka-release\.zip['"]/);
  assert.match(deploy, /archive != "\/tmp\/bulka-release-\$\{release_id\}\.zip"/);
  assert.match(
    deploy,
    /postgres_installer != "\/tmp\/bulka-ensure-postgres-client-\$\{release_id\}\.sh"/,
  );
  assert.match(deploy, /launcher_script != "\/tmp\/bulka-deploy-release-\$\{release_id\}\.sh"/);
  assert.ok(
    deploy.indexOf('flock -n 9') < deploy.indexOf('bash "$postgres_installer"'),
    'the PostgreSQL installer must run under the deployment lock',
  );

  for (const script of [deploy, rollback]) {
    assert.match(script, /deployment_lock="\$release_store\/deployment\.lock"/);
    assert.match(script, /exec 9>"\$deployment_lock"/);
    assert.match(script, /flock -n 9/);
    assert.match(script, /another deployment or rollback holds the production lock/);
  }
  assert.match(rollback, /\.rollback-transaction-\$\{requested\}-\$\$/);
  assert.match(rollback, /restore_previous_release/);
  assert.match(rollback, /copy_release "\$transaction_backup" "\$project"/);
  assert.match(rollback, /write_current_release "\$current"/);
  assert.match(deploy, /write_current_release "\$previous_current_release"/);
  assert.match(deploy, /staging_changed=1[\s\S]*start_staging_release "\$temporary_release"/);
  assert.match(deploy, /restoring the previous staging release/);
  for (const script of [deploy, rollback]) {
    assert.match(script, /validate_copy_destination/);
    assert.match(script, /Refusing symlinked release artifact/);
  }
  assert.match(rollback, /Recovery snapshot retained at/);

  assert.match(pm2Logrotate, /pm2-logrotate@\$\{logrotate_version\}/);
  assert.match(pm2Logrotate, /chmod 0700/);
  assert.match(pm2Logrotate, /chmod 0600/);
  assert.match(pm2Logrotate, /secure_regular_file "\$pm2_home\/dump\.pm2"/);
  assert.match(pm2Logrotate, /! -L \$file/);
});

test('release payload permissions are normalized without touching runtime state', () => {
  const deploy = read('scripts/deploy-release.sh');
  const rollback = read('scripts/rollback-vps.sh');

  for (const script of [deploy, rollback]) {
    assert.match(script, /^#!\/usr\/bin\/env bash\r?\nset -Eeuo pipefail\r?\numask 022/m);
    const normalizer = extractBashFunction(script, 'normalize_release_payload_permissions');
    assert.match(normalizer, /find "\$\{payload_roots\[@\]\}" -type d -exec chmod 0755 -- \{\} \+/);
    assert.match(normalizer, /find "\$\{payload_roots\[@\]\}" -type f -exec chmod 0644 -- \{\} \+/);
    assert.match(normalizer, /Refusing symlinked release payload entry/);
    assert.match(normalizer, /index\.js[\s\S]*package\.json[\s\S]*release-manifest\.json/);
    assert.doesNotMatch(normalizer, /node_modules|\.env/);
  }

  assert.match(
    deploy,
    /unzip -oq "\$archive" -d "\$temporary_release"\r?\nnormalize_release_payload_permissions "\$temporary_release"/,
  );
  assert.match(
    deploy,
    /retain_previous_admin_assets "\$project" "\$temporary_release"\r?\nnormalize_release_payload_permissions "\$temporary_release"/,
  );
  assert.match(
    deploy,
    /copy_artifacts\(\)[\s\S]*normalize_release_payload_permissions "\$destination" \|\| return\r?\n\}/,
  );
  assert.match(
    rollback,
    /copy_release\(\)[\s\S]*normalize_release_payload_permissions "\$destination" \|\| return\r?\n\}/,
  );
  const targetNormalization = rollback.indexOf('normalize_release_payload_permissions "$target"');
  assert.notEqual(targetNormalization, -1, 'rollback target normalization is missing');
  assert.ok(
    targetNormalization < rollback.indexOf('copy_release "$target" "$project"'),
    'a stored rollback target must be made non-writable before it is promoted',
  );
});

test(
  'release permission normalizer converts Windows archive modes on Linux',
  { skip: process.platform === 'win32' ? 'POSIX mode assertions require Linux' : false },
  (t) => {
    const deploy = read('scripts/deploy-release.sh');
    const normalizer = extractBashFunction(deploy, 'normalize_release_payload_permissions');
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-release-permissions-'));
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

    const directories = [
      'src/nested',
      'public/app',
      'admin-ui/dist/assets',
      'admin-ui/node_modules/.bin',
      'scripts',
      'supabase/migrations',
      'node_modules/runtime',
    ];
    for (const relative of directories) {
      fs.mkdirSync(path.join(fixture, relative), { recursive: true, mode: 0o777 });
    }
    const payloadDirectories = [
      '',
      'src',
      'src/nested',
      'public',
      'public/app',
      'admin-ui',
      'admin-ui/dist',
      'admin-ui/dist/assets',
      'scripts',
      'supabase',
      'supabase/migrations',
    ];
    for (const relative of payloadDirectories) {
      fs.chmodSync(path.join(fixture, relative), 0o777);
    }
    const payloadFiles = [
      'src/nested/service.js',
      'public/app/index.html',
      'admin-ui/dist/assets/app.js',
      'scripts/deploy-release.sh',
      'supabase/migrations/20260812000000_example.sql',
      'index.js',
      'package.json',
      'package-lock.json',
      'supabase_schema.sql',
      'release-manifest.json',
    ];
    for (const relative of payloadFiles) {
      const absolute = path.join(fixture, relative);
      fs.writeFileSync(absolute, 'fixture\n', { mode: 0o666 });
      fs.chmodSync(absolute, 0o666);
    }
    const runtimeFile = path.join(fixture, 'node_modules/runtime/cache.bin');
    fs.writeFileSync(runtimeFile, 'runtime\n', { mode: 0o660 });
    fs.chmodSync(runtimeFile, 0o660);
    fs.chmodSync(path.dirname(runtimeFile), 0o770);
    const adminRuntimeTarget = path.join(fixture, 'admin-ui/node_modules/runtime-cli.js');
    fs.writeFileSync(adminRuntimeTarget, 'runtime cli\n', { mode: 0o660 });
    fs.chmodSync(adminRuntimeTarget, 0o660);
    const adminRuntimeLink = path.join(fixture, 'admin-ui/node_modules/.bin/runtime-cli');
    fs.symlinkSync('../runtime-cli.js', adminRuntimeLink);
    const envFile = path.join(fixture, '.env');
    fs.writeFileSync(envFile, 'SECRET=hidden\n', { mode: 0o600 });
    fs.chmodSync(envFile, 0o600);

    const runner = path.join(fixture, 'run-normalizer.sh');
    fs.writeFileSync(
      runner,
      [
        '#!/usr/bin/env bash',
        'set -Eeuo pipefail',
        'temporary_release=$1',
        "project='/var/empty/bulka-project'",
        "staging='/var/empty/bulka-staging'",
        "release_store='/var/empty/bulka-releases'",
        normalizer,
        'normalize_release_payload_permissions "$temporary_release"',
      ].join('\n'),
      { mode: 0o700 },
    );
    const result = spawnSync('bash', [runner, fixture], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const relative of payloadFiles) {
      assert.equal(posixMode(path.join(fixture, relative)), 0o644, relative);
    }
    for (const relative of payloadDirectories) {
      assert.equal(posixMode(path.join(fixture, relative)), 0o755, relative);
    }
    assert.equal(posixMode(runtimeFile), 0o660, 'node_modules file remains writable');
    assert.equal(
      posixMode(path.dirname(runtimeFile)),
      0o770,
      'node_modules directory is preserved',
    );
    assert.equal(posixMode(adminRuntimeTarget), 0o660, 'admin runtime file remains writable');
    assert.equal(
      fs.readlinkSync(adminRuntimeLink),
      '../runtime-cli.js',
      'admin runtime symlink is preserved',
    );
    assert.equal(posixMode(envFile), 0o600, '.env remains private and untouched');

    const payloadLink = path.join(fixture, 'src/nested/runtime-link');
    fs.symlinkSync('../../node_modules/runtime/cache.bin', payloadLink);
    const rejected = spawnSync('bash', [runner, fixture], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0, 'a symlink inside the immutable payload must be rejected');
    assert.match(rejected.stderr, /Refusing symlinked release payload entry/);
  },
);

test('deployment requires an attested immutable GitHub CI web artifact', () => {
  const packageRelease = read('scripts/deploy-vps.ps1');
  const provenance = read('scripts/check-release-provenance.js');
  const workflow = read('.github/workflows/ci.yml');

  assert.match(packageRelease, /--download-artifact \$ciArtifactArchive --json/);
  assert.match(packageRelease, /Install-CiWebArtifact/);
  assert.match(packageRelease, /SHA256SUMS/);
  assert.match(packageRelease, /Uninventoried file in CI artifact/);
  assert.match(packageRelease, /EmergencyBypassProvenanceGate/);
  assert.match(provenance, /ls-remote/);
  assert.match(provenance, /refs\/heads\/\$\{REQUIRED_BRANCH\}/);
  assert.match(provenance, /production-web-\$\{headSha\}/);
  assert.match(provenance, /artifact\.digest/);
  assert.match(provenance, /GITHUB_TOKEN with Actions: read permission is required/);
  assert.match(workflow, /name: production-web-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /artifacts\/production-web\/SHA256SUMS/);
  assert.match(workflow, /python scripts\/e2e-release-smoke\.py/);
});

test('production shell scripts pass bash syntax validation', () => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  for (const script of [
    'scripts/deploy-release.sh',
    'scripts/rollback-vps.sh',
    'scripts/install-pm2-logrotate.sh',
    'scripts/activate-www-domain.sh',
    'scripts/harden-vps-ssh.sh',
    'scripts/prepare-cloudflare-origin.sh',
  ]) {
    const result = spawnSync(bash, ['-n', script], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`);
  }
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
    'npm run db:migrate --',
  );
  assert.ok(
    backupIndex.backup < backupIndex.migration,
    'verified database backup must run before migrations',
  );

  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const commonEnv = {
    ...process.env,
    DATABASE_URL: ['postgres', '://backup-test:', 'placeholder', '@localhost:5432/bulka'].join(''),
  };
  const allowed = spawnSync(bash, ['scripts/backup-database.sh', '--validate-config'], {
    cwd: root,
    env: {
      ...commonEnv,
      BULKA_DATABASE_BACKUP_DIR: '/home/deploy/.bulka-releases/database-backups',
    },
    encoding: 'utf8',
  });
  assert.equal(allowed.status, 0, allowed.stderr);

  const unsafe = spawnSync(bash, ['scripts/backup-database.sh', '--validate-config'], {
    cwd: root,
    env: {
      ...commonEnv,
      BULKA_DATABASE_BACKUP_DIR: '/tmp/bulka-backups',
    },
    encoding: 'utf8',
  });
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
  assert.match(server, /registerWorker\('whatsapp-session-cleanup'/);
  assert.match(server, /cleanupExpiredWhatsAppSessions/);
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

function extractBashFunction(script, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = script.match(new RegExp(`(${escapedName}\\(\\) \\{[\\s\\S]*?\\n\\})\\n\\n`));
  assert.ok(match, `${name} is missing`);
  return match[1];
}

function posixMode(file) {
  return fs.statSync(file).mode & 0o777;
}

function bashReleaseInventory(script) {
  const match = script.match(/release_scripts=\(\r?\n([\s\S]*?)\r?\n\)/);
  assert.ok(match, 'bash release inventory is missing');
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function powerShellReleaseInventory(script) {
  const match = script.match(/foreach \(\$scriptName in @\(\r?\n([\s\S]*?)\r?\n\)\)/);
  assert.ok(match, 'PowerShell release inventory is missing');
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^'|'[,]?$/g, ''))
    .filter(Boolean);
}
