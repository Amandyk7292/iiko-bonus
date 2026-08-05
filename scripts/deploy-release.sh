#!/usr/bin/env bash
set -Eeuo pipefail

release_id=${1:-}
migration_mode=${2:-apply}
archive=${3:-/tmp/bulka-release.zip}
expected_sha256=${4:-}
project=${BULKA_PROJECT_DIR:-/var/www/iiko-bonus}
staging=${BULKA_STAGING_DIR:-/home/deploy/iiko-bonus-staging/current}
release_store=${BULKA_RELEASE_STORE:-/home/deploy/.bulka-releases}
temporary_release="/tmp/bulka-release-${release_id}"
preflight_log="/tmp/bulka-staging-${release_id}.log"
preflight_pid=''
backup_ready=0
production_changed=0
previous_release="${release_id}-previous"
current_release="${release_id}-current"
backup="${release_store}/${previous_release}"
stored_release="${release_store}/${current_release}"

if [[ ! $release_id =~ ^[0-9]{14}-[0-9a-f]{12}$ ]]; then
  echo 'Release id must contain a timestamp and 12-character commit id.' >&2
  exit 1
fi
if [[ ! $expected_sha256 =~ ^[0-9a-f]{64}$ ]]; then
  echo 'A lowercase SHA-256 archive checksum is required.' >&2
  exit 1
fi
if [[ $migration_mode != 'apply' && $migration_mode != 'check' ]]; then
  echo 'Migration mode must be apply or check.' >&2
  exit 1
fi
case "$project" in
  /var/www/iiko-bonus) ;;
  *) echo "Unsafe project directory: $project" >&2; exit 1 ;;
esac
case "$staging" in
  /home/deploy/iiko-bonus-staging/current) ;;
  *) echo "Unsafe staging directory: $staging" >&2; exit 1 ;;
esac
case "$release_store" in
  /home/deploy/.bulka-releases) ;;
  *) echo "Unsafe release store: $release_store" >&2; exit 1 ;;
esac
case "$temporary_release" in
  /tmp/bulka-release-[0-9]*) ;;
  *) echo "Unsafe temporary release: $temporary_release" >&2; exit 1 ;;
esac

copy_artifacts() {
  local source=$1
  local destination=$2
  mkdir -p \
    "$destination/public" \
    "$destination/admin-ui" \
    "$destination/kaspi-pos-automation-main" \
    "$destination/scripts" \
    "$destination/supabase"
  rsync -a --delete "$source/src/" "$destination/src/"
  rsync -a --delete "$source/supabase/migrations/" "$destination/supabase/migrations/"
  rsync -a --delete "$source/public/" "$destination/public/"
  rsync -a --delete "$source/admin-ui/dist/" "$destination/admin-ui/dist/"
  rsync -a --delete \
    "$source/kaspi-pos-automation-main/src/" \
    "$destination/kaspi-pos-automation-main/src/"
  rsync -a --delete \
    "$source/kaspi-pos-automation-main/public/" \
    "$destination/kaspi-pos-automation-main/public/"
  for script in \
    apply-migrations.js \
    backup-database.sh \
    setup-google-wallet.js \
    deploy-release.sh \
    enable-nginx-upstream-fallback.sh \
    ensure-postgres-client.sh \
    install-database-backup-timer.sh \
    install-pm2-logrotate.sh \
    rollback-vps.sh \
    verify-database-restore.sh \
    prepare-cloudflare-origin.sh \
    configure-iiko-astana-vps.sh \
    probe-iiko-city-profile.js \
    harden-nginx-access-logs.sh; do
    if [[ -f "$source/scripts/$script" ]]; then
      cp "$source/scripts/$script" "$destination/scripts/$script"
    fi
  done
  cp \
    "$source/index.js" \
    "$source/package.json" \
    "$source/package-lock.json" \
    "$source/supabase_schema.sql" \
    "$destination/"
  if [[ -f "$source/release-manifest.json" ]]; then
    cp "$source/release-manifest.json" "$destination/release-manifest.json"
  else
    cat >"$destination/release-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "releaseId": "legacy-pre-release",
  "commitSha": "0000000000000000000000000000000000000000",
  "branch": "legacy",
  "builtAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "migrationMode": "unknown",
  "source": "legacy-production-backup"
}
EOF
  fi
  cp \
    "$source/kaspi-pos-automation-main/server.js" \
    "$source/kaspi-pos-automation-main/package.json" \
    "$source/kaspi-pos-automation-main/package-lock.json" \
    "$destination/kaspi-pos-automation-main/"
}

