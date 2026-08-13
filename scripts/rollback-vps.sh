#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

project=${BULKA_PROJECT_DIR:-/var/www/iiko-bonus}
staging=${BULKA_STAGING_DIR:-/home/deploy/iiko-bonus-staging/current}
release_store=${BULKA_RELEASE_STORE:-/home/deploy/.bulka-releases}
requested=${1:-}
current=''
transaction_backup=''
production_changed=0
production_stopped=0

release_scripts=(
  activate-www-domain.sh
  apply-migrations.js
  backup-database.sh
  backup-supabase-storage.js
  configure-forte-widget-vps.sh
  configure-iiko-astana-vps.sh
  deploy-release.sh
  enable-nginx-upstream-fallback.sh
  ensure-postgres-client.sh
  harden-nginx-access-logs.sh
  harden-vps-ssh.sh
  install-database-backup-timer.sh
  install-pm2-logrotate.sh
  prepare-cloudflare-origin.sh
  prepare-pg-connection.js
  probe-iiko-city-profile.js
  rollback-vps.sh
  run-database-restore-drill.sh
  setup-google-wallet.js
  verify-database-restore.sh
)

case "$project" in
  /var/www/iiko-bonus) ;;
  *) echo "Unsafe project directory: $project" >&2; exit 1 ;;
esac
case "$release_store" in
  /home/deploy/.bulka-releases) ;;
  *) echo "Unsafe release store: $release_store" >&2; exit 1 ;;
esac
case "$staging" in
  /home/deploy/iiko-bonus-staging/current) ;;
  *) echo "Unsafe staging directory: $staging" >&2; exit 1 ;;
esac

command -v flock >/dev/null || {
  echo 'Rollback stopped: the flock command is required.' >&2
  exit 1
}
mkdir -p "$release_store"
deployment_lock="$release_store/deployment.lock"
exec 9>"$deployment_lock"
if ! flock -n 9; then
  echo 'Rollback busy: another deployment or rollback holds the production lock.' >&2
  exit 75
fi

