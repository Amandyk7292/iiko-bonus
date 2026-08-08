# Database backup and recovery

Source-code rollback does not restore customer, order, payment, loyalty, or audit data. Production therefore needs both the managed Supabase recovery option and an independently verified database dump.

## Recovery objectives

- Target RPO: no more than 24 hours for the independent dump. Use Supabase PITR for a shorter RPO when the production plan supports it.
- Target RTO: 2 hours after an incident is declared.
- Keep at least 14 daily dumps and one independently encrypted off-site copy.
- Never restore a production dump into a developer laptop or an unencrypted shared folder.

## Daily backup

Run as a dedicated privileged service account from a systemd timer. Supply `SUPABASE_DB_URL` through a root-readable `EnvironmentFile`; do not place the URL directly in the unit command.

```bash
sudo --preserve-env=SUPABASE_DB_URL \
  /var/www/iiko-bonus/scripts/backup-database.sh
```

The script creates a PostgreSQL custom-format archive under `/var/backups/bulka-database`, verifies that `pg_restore` can read it, writes a SHA-256 sidecar, applies mode `0600`, and removes files older than the configured retention period.

Copy the verified archive and checksum to encrypted off-site storage. A backup that exists only on the application VPS is not disaster recovery.

## Independently encrypted off-site backup

The Windows operator workflow encrypts every recovery artifact before it becomes a retained backup:

- the production environment received over SSH/stdin;
- the latest database dump after its VPS SHA-256 sidecar has been verified;
- a tar archive containing the Supabase Storage manifest and objects.

Each `.bulka.enc` file uses a random AES-256-GCM content key. That key is wrapped with an externally escrowed RSA public key using RSA-OAEP-SHA256. The authenticated envelope contains a format version, artifact type, source name, creation time, and the SHA-256 fingerprint of the public key.

Encryption alone does not prove who created a backup: anyone holding the escrow public key can encrypt a replacement set. The workstation therefore signs a canonical manifest with a separate encrypted signing private key. The detached signature binds the exact encrypted SHA-256 and metadata-file SHA-256 for all three artifacts. `last-success.json` is published only after the signature is created and immediately verified using a separately pinned signing public key and both expected fingerprints.

Windows DPAPI `CurrentUser` is deliberately not used: a DPAPI-only copy cannot be recovered after loss of the workstation or Windows profile.

### Required independent keys

Two unrelated key pairs are mandatory; never reuse one pair for both purposes:

1. **Encryption escrow:** RSA-3072 or stronger. Create it on an offline recovery machine. Keep its encrypted private key/passphrase entirely off the backup workstation and maintain two tested copies on separately stored encrypted media. Install only its public PEM on the workstation.
2. **Sender signing:** preferably Ed25519 encrypted PKCS#8; RSA-PSS with RSA-3072 or stronger is also accepted. Install the encrypted private key only for the dedicated backup account, outside the repository, recovery, and staging directories. Disable ACL inheritance and grant access only to that account, `SYSTEM`, and Administrators. Escrow/pin its public key and fingerprint independently from the workstation and backup storage.

```text
C:\ProgramData\Bulka Backup\escrow-public.pem
C:\ProgramData\Bulka Backup\signing-public.pem
C:\ProgramData\Bulka Backup Private\signing-private.encrypted.pem
```

The repository does not generate, distribute, or retain either private key. Record both fingerprints in an offline recovery register. Inspect public keys before configuration:

```powershell
node .\scripts\backup-key-fingerprint.js `
  "--key=C:\ProgramData\Bulka Backup\escrow-public.pem" `
  --purpose=encryption-public
node .\scripts\backup-key-fingerprint.js `
  "--key=C:\ProgramData\Bulka Backup\signing-public.pem" `
  --purpose=signing-public
```

The signing private-key passphrase is accepted only through `BULKA_BACKUP_SIGNING_KEY_PASSPHRASE`. Provide it through the task account's protected secret facility/environment; never put it in task arguments, commands, source, or backup storage.