quarantine_legacy_migrations() {
  local destination=$1
  local legacy="$destination/migrations"
  local resolved_destination
  local quarantine

  [[ -e $legacy || -L $legacy ]] || return 0
  [[ -d $legacy && ! -L $legacy ]] || {
    echo "Refusing to remove unexpected legacy migration path: $legacy" >&2
    return 1
  }
  resolved_destination=$(realpath -m -- "$destination")
  case "$resolved_destination" in
    "$project") ;;
    *)
      echo "Refusing to quarantine migrations outside production project: $legacy" >&2
      return 1
      ;;
  esac
  quarantine="$release_store/${release_id}-legacy-migrations"
  [[ ! -e $quarantine ]] || {
    echo "Legacy migration quarantine already exists: $quarantine" >&2
    return 1
  }
  mv -- "$legacy" "$quarantine"
  printf 'Legacy migration directory quarantined at %s\n' "$quarantine"
}

retain_previous_admin_assets() {
  local source_root=$1
  local target_root=$2
  local source_assets="$source_root/admin-ui/dist/assets"
  local target_assets="$target_root/admin-ui/dist/assets"
  local source_manifest="$source_root/admin-ui/dist/.current-assets"
  local target_manifest="$target_root/admin-ui/dist/.current-assets"
  local relative

  mkdir -p "$target_assets"
  find "$target_assets" -type f -printf '%P\n' | LC_ALL=C sort >"$target_manifest"
  [[ -d $source_assets ]] || return 0

  while IFS= read -r relative; do
    [[ -n $relative ]] || continue
    if [[ $relative == /* || $relative == ../* || $relative == */../* || $relative == */.. ]]; then
      echo "Unsafe admin asset path: $relative" >&2
      return 1
    fi
    [[ -f "$source_assets/$relative" ]] || continue
    [[ -e "$target_assets/$relative" ]] && continue
    mkdir -p "$(dirname "$target_assets/$relative")"
    cp -p -- "$source_assets/$relative" "$target_assets/$relative"
  done < <(
    if [[ -f $source_manifest ]]; then
      cat "$source_manifest"
    else
      find "$source_assets" -type f -printf '%P\n' | LC_ALL=C sort
    fi
  )
}

wait_for_health() {
  local url=$1
  local attempts=${2:-20}
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_client_shell() {
  local url=$1
  local response_file
  local status
  local valid=1
  response_file=$(mktemp /tmp/bulka-client-shell.XXXXXX)
  status=$(
    curl -sS \
      -H 'Accept: application/json' \
      -o "$response_file" \
      -w '%{http_code}' \
      "$url"
  ) || {
    rm -f -- "$response_file"
    return 1
  }

  case "$status" in
    200)
      if grep -q 'app_bootstrap.js' "$response_file"; then
        valid=0
      fi
      ;;
    403)
      # A direct loopback request is intentionally denied when the public
      # IP allow-list is enabled. Accept only our exact structured denial,
      # never an arbitrary 403 from another middleware.
      if node - "$response_file" <<'NODE'
const fs = require('node:fs');
const response = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (response.code !== 'SITE_IP_NOT_ALLOWED') process.exit(1);
NODE
      then
        valid=0
      fi
      ;;
  esac

  if [[ $valid -ne 0 ]]; then
    echo "Client shell probe failed with HTTP ${status}: ${url}" >&2
  fi
  rm -f -- "$response_file"
  return "$valid"
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
  mkdir -p "$staging"
  copy_artifacts "$source" "$staging"
  ln -sfn "$project/.env" "$staging/.env"
  (
    cd "$staging"
    npm ci --omit=dev --no-audit --no-fund
    env \
      NODE_ENV=production \
      HOST=127.0.0.1 \
      PORT=3101 \
      RUN_BOTS=false \
      RUN_BACKGROUND_WORKERS=false \
      RUN_WHATSAPP_OUTBOX_WORKER=false \
      RUN_YANDEX_DELIVERY_WORKER=false \
      YANDEX_DELIVERY_ENABLED=false \
      KASPI_POS_ENABLED=false \
      GEMINI_ASSISTANT_ENABLED=false \
      pm2 start src/server.js --name iiko-bonus-staging --cwd "$staging" --update-env
  )
  wait_for_health 'http://127.0.0.1:3101/readyz' 20
  curl -fsS 'http://127.0.0.1:3101/admin/' >/dev/null
  verify_client_shell 'http://127.0.0.1:3101/app/'
}

