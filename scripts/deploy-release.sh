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
    setup-google-wallet.js \
    deploy-release.sh \
    rollback-vps.sh \
    prepare-cloudflare-origin.sh \
    harden-nginx-access-logs.sh \
    backup-database.sh \
    backup-supabase-storage.js \
    install-database-backup-timer.sh \
    verify-database-restore.sh; do
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
    *) echo "Refusing to quarantine migrations outside production project: $legacy" >&2; return 1 ;;
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
    env HOST=127.0.0.1 pm2 restart iiko-bonus --update-env
    wait_for_health 'http://127.0.0.1:3000/readyz' 20 || true
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
  public/legal/privacy.html \
  public/legal/terms.html \
  public/courier.html \
  admin-ui/dist/index.html \
  kaspi-pos-automation-main/server.js \
  supabase/migrations/20260725120000_customer_access_hardening.sql \
  scripts/apply-migrations.js \
  scripts/deploy-release.sh \
  scripts/rollback-vps.sh \
  scripts/backup-database.sh \
  scripts/backup-supabase-storage.js \
  scripts/install-database-backup-timer.sh \
  scripts/verify-database-restore.sh \
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
curl -fsS 'http://127.0.0.1:3199/app/' >/dev/null
stop_preflight

if [[ $migration_mode == 'apply' ]]; then
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

pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
mkdir -p "$staging"
copy_artifacts "$temporary_release" "$staging"
ln -sfn "$project/.env" "$staging/.env"
(
  cd "$staging"
  npm ci --omit=dev --no-audit --no-fund
)
(
  cd "$staging"
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
curl -fsS 'http://127.0.0.1:3101/app/' >/dev/null

production_changed=1
copy_artifacts "$temporary_release" "$project"
quarantine_legacy_migrations "$project"
(
  cd "$project"
  npm ci --omit=dev --no-audit --no-fund
  npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
)
env HOST=127.0.0.1 pm2 restart iiko-bonus --update-env
wait_for_health 'http://127.0.0.1:3000/readyz' 20
curl -fsS 'http://127.0.0.1:3000/admin/' >/dev/null
curl -fsS 'http://127.0.0.1:3000/app/' >/dev/null

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