Run the backup from an independent Windows workstation with PowerShell 7, Node.js, OpenSSH (`ssh.exe`/`scp.exe`), `tar.exe`, the `bulka-vps` SSH alias, and unattended key-based SSH authentication:

```powershell
pwsh -NoProfile -File .\scripts\backup-offsite-windows.ps1 `
  -EscrowPublicKeyPath 'C:\ProgramData\Bulka Backup\escrow-public.pem' `
  -ExpectedEncryptionKeyFingerprintSha256 '<64 lowercase hex>' `
  -SigningPrivateKeyPath 'C:\ProgramData\Bulka Backup Private\signing-private.encrypted.pem' `
  -SigningPublicKeyPath 'C:\ProgramData\Bulka Backup\signing-public.pem' `
  -ExpectedSigningKeyFingerprintSha256 '<64 lowercase hex>'
```

Before downloading plaintext, the script validates regular/non-reparse key files, the private-key ACL and passphrase, and both keys against the explicitly configured fingerprints. A silently replaced public PEM therefore fails closed. Key rotation requires deliberate task reconfiguration with new expected fingerprints.

The script downloads plaintext only into a private, current-run staging directory under `%LOCALAPPDATA%\Bulka Backup\Staging`; it removes that exact directory in `finally`. The environment is streamed directly to the encryptor and is never written to a plaintext file. Before publication, the encryptor performs a full authenticated AES-GCM decrypt/hash self-test while the random content key is still in memory. Retention cleanup matches only exact encrypted artifacts, signed manifests, detached signatures, and metadata names.

Replicate `Bulka Recovery\Encrypted Backups` and `last-success.json` to a second independent location. Do not sync the staging directory. After a complete signed and encrypted set is published, the script removes exact legacy `Database Dumps`, `Storage Snapshots`, and `production-env-*.dpapi` artifacts. It refuses to report success if unrecognized plaintext content remains in those legacy locations. Preserve any legacy copy needed for legal retention by encrypting it separately before the first v3 run; do not rename arbitrary files to match the cleanup patterns.

### Scheduled execution

Use a dedicated Windows service account that owns its protected OpenSSH key/config and can run `ssh -o BatchMode=yes bulka-vps exit` without an interactive desktop, agent, or passphrase prompt. The installer creates a non-interactive password-logon task with three 15-minute retries, `StartWhenAvailable`, a six-hour limit, and `IgnoreNew` overlap protection. It refuses to replace an existing task unless `-Replace` is explicit and it does not start the task:

```powershell
$credential = Get-Credential 'MACHINE\BulkaBackup'
pwsh -NoProfile -File .\scripts\install-offsite-backup-task.ps1 `
  -Credential $credential `
  -EscrowPublicKeyPath 'C:\ProgramData\Bulka Backup\escrow-public.pem' `
  -ExpectedEncryptionKeyFingerprintSha256 '<64 lowercase hex>' `
  -SigningPrivateKeyPath 'C:\ProgramData\Bulka Backup Private\signing-private.encrypted.pem' `
  -SigningPublicKeyPath 'C:\ProgramData\Bulka Backup\signing-public.pem' `
  -ExpectedSigningKeyFingerprintSha256 '<64 lowercase hex>'
```

The passphrase is deliberately absent from the registered task command. Run the first backup under supervision. Confirm a fresh manifest plus `.signature.json`, inspect `senderAuthenticityVerified` in `last-success.json`, check the task result, and alert if no successful set is produced within 26 hours. Task registration is not proof that recovery works.

### Decrypt and restore

Decrypt only on an isolated, encrypted recovery host. Copy the three `.bulka.enc` files, their metadata, the set manifest, and detached signature there. Verify sender authenticity and every signed file hash before using an escrow decryption key. Obtain expected fingerprints from the offline recovery register, not from the backup directory:

```powershell
node .\scripts\verify-backup-set.js `
  --manifest=C:\Recovery\backup-set-YYYYMMDDTHHMMSSZ.json `
  --signature=C:\Recovery\backup-set-YYYYMMDDTHHMMSSZ.signature.json `
  --public-key=E:\Escrow\signing-public.pem `
  --expected-signing-key-fingerprint='<64 lowercase hex>' `
  --expected-encryption-key-fingerprint='<64 lowercase hex>'
```

