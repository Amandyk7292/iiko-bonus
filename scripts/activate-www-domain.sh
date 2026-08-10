#!/usr/bin/env bash
set -Eeuo pipefail

domain=${DOMAIN:-bulka.com.kz}
www_domain="www.${domain}"
expected_origin=${EXPECTED_ORIGIN_IP:-}
confirmation=${CONFIRM_DNS_WWW:-}
site_conf=/etc/nginx/sites-available/iiko-bonus
redirect_conf=/etc/nginx/conf.d/bulka-www-redirect.conf
webroot=/var/www/letsencrypt
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
backup_dir="/var/backups/bulka-www-${timestamp}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script through sudo.' >&2
  exit 1
fi
if [[ ! $domain =~ ^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$ ]]; then
  echo 'DOMAIN is invalid.' >&2
  exit 1
fi
if [[ $confirmation != "$www_domain" ]]; then
  echo "Set CONFIRM_DNS_WWW=${www_domain} only after changing the DNS record." >&2
  exit 1
fi
if [[ ! $expected_origin =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'EXPECTED_ORIGIN_IP must be the approved IPv4 origin.' >&2
  exit 1
fi

filter_native_ipv6_addresses() {
  # glibc may expose IPv4 A records as IPv4-mapped results for ahostsv6.
  # They are resolver compatibility entries, not proof of a DNS AAAA record.
  awk '{
    address = tolower($1)
    if (address !~ /^(::ffff:|0:0:0:0:0:ffff:)/) {
      print address
    }
  }'
}

verify_www_redirect() {
  local response
  local status
  local location
  if ! response=$(
    curl --silent --show-error --head \
      --connect-timeout 3 --max-time 5 \
      --write-out $'\n%{http_code}' \
      "https://${www_domain}/healthz" 2>/dev/null
  ); then
    return 1
  fi
  status=${response##*$'\n'}
  location=$(
    printf '%s\n' "$response" |
      awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/\r$/,"",$2); print $2; exit}'
  )
  [[ $status == 308 && $location == "https://${domain}/healthz" ]]
}

wait_for_www_redirect() {
  local attempts=${1:-15}
  local delay_seconds=${2:-1}
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if verify_www_redirect; then
      return 0
    fi
    if (( attempt < attempts )); then
      sleep "$delay_seconds"
    fi
  done
  return 1
}

for hostname in "$domain" "$www_domain"; do
  mapfile -t resolved_v4 < <(getent ahostsv4 "$hostname" | awk '{print $1}' | sort -u)
  resolved_v6=$(
    getent ahostsv6 "$hostname" 2>/dev/null |
      filter_native_ipv6_addresses |
      sort -u || true
  )
  if (( ${#resolved_v4[@]} != 1 )) || [[ ${resolved_v4[0]:-} != "$expected_origin" ]]; then
    echo "${hostname} must resolve only to the approved IPv4 origin ${expected_origin}." >&2
    exit 1
  fi
  if [[ -n $resolved_v6 ]]; then
    echo "${hostname} still has an AAAA record; remove it or configure the approved IPv6 origin first." >&2
    exit 1
  fi
done

test -f "$site_conf"
command -v certbot >/dev/null
install -d -m 0700 "$backup_dir"
install -d -m 0755 "$webroot"
if [[ -f $redirect_conf ]]; then cp -a "$redirect_conf" "$backup_dir/www-redirect"; fi

rollback() {
  local status=$?
  trap - ERR
  if [[ -f $backup_dir/www-redirect ]]; then
    cp -a "$backup_dir/www-redirect" "$redirect_conf"
  else
    rm -f -- "$redirect_conf"
  fi
  nginx -t && systemctl reload nginx || true
  echo "www activation failed; Nginx was restored from ${backup_dir}." >&2
  exit "$status"
}
trap rollback ERR

cat >"$redirect_conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${www_domain};

    location ^~ /.well-known/acme-challenge/ {
        root ${webroot};
    }

    location / {
        return 308 https://${domain}\$request_uri;
    }
}
EOF
nginx -t
systemctl reload nginx

certbot certonly --webroot --webroot-path "$webroot" \
  --cert-name "$domain" --expand --non-interactive \
  -d "$domain" -d "$www_domain"

cat >"$redirect_conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${www_domain};
    return 308 https://${domain}\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${www_domain};
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 308 https://${domain}\$request_uri;
}
EOF

nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx
if ! wait_for_www_redirect 15 1; then
  echo 'Renewed TLS certificate and canonical www redirect did not become visible in time.' >&2
  false
fi

trap - ERR
echo "${www_domain} now redirects permanently to https://${domain}."
echo "Backup: ${backup_dir}"
