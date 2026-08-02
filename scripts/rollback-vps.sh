#!/usr/bin/env bash
set -Eeuo pipefail

project=${BULKA_PROJECT_DIR:-/var/www/iiko-bonus}
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

mkdir -p \
  "$project/public" \
  "$project/admin-ui" \
  "$project/kaspi-pos-automation-main" \
  "$project/scripts" \
  "$project/supabase"
rsync -a --delete "$target/src/" "$project/src/"
rsync -a --delete "$target/supabase/migrations/" "$project/supabase/migrations/"
rsync -a --delete "$target/public/" "$project/public/"
rsync -a --delete "$target/admin-ui/dist/" "$project/admin-ui/dist/"
rsync -a --delete \
  "$target/kaspi-pos-automation-main/src/" \
  "$project/kaspi-pos-automation-main/src/"
rsync -a --delete \
  "$target/kaspi-pos-automation-main/public/" \
  "$project/kaspi-pos-automation-main/public/"
for script in \
  apply-migrations.js \
  setup-google-wallet.js \
  deploy-release.sh \
  rollback-vps.sh \
  prepare-cloudflare-origin.sh \
  harden-nginx-access-logs.sh; do
  if [[ -f "$target/scripts/$script" ]]; then
    cp "$target/scripts/$script" "$project/scripts/$script"
  fi
done
cp \
  "$target/index.js" \
  "$target/package.json" \
  "$target/package-lock.json" \
  "$target/supabase_schema.sql" \
  "$target/release-manifest.json" \
  "$project/"
cp \
  "$target/kaspi-pos-automation-main/server.js" \
  "$target/kaspi-pos-automation-main/package.json" \
  "$target/kaspi-pos-automation-main/package-lock.json" \
  "$project/kaspi-pos-automation-main/"

(
  cd "$project"
  npm ci --omit=dev --no-audit --no-fund
  npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
)
env HOST=127.0.0.1 pm2 restart iiko-bonus --update-env
for attempt in {1..20}; do
  if curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null 2>&1; then
    printf '%s\n' "$requested" >"$release_store/current-release"
    pm2 save
    echo "Rollback completed: $requested"
    exit 0
  fi
  sleep 1
done
echo 'Rollback target did not become healthy.' >&2
exit 1