create_pre_migration_backup() {
  if [[ ${BULKA_MANAGED_PITR_CONFIRMED:-false} == 'true' ]]; then
    echo 'Managed point-in-time recovery was explicitly confirmed.'
    return 0
  fi
  if ! command -v pg_dump >/dev/null || ! command -v pg_restore >/dev/null; then
    echo 'Deployment stopped: pg_dump and pg_restore are required before migrations.' >&2
    echo 'Install postgresql-client or explicitly confirm managed PITR.' >&2
    return 1
  fi
  (
    cd "$temporary_release"
    BULKA_DATABASE_BACKUP_DIR="$release_store/database-backups" \
      DOTENV_CONFIG_PATH="$project/.env" \
      node -r dotenv/config -e '
        const { spawnSync } = require("node:child_process");
        const result = spawnSync("bash", ["scripts/backup-database.sh"], {
          env: process.env,
          stdio: "inherit",
        });
        if (result.error || result.status !== 0) process.exit(1);
      '
  )
}

configure_postgres_client() {
  local portable_root=/home/deploy/.bulka-tools/postgresql
  local portable_bin="$portable_root/usr/lib/postgresql/17/bin"
  local portable_lib="$portable_root/usr/lib/x86_64-linux-gnu"
  if [[ -x "$portable_bin/pg_dump" && -x "$portable_bin/pg_restore" ]]; then
    export PATH="$portable_bin:$PATH"
    export LD_LIBRARY_PATH="$portable_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    pg_dump --version >/dev/null
    pg_restore --version >/dev/null
    return 0
  fi
  command -v pg_dump >/dev/null && command -v pg_restore >/dev/null
}

run_optional_privileged_task() {
  local label=$1
  local script=$2
  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    bash "$script"
    return 0
  fi
  if command -v sudo >/dev/null && sudo -n true >/dev/null 2>&1; then
    sudo -n bash "$script"
    return 0
  fi
  echo "$label was not changed: run $script once as root after deployment." >&2
}

nginx_fallback_ready() {
  local upstream_conf=/etc/nginx/conf.d/bulka-backend-upstream.conf
  local site_conf=''
  for candidate in \
    /etc/nginx/sites-enabled/iiko-bonus \
    /etc/nginx/sites-available/iiko-bonus; do
    if [[ -r $candidate ]]; then
      site_conf=$candidate
      break
    fi
  done
  [[ -r $upstream_conf && -n $site_conf ]] || return 1
  grep -Eq 'upstream[[:space:]]+bulka_backend' "$upstream_conf" &&
    grep -Eq 'server[[:space:]]+127\.0\.0\.1:3000([[:space:]]|;)' "$upstream_conf" &&
    grep -Eq 'server[[:space:]]+127\.0\.0\.1:3101[[:space:]]+backup' "$upstream_conf" &&
    grep -Eq 'proxy_pass[[:space:]]+http://bulka_backend;' "$site_conf"
}

require_nginx_fallback() {
  if [[ ${BULKA_REQUIRE_NGINX_FALLBACK:-true} != 'true' ]]; then
    echo 'WARNING: Nginx fallback enforcement was explicitly disabled.' >&2
    return 0
  fi
  if nginx_fallback_ready; then
    return 0
  fi
  echo 'Deployment stopped before production mutation: Nginx does not use the healthy staging backup on port 3101.' >&2
  echo 'Run scripts/enable-nginx-upstream-fallback.sh once as root, then retry the deployment.' >&2
  return 1
}

stop_preflight() {
  if [[ -n $preflight_pid ]] && kill -0 "$preflight_pid" 2>/dev/null; then
    kill "$preflight_pid" 2>/dev/null || true
    wait "$preflight_pid" 2>/dev/null || true
  fi
  preflight_pid=''
}

