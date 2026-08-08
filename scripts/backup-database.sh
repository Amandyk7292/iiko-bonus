#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

mode=${1:-backup}
database_url=${SUPABASE_DB_URL:-${DATABASE_URL:-${POSTGRES_URL:-}}}
backup_root=${BULKA_DATABASE_BACKUP_DIR:-/var/backups/bulka-database}
retention_days=${BULKA_DATABASE_BACKUP_RETENTION_DAYS:-14}
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
archive="${backup_root}/bulka-${timestamp}.dump"
temporary="${archive}.partial"

if [[ $mode != 'backup' && $mode != '--validate-config' ]]; then
  echo 'Usage: backup-database.sh [--validate-config]' >&2
  exit 1
fi
if [[ -z $database_url ]]; then
  echo 'SUPABASE_DB_URL (or DATABASE_URL/POSTGRES_URL) is required.' >&2
  exit 1
fi
if [[ ! $backup_root =~ ^/var/backups/bulka-database(/[A-Za-z0-9._-]+)*$ ]] &&
  [[ ! $backup_root =~ ^/home/deploy/\.bulka-releases/database-backups(/[A-Za-z0-9._-]+)*$ ]]; then
  echo "Unsafe backup directory: $backup_root" >&2
  exit 1
fi
if [[ ! $retention_days =~ ^[0-9]+$ ]] || ((retention_days < 1 || retention_days > 365)); then
  echo 'BULKA_DATABASE_BACKUP_RETENTION_DAYS must be between 1 and 365.' >&2
  exit 1
fi
if [[ $mode == '--validate-config' ]]; then
  echo 'Database backup configuration is valid.'
  exit 0
fi
command -v pg_dump >/dev/null || {
  echo 'pg_dump is required.' >&2
  exit 1
}

install -d -m 0700 -- "$backup_root"
connection_dir=$(mktemp -d)
trap 'rm -rf -- "$connection_dir"; rm -f -- "$temporary"' EXIT

BULKA_DATABASE_URL="$database_url" \
  BULKA_PG_CONNECTION_DIR="$connection_dir" \
  node "$(dirname "$0")/prepare-pg-connection.js"
export PGPASSFILE="$connection_dir/pgpass"
pg_host=$(<"$connection_dir/host")
pg_port=$(<"$connection_dir/port")
pg_user=$(<"$connection_dir/username")
pg_database=$(<"$connection_dir/database")
pg_sslmode=$(<"$connection_dir/sslmode")
if [[ -n $pg_sslmode ]]; then export PGSSLMODE="$pg_sslmode"; fi

PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-10} pg_dump \
  --host="$pg_host" \
  --port="$pg_port" \
  --username="$pg_user" \
  --dbname="$pg_database" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$temporary"

pg_restore --list "$temporary" >/dev/null
chmod 0600 "$temporary"
mv -- "$temporary" "$archive"
sha256sum "$archive" >"${archive}.sha256"
chmod 0600 "${archive}.sha256"

resolved_root=$(realpath -m -- "$backup_root")
case "$resolved_root" in
  /var/backups/bulka-database | /var/backups/bulka-database/*) ;;
  /home/deploy/.bulka-releases/database-backups | /home/deploy/.bulka-releases/database-backups/*) ;;
  *)
    echo "Refusing retention cleanup outside Bulka backup storage: $resolved_root" >&2
    exit 1
    ;;
esac
find "$resolved_root" -maxdepth 1 -type f \
  \( -name 'bulka-*.dump' -o -name 'bulka-*.dump.sha256' \) \
  -mtime "+$retention_days" -delete

printf 'Database backup verified: %s\n' "$archive"
