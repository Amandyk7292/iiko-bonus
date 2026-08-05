#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

archive=${1:-}
source_env_file=${BULKA_RESTORE_SOURCE_ENV_FILE:-/var/www/iiko-bonus/.env}
report_root=${BULKA_RESTORE_REPORT_DIR:-/home/deploy/.bulka-releases/restore-drills}
source_url=${SUPABASE_DB_URL:-${DATABASE_URL:-${POSTGRES_URL:-}}}

if [[ -z $archive || ! -f $archive ]]; then
  echo 'Usage: run-database-restore-drill.sh /absolute/path/to/bulka-*.dump' >&2
  exit 1
fi
case "$report_root" in
  /home/deploy/.bulka-releases/restore-drills) ;;
  *) echo "Unsafe restore drill report directory: $report_root" >&2; exit 1 ;;
esac

portable_root=/home/deploy/.bulka-tools/postgresql
portable_bin="$portable_root/usr/lib/postgresql/17/bin"
portable_lib="$portable_root/usr/lib/x86_64-linux-gnu"
if ! command -v createdb >/dev/null ||
  ! command -v dropdb >/dev/null ||
  ! command -v pg_restore >/dev/null ||
  ! command -v psql >/dev/null; then
  if [[ ! -x $portable_bin/createdb ||
    ! -x $portable_bin/dropdb ||
    ! -x $portable_bin/pg_restore ||
    ! -x $portable_bin/psql ]]; then
    echo 'PostgreSQL client tools are required.' >&2
    exit 1
  fi
  export PATH="$portable_bin:$PATH"
  export LD_LIBRARY_PATH="$portable_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

if [[ -z $source_url ]]; then
  if [[ ! -f $source_env_file ]]; then
    echo 'A source database URL or BULKA_RESTORE_SOURCE_ENV_FILE is required.' >&2
    exit 1
  fi
  source_url=$(
    SOURCE_ENV_FILE="$source_env_file" node -e "
      const fs = require('node:fs');
      const path = require('node:path');
      const envFile = process.env.SOURCE_ENV_FILE;
      const dotenv = require(path.join(path.dirname(envFile), 'node_modules', 'dotenv'));
      const values = dotenv.parse(fs.readFileSync(envFile));
      process.stdout.write(
        values.SUPABASE_DB_URL || values.DATABASE_URL || values.POSTGRES_URL || '',
      );
    "
  )
fi
if [[ -z $source_url ]]; then
  echo 'The source database URL is missing.' >&2
  exit 1
fi

timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
database_name="bulka_restore_drill_$(date -u +'%Y%m%d%H%M%S')"
if [[ ! $database_name =~ ^bulka_restore_drill_[0-9]{14}$ ]]; then
  echo 'Unsafe disposable database name.' >&2
  exit 1
fi
restore_url=$(
  SOURCE_DATABASE_URL="$source_url" RESTORE_DATABASE_NAME="$database_name" node -e "
    const url = new URL(process.env.SOURCE_DATABASE_URL);
    url.pathname = '/' + process.env.RESTORE_DATABASE_NAME;
    process.stdout.write(url.toString());
  "
)

install -d -m 0700 -- "$report_root"
log_file="$report_root/$timestamp.log"
status_file="$report_root/$timestamp.status"
printf 'running\n' >"$status_file"
printf 'Restore drill %s started for %s.\n' "$timestamp" "$(basename "$archive")" >"$log_file"

created=false
cleanup() {
  exit_code=$?
  if [[ $created == true ]]; then
    if dropdb --maintenance-db="$source_url" --force "$database_name" >>"$log_file" 2>&1; then
      printf 'Disposable database removed: %s\n' "$database_name" >>"$log_file"
    else
      printf 'Disposable database cleanup failed: %s\n' "$database_name" >>"$log_file"
    fi
  fi
  if ((exit_code != 0)); then
    printf 'failed\n' >"$status_file"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

createdb --maintenance-db="$source_url" "$database_name"
created=true
printf 'Disposable database created: %s\n' "$database_name" >>"$log_file"

if ! BULKA_RESTORE_DATABASE_URL="$restore_url" \
  BULKA_RESTORE_CONFIRM='bulka-disposable-restore-target' \
  BULKA_RESTORE_JOBS="${BULKA_RESTORE_JOBS:-4}" \
  bash "$(dirname "$0")/verify-database-restore.sh" "$archive" >>"$log_file" 2>&1; then
  tail -n 80 "$log_file" >&2
  exit 1
fi

dropdb --maintenance-db="$source_url" --force "$database_name"
created=false
printf 'Disposable database removed: %s\n' "$database_name" >>"$log_file"
printf 'succeeded\n' >"$status_file"
tail -n 20 "$log_file"
