#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:-}
restore_url=${BULKA_RESTORE_DATABASE_URL:-}
restore_jobs=${BULKA_RESTORE_JOBS:-4}

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
if [[ ! $restore_jobs =~ ^[1-8]$ ]]; then
  echo 'BULKA_RESTORE_JOBS must be between 1 and 8.' >&2
  exit 1
fi

pg_restore --list "$archive" >/dev/null
if [[ ! -f $archive.sha256 ]]; then
  echo "Verified checksum sidecar is missing: $archive.sha256" >&2
  exit 1
fi
sha256sum --check --status "$archive.sha256" || {
  echo 'Restore archive checksum verification failed.' >&2
  exit 1
}
database_name=$(psql "$restore_url" -X -A -t -c 'select current_database()')
database_name=${database_name//$'\r'/}
database_name=${database_name//$'\n'/}
if [[ ! $database_name =~ (restore|recovery|drill) ]]; then
  echo "Refusing destructive restore into database '$database_name'." >&2
  exit 1
fi

existing_tables=$(psql "$restore_url" -X -A -t -v ON_ERROR_STOP=1 -c \
  "select count(*) from information_schema.tables where table_schema in ('auth', 'public')")
existing_tables=${existing_tables//$'\r'/}
existing_tables=${existing_tables//$'\n'/}
if [[ ! $existing_tables =~ ^[0-9]+$ ]] || ((existing_tables != 0)); then
  echo "Refusing restore into non-empty database '$database_name'." >&2
  exit 1
fi

psql "$restore_url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
SQL

restore_started=$(date +%s)
pg_restore \
  --dbname="$restore_url" \
  --schema=auth \
  --schema=public \
  --jobs="$restore_jobs" \
  --exit-on-error \
  --no-owner \
  --no-acl \
  "$archive"

metrics=$(psql "$restore_url" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "
  select
    (select count(*) from information_schema.tables where table_schema = 'public'),
    (select count(*) from information_schema.tables where table_schema = 'auth'),
    (select count(*) from public.bulka_schema_migrations),
    (select count(*) from public.kaspi_orders),
    (select count(*) from public.customers),
    (select count(*) from auth.users)
  where to_regclass('public.bulka_schema_migrations') is not null
    and to_regclass('public.kaspi_orders') is not null
    and to_regclass('public.customers') is not null
    and to_regclass('auth.users') is not null
")
metrics=${metrics//$'\r'/}
metrics=${metrics//$'\n'/}
if [[ ! $metrics =~ ^[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+$ ]]; then
  echo 'Restore completed but critical application tables are missing.' >&2
  exit 1
fi
IFS='|' read -r public_tables auth_tables migrations orders customers auth_users <<<"$metrics"
if ((public_tables < 1 || auth_tables < 1 || migrations < 1)); then
  echo 'Restore completed but its schema or migration ledger is incomplete.' >&2
  exit 1
fi
elapsed_seconds=$(( $(date +%s) - restore_started ))
printf \
  'Restore drill passed for %s in %ss (public=%s auth=%s migrations=%s orders=%s customers=%s auth_users=%s).\n' \
  "$database_name" \
  "$elapsed_seconds" \
  "$public_tables" \
  "$auth_tables" \
  "$migrations" \
  "$orders" \
  "$customers" \
  "$auth_users"