validate_copy_destination() {
  local destination=$1
  local relative
  local resolved_destination
  [[ ! -L $destination ]] || {
    echo "Refusing symlinked release destination: $destination" >&2
    return 1
  }
  resolved_destination=$(realpath -m -- "$destination")
  case "$resolved_destination" in
    "$project"|"$staging"|"$release_store"/*) ;;
    *) echo "Refusing unmanaged release destination: $resolved_destination" >&2; return 1 ;;
  esac
  for relative in \
    src public admin-ui admin-ui/dist scripts supabase supabase/migrations \
    index.js package.json package-lock.json supabase_schema.sql release-manifest.json; do
    [[ ! -L "$destination/$relative" ]] || {
      echo "Refusing symlinked release artifact: $destination/$relative" >&2
      return 1
    }
  done
}

# Normalize only immutable release files. In particular, do not traverse the
# root or admin-ui node_modules trees, whose writable directories and symlinks
# are created by npm rather than copied from the release payload.
normalize_release_payload_permissions() {
  local root=$1
  local relative
  local resolved_root
  local unexpected_symlink
  local -a payload_roots=()
  local -a required_directories=(
    src
    public
    admin-ui
    admin-ui/dist
    scripts
    supabase
    supabase/migrations
  )
  local -a root_files=(
    index.js
    package.json
    package-lock.json
    supabase_schema.sql
    release-manifest.json
  )

  [[ -d $root && ! -L $root ]] || {
    echo "Refusing invalid release payload root: $root" >&2
    return 1
  }
  resolved_root=$(realpath -m -- "$root")
  case "$resolved_root" in
    "$project"|"$staging"|"$release_store"/*) ;;
    *) echo "Refusing to normalize unmanaged release payload: $resolved_root" >&2; return 1 ;;
  esac

  for relative in "${required_directories[@]}"; do
    [[ -d "$root/$relative" && ! -L "$root/$relative" ]] || {
      echo "Refusing invalid release payload directory: $root/$relative" >&2
      return 1
    }
  done
  payload_roots=(
    "$root/src"
    "$root/public"
    "$root/admin-ui/dist"
    "$root/scripts"
    "$root/supabase/migrations"
  )
  unexpected_symlink=$(find "${payload_roots[@]}" -type l -print -quit)
  if [[ -n $unexpected_symlink ]]; then
    echo "Refusing symlinked release payload entry: $unexpected_symlink" >&2
    return 1
  fi

  chmod 0755 -- "$root" "$root/admin-ui" "$root/supabase" || return
  find "${payload_roots[@]}" -type d -exec chmod 0755 -- {} + || return
  find "${payload_roots[@]}" -type f -exec chmod 0644 -- {} + || return
  for relative in "${root_files[@]}"; do
    [[ -f "$root/$relative" && ! -L "$root/$relative" ]] || {
      echo "Refusing invalid release payload file: $root/$relative" >&2
      return 1
    }
    chmod 0644 -- "$root/$relative" || return
  done
}

copy_release() {
  local source=$1
  local destination=$2
  local script
  local -a script_filters=()
  validate_copy_destination "$destination" || return
  mkdir -p \
    "$destination/public" \
    "$destination/admin-ui" \
    "$destination/scripts" \
    "$destination/supabase" || return
  rsync -a --delete "$source/src/" "$destination/src/" || return
  rsync -a --delete \
    "$source/supabase/migrations/" \
    "$destination/supabase/migrations/" || return
  rsync -a --delete "$source/public/" "$destination/public/" || return
  rsync -a --delete \
    "$source/admin-ui/dist/" \
    "$destination/admin-ui/dist/" || return
  for script in "${release_scripts[@]}"; do
    script_filters+=(--include="/$script")
  done
  rsync -a --delete --delete-excluded \
    "${script_filters[@]}" --exclude='*' \
    "$source/scripts/" "$destination/scripts/" || return
  cp \
    "$source/index.js" \
    "$source/package.json" \
    "$source/package-lock.json" \
    "$source/supabase_schema.sql" \
    "$destination/" || return
  if [[ -f "$source/release-manifest.json" ]]; then
    cp "$source/release-manifest.json" "$destination/release-manifest.json" || return
  else
    cat >"$destination/release-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "releaseId": "legacy-rollback-snapshot",
  "commitSha": "0000000000000000000000000000000000000000",
  "branch": "legacy",
  "builtAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "migrationMode": "unknown",
  "source": "rollback-transaction-backup"
}
EOF
    [[ $? -eq 0 ]] || return
  fi
  normalize_release_payload_permissions "$destination" || return
}

wait_for_health() {
  local url=$1
  local attempts=${2:-20}
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

reload_production() {
  if env HOST=127.0.0.1 pm2 reload iiko-bonus --update-env; then
    return 0
  fi
  echo 'PM2 reload was unavailable; falling back to a guarded restart.' >&2
  env HOST=127.0.0.1 pm2 restart iiko-bonus --update-env
}

start_staging_release() {
  local source=$1
  pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
  mkdir -p "$staging" || return
  copy_release "$source" "$staging" || return
  ln -sfn "$project/.env" "$staging/.env" || return
  (
    cd "$staging" &&
      npm ci --omit=dev --no-audit --no-fund &&
      env \
        NODE_ENV=production \
        HOST=127.0.0.1 \
        PORT=3101 \
        RUN_BOTS=false \
        RUN_BACKGROUND_WORKERS=false \
        STAFF_PUSH_REQUIRED=false \
        RUN_WHATSAPP_OUTBOX_WORKER=false \
        RUN_YANDEX_DELIVERY_WORKER=false \
        YANDEX_DELIVERY_ENABLED=false \
        GEMINI_ASSISTANT_ENABLED=false \
        pm2 start src/server.js --name iiko-bonus-staging --cwd "$staging" --update-env
  ) || return
  wait_for_health 'http://127.0.0.1:3101/readyz' 20
}

write_current_release() {
  local release_name=$1
  local marker_tmp="$release_store/.current-release.rollback.$$"
  if [[ -z $release_name ]]; then
    rm -f -- "$release_store/current-release"
    return 0
  fi
  printf '%s\n' "$release_name" >"$marker_tmp" || return
  mv -f -- "$marker_tmp" "$release_store/current-release"
}

cleanup_transaction_backup() {
  local resolved
  [[ -n $transaction_backup && -d $transaction_backup ]] || return 0
  resolved=$(realpath -m -- "$transaction_backup")
  case "$resolved" in
    "$release_store"/.rollback-transaction-*) rm -rf -- "$resolved" ;;
    *) echo "Refusing to remove unsafe rollback transaction: $resolved" >&2; return 1 ;;
  esac
}

restore_previous_release() {
  echo 'Rollback failed; restoring the production tree that was active before rollback.' >&2
  copy_release "$transaction_backup" "$project" || return
  (
    cd "$project" && npm ci --omit=dev --no-audit --no-fund
  ) || return
  reload_production || return
  wait_for_health 'http://127.0.0.1:3000/readyz' 20 || return
  if ! start_staging_release "$transaction_backup"; then
    echo 'Restored production is healthy, but staging restore failed and was disabled.' >&2
    pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
  fi
  write_current_release "$current" || return
  pm2 save || return
  echo 'The previously active production release was restored successfully.' >&2
}

rollback_failed() {
  local exit_code=$?
  local recovery_failed=0
  trap - ERR
  if [[ $production_stopped -eq 1 && $production_changed -eq 0 ]]; then
    if reload_production && wait_for_health 'http://127.0.0.1:3000/readyz' 20; then
      production_stopped=0
    else
      echo 'CRITICAL: production was drained for compatibility validation and could not be restarted.' >&2
      recovery_failed=1
    fi
  fi
  if [[ $production_changed -eq 1 && -d $transaction_backup ]]; then
    if ! restore_previous_release; then
      echo 'CRITICAL: automatic rollback recovery failed; production requires immediate inspection.' >&2
      echo "Recovery snapshot retained at: $transaction_backup" >&2
      recovery_failed=1
    fi
  fi
  if [[ $recovery_failed -eq 0 ]]; then
    cleanup_transaction_backup || true
  fi
  exit "$exit_code"
}
trap rollback_failed ERR

if [[ -f "$release_store/current-release" ]]; then
  current=$(tr -d '\r\n' <"$release_store/current-release")
fi

if [[ -z $requested ]]; then
  while read -r _ directory; do
    candidate=$(basename "$directory")
    if [[ $candidate != "$current" && -f "$directory/.healthy" ]]; then
      requested=$candidate
      break
    fi
  done < <(
    find "$release_store" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
      sort -nr
  )
fi

if [[ ! $requested =~ ^[0-9]{14}-[0-9a-f]{12}-(current|previous)$ ]]; then
  echo 'Provide a valid release name from the release store.' >&2
  exit 1
fi
target=$(realpath -m "$release_store/$requested")
case "$target" in
  "$release_store"/*) ;;
  *) echo "Unsafe rollback target: $target" >&2; exit 1 ;;
esac
test -d "$target"
test -f "$target/.healthy"
test -f "$target/src/server.js"
test -f "$target/package-lock.json"
test -f "$target/release-manifest.json"
normalize_release_payload_permissions "$target"

target_supports_yandex_business=$(
  node -e '
    const manifest = require(process.argv[1]);
    process.stdout.write(manifest?.capabilities?.yandexBusinessV2 === true ? "true" : "false");
  ' "$target/release-manifest.json"
)
target_supports_yandex_projection_guard=$(
  node -e '
    const manifest = require(process.argv[1]);
    process.stdout.write(manifest?.capabilities?.yandexProjectionGuardV1 === true ? "true" : "false");
  ' "$target/release-manifest.json"
)

check_legacy_target_business_compatibility() {
  local business_rollback_blockers
  local business_history_rows
  local pending_business_alerts
  local guarded_active_rows

  # Stop every writable production request and worker before the final DB
  # snapshot. The deployment flock alone does not serialize API mutations.
  # Nginx can use the already healthy staging fallback during this short drain.
  pm2 stop iiko-bonus >/dev/null
  production_stopped=1
  set -a
  # shellcheck disable=SC1090
  source "$project/.env"
  set +a
  if ! business_rollback_blockers=$(
    node -e '
      const { Client } = require("pg");
      const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
      if (!url) throw new Error("Database URL is unavailable for rollback compatibility check");
      const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
      (async () => {
        await client.connect();
        const result = await client.query(`
          select
            (
              select count(*)::integer
              from public.delivery_jobs
              where provider = $1
                and api_family = $2
            ) as business_history_rows,
            (
              select count(*)::integer
              from public.delivery_jobs
              where provider = $1
                and projection_guarded = true
                and (
                  (api_family = 'cargo_v2' and provider_status not in (
                    'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
                    'returned', 'returned_finish', 'failed', 'cancelled',
                    'cancelled_with_payment', 'cancelled_by_taxi',
                    'cancelled_with_items_on_hands'
                  ))
                  or
                  (api_family = 'business_v2' and provider_status not in (
                    'complete', 'finished', 'cancelled', 'failed'
                  ))
                )
            ) as guarded_active_rows,
            (
              select count(*)::integer
              from public.staff_order_alerts
              where alert_type in ($3, $4, $5)
                and status in ('queued', 'config_pending', 'processing', 'retry')
            ) as pending_alerts
        `, [
          "yandex",
          "business_v2",
          "yandex_price_overrun",
          "yandex_items_unresolved",
          "yandex_create_uncertain",
        ]);
        const row = result.rows[0] || {};
        process.stdout.write(
          `${Number(row.business_history_rows || 0)}:${Number(row.pending_alerts || 0)}:${Number(row.guarded_active_rows || 0)}`,
        );
      })().finally(() => client.end()).catch((error) => {
        process.stderr.write(`Rollback compatibility check failed: ${error.message}\n`);
        process.exitCode = 1;
      });
    '
  ); then
    echo 'Rollback compatibility query failed; restoring the current production process.' >&2
    reload_production
    production_stopped=0
    return 1
  fi
  if [[ ! $business_rollback_blockers =~ ^[0-9]+:[0-9]+:[0-9]+$ ]]; then
    echo 'Rollback stopped: invalid Business compatibility counts.' >&2
    reload_production
    production_stopped=0
    return 1
  fi
  business_history_rows=${business_rollback_blockers%%:*}
  pending_business_alerts=${business_rollback_blockers#*:}
  pending_business_alerts=${pending_business_alerts%%:*}
  guarded_active_rows=${business_rollback_blockers##*:}
  if [[ $target_supports_yandex_business != true ]] && (( business_history_rows > 0 )); then
    echo "Rollback stopped: target lacks Yandex Business API support while $business_history_rows Business ledger row(s) exist." >&2
    reload_production
    production_stopped=0
    return 1
  fi
  if [[ $target_supports_yandex_business != true ]] && (( pending_business_alerts > 0 )); then
    echo "Rollback stopped: target lacks Yandex Business alert support while $pending_business_alerts pending Yandex alert(s) exist." >&2
    reload_production
    production_stopped=0
    return 1
  fi
  if [[ $target_supports_yandex_projection_guard != true ]] && (( guarded_active_rows > 0 )); then
    echo "Rollback stopped: target lacks guarded Yandex projection support while $guarded_active_rows active guarded job(s) exist." >&2
    reload_production
    production_stopped=0
    return 1
  fi
}

transaction_backup="$release_store/.rollback-transaction-${requested}-$$"
case "$transaction_backup" in
  "$release_store"/.rollback-transaction-*) ;;
  *) echo "Unsafe rollback transaction path: $transaction_backup" >&2; exit 1 ;;
esac
test ! -e "$transaction_backup"
copy_release "$project" "$transaction_backup"

if [[ $target_supports_yandex_business != true || $target_supports_yandex_projection_guard != true ]]; then
  check_legacy_target_business_compatibility
fi

production_changed=1
copy_release "$target" "$project"
(
  cd "$project" && npm ci --omit=dev --no-audit --no-fund
)
reload_production
production_stopped=0
wait_for_health 'http://127.0.0.1:3000/readyz' 20
curl -fsS 'http://127.0.0.1:3000/admin/' >/dev/null
if ! start_staging_release "$target"; then
  echo 'Rollback production is healthy, but staging failed and was disabled.' >&2
  pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
fi
write_current_release "$requested"
pm2 save

production_changed=0
trap - ERR
cleanup_transaction_backup
echo "Rollback completed: $requested"
