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
  const envelope = readScript('lib/backup-envelope.js');
  const decryptor = readScript('decrypt-backup-file.js');
  const signer = readScript('sign-backup-manifest.js');
  const verifier = readScript('verify-backup-set.js');
  const signature = readScript('lib/backup-signature.js');
  const taskInstaller = readScript('install-offsite-backup-task.ps1');
  const deploy = readScript('deploy-release.sh');

  assert.match(offsite, /bulka-vps/);
  assert.doesNotMatch(offsite, /ConvertFrom-SecureString/);
  assert.doesNotMatch(offsite, /Windows DPAPI CurrentUser/);
  assert.match(offsite, /EscrowPublicKeyPath/);
  assert.match(offsite, /selfTestAuthenticatedDecrypt/);
  assert.match(offsite, /Remove-LegacyRecoveryArtifacts/);
  assert.match(offsite, /dedicated child directory named for Bulka backup\/recovery/);
  assert.match(offsite, /Backup keys must be regular files/);
  assert.match(offsite, /Protected backup path must be a real directory/);
  assert.match(offsite, /ExpectedEncryptionKeyFingerprintSha256/);
  assert.match(offsite, /ExpectedSigningKeyFingerprintSha256/);
  assert.match(offsite, /Signing private-key ACL inheritance must be disabled/);
  assert.match(offsite, /Plaintext or machine-bound legacy recovery artifacts remain/);
  const legacyCleanup = offsite.slice(
    offsite.indexOf('function Remove-LegacyRecoveryArtifacts'),
    offsite.indexOf('function Write-BackupMetadata'),
  );
  assert.ok(
    legacyCleanup.indexOf('Legacy backup preflight failed') <
      legacyCleanup.indexOf('foreach ($target in $legacyStorageTargets)'),
    'legacy cleanup must finish preflight before deleting recognized backups',
  );
  assert.ok(
    offsite.indexOf('$encryptedSetComplete = $true') <
      offsite.lastIndexOf('    Remove-LegacyRecoveryArtifacts'),
    'a completed encrypted set must survive legacy-retirement failures',
  );
  assert.match(offsite, /backup-supabase-storage\.js/);
  assert.match(offsite, /Encrypted Backups/);
  assert.match(envelope, /RSA-OAEP-SHA256\+AES-256-GCM/);
  assert.match(envelope, /aes-256-gcm/);
  assert.match(envelope, /modulusLength.*3072/s);
  assert.match(envelope, /Authenticated backup self-test decrypt failed/);
  assert.doesNotMatch(envelope, /generateKeyPair/);
  assert.match(decryptor, /BULKA_BACKUP_PRIVATE_KEY_PASSPHRASE/);
  assert.match(signer, /BULKA_BACKUP_SIGNING_KEY_PASSPHRASE/);
  assert.doesNotMatch(signer, /--[^\n]*passphrase/i);
  assert.match(verifier, /expected-signing-key-fingerprint/);
  assert.match(verifier, /expected-encryption-key-fingerprint/);
  assert.match(signature, /BULKA-BACKUP-MANIFEST-SIGNATURE-V1/);
  assert.match(signature, /metadataSha256/);
  assert.doesNotMatch(signature, /generateKeyPair/);
  assert.ok(
    offsite.lastIndexOf('$verification = $verifyOutput | ConvertFrom-Json') <
      offsite.lastIndexOf('$encryptedSetComplete = $true'),
    'backup set must be signature-verified before it is complete',
  );
  assert.ok(
    offsite.lastIndexOf('$encryptedSetComplete = $true') <
      offsite.lastIndexOf('[IO.File]::Move($lastSuccessPartial'),
    'last-success must only publish after authenticated-set completion',
  );
  assert.match(taskInstaller, /LogonType Password/);
  assert.match(taskInstaller, /RestartCount 3/);
  assert.match(taskInstaller, /MultipleInstances IgnoreNew/);
  assert.match(taskInstaller, /already exists.*-Replace/s);
  assert.match(taskInstaller, /ExpectedEncryptionKeyFingerprintSha256/);
  assert.match(taskInstaller, /ExpectedSigningKeyFingerprintSha256/);
  assert.doesNotMatch(taskInstaller, /SIGNING_KEY_PASSPHRASE/);
  assert.doesNotMatch(taskInstaller, /Start-ScheduledTask/);
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
