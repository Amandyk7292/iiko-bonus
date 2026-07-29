#!/usr/bin/env bash
set -Eeuo pipefail

project=${BULKA_PROJECT_DIR:-/var/www/iiko-bonus}
staging=${BULKA_STAGING_DIR:-/home/deploy/iiko-bonus-staging/current}
release_store=${BULKA_RELEASE_STORE:-/home/deploy/.bulka-releases}
requested=${1:-}

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

copy_release() {
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
    rollback-vps.sh \
    verify-database-restore.sh \
    prepare-cloudflare-origin.sh \
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
    "$source/release-manifest.json" \
    "$destination/"
  cp \
    "$source/kaspi-pos-automation-main/server.js" \
    "$source/kaspi-pos-automation-main/package.json" \
    "$source/kaspi-pos-automation-main/package-lock.json" \
    "$destination/kaspi-pos-automation-main/"
}

start_staging_release() {
  pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
  mkdir -p "$staging"
  copy_release "$target" "$staging"
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
  for attempt in {1..20}; do
    curl -fsS 'http://127.0.0.1:3101/readyz' >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

current=''
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

copy_release "$target" "$project"

(
  cd "$project"
  npm ci --omit=dev --no-audit --no-fund
  npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
)
if ! env HOST=127.0.0.1 pm2 reload iiko-bonus --update-env; then
  env HOST=127.0.0.1 pm2 restart iiko-bonus --update-env
fi
for attempt in {1..20}; do
  if curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null 2>&1; then
    if ! start_staging_release; then
      echo 'Rollback staging failed; it was stopped to avoid serving a mismatched release.' >&2
      pm2 delete iiko-bonus-staging >/dev/null 2>&1 || true
    fi
    printf '%s\n' "$requested" >"$release_store/current-release"
    pm2 save
    echo "Rollback completed: $requested"
    exit 0
  fi
  sleep 1
done
echo 'Rollback target did not become healthy.' >&2
exit 1
