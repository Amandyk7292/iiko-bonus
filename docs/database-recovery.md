# Database backup and recovery

Source-code rollback does not restore customer, order, payment, loyalty, or audit data. Production therefore needs both the managed Supabase recovery option and an independently verified database dump.

## Recovery objectives

- Target RPO: no more than 24 hours for the independent dump. Use Supabase PITR for a shorter RPO when the production plan supports it.
- Target RTO: 2 hours after an incident is declared.
- Keep at least 14 daily dumps and one off-site encrypted copy.
- Never restore a production dump into a developer laptop or an unencrypted shared folder.

## Daily backup

Run as a dedicated privileged service account from a systemd timer. Supply `SUPABASE_DB_URL` through a root-readable `EnvironmentFile`; do not place the URL directly in the unit command.

```bash
sudo --preserve-env=SUPABASE_DB_URL \
  /var/www/iiko-bonus/scripts/backup-database.sh
```

The script creates a PostgreSQL custom-format archive under `/var/backups/bulka-database`, verifies that `pg_restore` can read it, writes a SHA-256 sidecar, applies mode `0600`, and removes files older than the configured retention period.

Copy the verified archive and checksum to encrypted off-site storage. A backup that exists only on the application VPS is not disaster recovery.

The Windows operator backup script pulls the latest verified dump and checksum through the `bulka-vps` SSH alias, snapshots Supabase Storage using the service role key over stdin, and encrypts the environment snapshot with the current Windows user's DPAPI. Run it from an independent workstation, then replicate the resulting `Bulka Recovery` directory to a second protected location.

```powershell
pwsh -File .\scripts\backup-offsite-windows.ps1
```

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

## Incident sequence

1. Stop writes or enable maintenance mode.
2. Preserve logs and identify the incident timestamp.
3. Choose PITR or the latest verified dump based on the required recovery point.
4. Restore into a new database first; validate migrations, key tables, order counts, and payment reconciliation.
5. Switch application credentials only after validation.
6. Run `/readyz`, order/payment reconciliation, and customer/admin smoke tests.
7. Document data loss window and notify affected users when legally required.