Only after verification succeeds, supply the encrypted PKCS#8 RSA decryption key and put its passphrase in `BULKA_BACKUP_PRIVATE_KEY_PASSPHRASE` through the recovery host's secret facility; never place the passphrase in a command argument or shell history:

```powershell
node .\scripts\decrypt-backup-file.js `
  --input=C:\Recovery\database-YYYYMMDDTHHMMSSZ.bulka.enc `
  --output=C:\Recovery\bulka-YYYYMMDDTHHMMSSZ.dump `
  --private-key=E:\Escrow\bulka-backup-private.pem
```

The decryptor refuses an existing output, verifies the envelope fingerprint, and fails closed on any GCM authentication error. Compare the decryptor's `plaintextSha256` with `encryption.plaintextSha256` in the artifact metadata. For the database it must also equal `sourceSha256`. Decrypt the Storage artifact to a `.tar`, extract it into an empty private directory, and verify the included object manifest before any upload. Treat a decrypted environment file as a production secret and destroy the recovery copy after the incident.

## Monthly restore drill

Create an empty disposable database whose name contains `restore`, `recovery`, or `drill`. Never point this command at production. The drill verifies the dump checksum, restores the application-owned `auth` and `public` schemas, and validates the migration ledger plus critical customer and order tables. Supabase recreates its managed platform schemas; Storage objects are validated through the separate off-site Storage snapshot.

```bash
export BULKA_RESTORE_DATABASE_URL='postgresql://…/bulka_restore_drill'
export BULKA_RESTORE_CONFIRM='bulka-disposable-restore-target'
export BULKA_RESTORE_JOBS=4
./scripts/verify-database-restore.sh /var/backups/bulka-database/bulka-YYYYMMDDTHHMMSSZ.dump
```

On the Bulka VPS, the guarded runner creates the disposable database, records the result, and removes that exact database automatically:

```bash
bash ./scripts/run-database-restore-drill.sh \
  /home/deploy/.bulka-releases/database-backups/bulka-YYYYMMDDTHHMMSSZ.dump
```

Reports are stored under `/home/deploy/.bulka-releases/restore-drills`. Record the archive timestamp, elapsed restore time, table counts, operator, and outcome.

At least quarterly, perform the same drill from an off-site `.bulka.enc` database artifact using an escrowed private-key copy. This validates key custody, decryptability, second-location replication, and the database restore path together. Also extract a Storage artifact, select objects from every bucket, recompute their manifest SHA-256 values, and record the sample results. A VPS-only restore drill does not validate disaster recovery.

### Latest completed drill

- Completed: 5 August 2026 at 16:42 UTC by the guarded VPS runner.
- Archive: `bulka-20260805T022302Z.dump`; its SHA-256 sidecar was verified before restore.
- Disposable target: `bulka_restore_drill_20260805163927`.
- Result: succeeded in 165 seconds.
- Validated: 96 `public` tables, 23 `auth` tables, 71 migrations, 32 orders, 13 customers, and 12 authentication users.
- Cleanup: the disposable database was removed automatically; production was never used as a restore target.

## Incident sequence

1. Stop writes or enable maintenance mode.
2. Preserve logs and identify the incident timestamp.
3. Choose PITR or the latest verified dump based on the required recovery point.
4. Restore into a new database first; validate migrations, key tables, order counts, and payment reconciliation.
5. Switch application credentials only after validation.
6. Run `/readyz`, order/payment reconciliation, and customer/admin smoke tests.
7. Document data loss window and notify affected users when legally required.
