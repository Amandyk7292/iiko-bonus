#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:-}
restore_url=${BULKA_RESTORE_DATABASE_URL:-}

if [[ -z $archive || ! -f $archive ]]; then
  echo 'Usage: verify-database-restore.sh /absolute/path/to/bulka-*.dump' >&2
  exit 1
fi
if [[ ${BULKA_RESTORE_CONFIRM:-} != 'bulka-disposable-restore-target' ]]; then
  echo 'Set BULKA_RESTORE_CONFIRM=bulka-disposable-restore-target.' >&2
  exit 1
fi
if [[ -z $restore_url ]]; then
  echo 'BULKA_RESTORE_DATABASE_URL is required and must point to a disposable database.' >&2
  exit 1
fi
command -v pg_restore >/dev/null && command -v psql >/dev/null || {
  echo 'pg_restore and psql are required.' >&2
  exit 1
}

pg_restore --list "$archive" >/dev/null
database_name=$(psql "$restore_url" -X -A -t -c 'select current_database()')
database_name=${database_name//$'\r'/}
database_name=${database_name//$'\n'/}
if [[ ! $database_name =~ (restore|recovery|drill) ]]; then
  echo "Refusing destructive restore into database '$database_name'." >&2
  exit 1
fi

pg_restore \
  --dbname="$restore_url" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$archive"

table_count=$(psql "$restore_url" -X -A -t -c \
  "select count(*) from information_schema.tables where table_schema = 'public'")
if [[ ! $table_count =~ ^[0-9]+$ ]] || ((table_count < 1)); then
  echo 'Restore completed but no public tables were found.' >&2
  exit 1
fi
printf 'Restore drill passed for %s (%s public tables).\n' "$database_name" "$table_count"
