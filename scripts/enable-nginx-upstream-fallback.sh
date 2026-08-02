#!/usr/bin/env bash
set -Eeuo pipefail

upstream_conf=/etc/nginx/conf.d/bulka-backend-upstream.conf
site_conf=''
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
backup_root="/var/backups/bulka-nginx-fallback-${timestamp}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script as root.' >&2
  exit 1
fi

for candidate in \
  /etc/nginx/sites-available/iiko-bonus \
  /etc/nginx/sites-enabled/iiko-bonus; do
  if [[ -f $candidate ]]; then
    site_conf=$candidate
    break
  fi
done
if [[ -z $site_conf ]]; then
  echo 'Bulka Nginx site configuration was not found.' >&2
  exit 1
fi

install -d -m 0700 -- "$backup_root"
cp -a -- "$site_conf" "$backup_root/site.conf"
if [[ -f $upstream_conf ]]; then
  cp -a -- "$upstream_conf" "$backup_root/upstream.conf"
fi

rollback() {
  cp -a -- "$backup_root/site.conf" "$site_conf"
  if [[ -f "$backup_root/upstream.conf" ]]; then
    cp -a -- "$backup_root/upstream.conf" "$upstream_conf"
  else
    rm -f -- "$upstream_conf"
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
}
trap rollback ERR

cat >"$upstream_conf" <<'NGINX'
upstream bulka_backend {
    zone bulka_backend 64k;
    server 127.0.0.1:3000 max_fails=1 fail_timeout=2s;
    server 127.0.0.1:3101 backup max_fails=1 fail_timeout=2s;
    keepalive 32;
}
NGINX
chmod 0644 "$upstream_conf"

if grep -Eq 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):3000/?;' "$site_conf"; then
  perl -0pi -e \
    's#proxy_pass\s+http://(?:127\.0\.0\.1|localhost):3000/?;#proxy_pass http://bulka_backend;#g' \
    "$site_conf"
elif ! grep -Eq 'proxy_pass[[:space:]]+http://bulka_backend;' "$site_conf"; then
  echo 'The production proxy_pass target was not recognized; no change was applied.' >&2
  exit 1
fi

nginx -t
systemctl reload nginx
trap - ERR

echo 'Nginx now uses port 3101 as a verified backup while port 3000 reloads.'
echo "Recoverable backup: $backup_root"