cleanup_incomplete_release() {
  local directory=$1
  local resolved
  [[ -d $directory ]] || return 0
  [[ -f "$directory/.healthy" ]] && return 0
  resolved=$(realpath -m "$directory")
  case "$resolved" in
    "$release_store"/*) rm -rf -- "$resolved" ;;
    *) echo "Refusing to remove unsafe incomplete release: $resolved" >&2 ;;
  esac
}

rollback_failed_deploy() {
  local exit_code=$?
  trap - ERR
  stop_preflight
  if [[ $production_changed -eq 1 && $backup_ready -eq 1 ]]; then
    echo 'Deployment failed; restoring the previously healthy release.' >&2
    copy_artifacts "$backup" "$project"
    (
      cd "$project"
      npm ci --omit=dev --no-audit --no-fund
      npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
    )
    reload_production
    wait_for_health 'http://127.0.0.1:3000/readyz' 20 || true
    if ! start_staging_release "$backup"; then
      echo 'Rollback staging failed; disabling it to avoid serving a mismatched release.' >&2
      pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
    fi
    pm2 save
  fi
  cleanup_incomplete_release "$backup"
  cleanup_incomplete_release "$stored_release"
  case "$temporary_release" in
    /tmp/bulka-release-[0-9]*) rm -rf -- "$temporary_release" ;;
  esac
  rm -f -- "$archive" "$preflight_log"
  exit "$exit_code"
}
trap rollback_failed_deploy ERR

test -f "$archive"
test -f "$project/.env"
printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum --check --status
curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null
mkdir -p "$release_store"
mkdir -p "$temporary_release"
unzip -oq "$archive" -d "$temporary_release"

for required_file in \
  src/server.js \
  public/app/index.html \
  public/app/release-version.json \
  public/legal/privacy.html \
  public/legal/terms.html \
  public/courier.html \
  admin-ui/dist/index.html \
  kaspi-pos-automation-main/server.js \
  supabase/migrations/20260725120000_customer_access_hardening.sql \
  scripts/apply-migrations.js \
  scripts/backup-database.sh \
  scripts/backup-supabase-storage.js \
  scripts/deploy-release.sh \
  scripts/ensure-postgres-client.sh \
  scripts/install-database-backup-timer.sh \
  scripts/install-pm2-logrotate.sh \
  scripts/configure-iiko-astana-vps.sh \
  scripts/probe-iiko-city-profile.js \
  scripts/rollback-vps.sh \
  release-manifest.json; do
  test -f "$temporary_release/$required_file"
done

manifest_commit=$(
  node -e '
    const manifest = require(process.argv[1]);
    if (
      manifest.schemaVersion !== 1
      || !/^[0-9a-f]{40}$/.test(String(manifest.commitSha || ""))
      || manifest.source !== "clean-git-worktree"
    ) process.exit(1);
    process.stdout.write(manifest.commitSha);
  ' "$temporary_release/release-manifest.json"
)
if [[ ${manifest_commit:0:12} != "${release_id#*-}" ]]; then
  echo 'Release manifest does not match the release id.' >&2
  exit 1
fi

flutter_release_details=$(
  node -e '
    const manifest = require(process.argv[1]);
    if (
      manifest.schemaVersion !== 1
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/.test(String(manifest.version || ""))
      || !/^[0-9a-f]{64}$/.test(String(manifest.mainSha256 || ""))
    ) process.exit(1);
    console.log(`${manifest.version} ${manifest.mainSha256}`);
  ' "$temporary_release/public/app/release-version.json"
)
read -r flutter_version expected_flutter_hash <<<"$flutter_release_details"
if [[ $flutter_version != "${manifest_commit:0:12}" && $flutter_version != "$manifest_commit" ]]; then
  echo 'Flutter release version does not match the release commit.' >&2
  exit 1
fi
actual_flutter_hash=$(sha256sum "$temporary_release/public/app/main.dart.js" | cut -d' ' -f1)
if [[ $actual_flutter_hash != "$expected_flutter_hash" ]]; then
  echo 'Flutter release manifest does not match main.dart.js.' >&2
  exit 1
fi

# Keep one prior set of content-hashed chunks. Tabs opened before deployment can
# finish their current navigation while newer tabs receive the new index.
retain_previous_admin_assets "$project" "$temporary_release"

ln -sfn "$project/.env" "$temporary_release/.env"
(
  cd "$temporary_release"
  npm ci --omit=dev --no-audit --no-fund
)

original_directory=$PWD
cd "$temporary_release"
env \
  NODE_ENV=production \
  HOST=127.0.0.1 \
  PORT=3199 \
  RUN_BOTS=false \
  RUN_BACKGROUND_WORKERS=false \
  RUN_WHATSAPP_OUTBOX_WORKER=false \
  RUN_YANDEX_DELIVERY_WORKER=false \
  YANDEX_DELIVERY_ENABLED=false \
  KASPI_POS_ENABLED=false \
  GEMINI_ASSISTANT_ENABLED=false \
  node src/server.js >"$preflight_log" 2>&1 &
preflight_pid=$!
cd "$original_directory"
wait_for_health 'http://127.0.0.1:3199/readyz' 20
curl -fsS 'http://127.0.0.1:3199/admin/' >/dev/null
verify_client_shell 'http://127.0.0.1:3199/app/'
stop_preflight

if [[ $migration_mode == 'apply' ]]; then
  if ! configure_postgres_client; then
    echo 'Deployment stopped: PostgreSQL backup tools are unavailable.' >&2
    exit 1
  fi
  create_pre_migration_backup
  (
    cd "$temporary_release"
    DOTENV_CONFIG_PATH="$project/.env" \
      npm run db:migrate -- \
        --baseline-existing \
        --baseline-through=20260723120000_admin_operations_realtime.sql
  )
else
  (cd "$temporary_release" && npm run db:migrate:check)
fi

copy_artifacts "$project" "$backup"
printf 'healthy_at=%s\nsource=pre_deploy\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  >"$backup/.healthy"
backup_ready=1

start_staging_release "$temporary_release"
bash "$temporary_release/scripts/install-pm2-logrotate.sh"
if [[ ${BULKA_CONFIGURE_NGINX_FALLBACK:-true} == 'true' ]]; then
  run_optional_privileged_task \
    'Nginx staging fallback' \
    "$temporary_release/scripts/enable-nginx-upstream-fallback.sh"
fi
require_nginx_fallback

production_changed=1
copy_artifacts "$temporary_release" "$project"
production_flutter_hash=$(sha256sum "$project/public/app/main.dart.js" | cut -d' ' -f1)
if [[ $production_flutter_hash != "$expected_flutter_hash" ]]; then
  echo 'Production Flutter bundle does not match the staged release.' >&2
  exit 1
fi
quarantine_legacy_migrations "$project"
(
  cd "$project"
  npm ci --omit=dev --no-audit --no-fund
  npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
)
reload_production
wait_for_health 'http://127.0.0.1:3000/readyz' 20
curl -fsS 'http://127.0.0.1:3000/admin/' >/dev/null
verify_client_shell 'http://127.0.0.1:3000/app/'
if command -v pg_dump >/dev/null && command -v pg_restore >/dev/null; then
  run_optional_privileged_task \
    'Database backup timer' \
    "$project/scripts/install-database-backup-timer.sh"
else
  echo 'Database backup timer was not enabled: install postgresql-client on the VPS.' >&2
fi

copy_artifacts "$temporary_release" "$stored_release"
printf 'healthy_at=%s\nsource=deployment\ncommit=%s\n' \
  "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$manifest_commit" \
  >"$stored_release/.healthy"
printf '%s\n' "$current_release" >"$release_store/current-release"

mapfile -t obsolete_releases < <(
  find "$release_store" -mindepth 1 -maxdepth 1 -type d \
    \( -name '*-current' -o -name '*-previous' \) |
    while read -r directory; do
      [[ -f "$directory/.healthy" ]] || continue
      printf '%s %s\n' "$(stat -c '%Y' "$directory")" "$directory"
    done |
    sort -nr |
    tail -n +4 |
    cut -d' ' -f2-
)
for obsolete in "${obsolete_releases[@]}"; do
  resolved=$(realpath -m "$obsolete")
  case "$resolved" in
    "$release_store"/*) rm -rf -- "$resolved" ;;
    *) echo "Refusing to prune unsafe release path: $resolved" >&2; exit 1 ;;
  esac
done

pm2 save
trap - ERR
stop_preflight
rm -rf -- "$temporary_release"
rm -f -- "$archive" "$preflight_log"
echo "Production release ${release_id} is healthy."
echo 'Staging is healthy on http://127.0.0.1:3101.'
echo "Rollback versions retained: $(find "$release_store" -mindepth 1 -maxdepth 1 -type d \( -name '*-current' -o -name '*-previous' \) | wc -l)."
