#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script through sudo.' >&2
  exit 1
fi

domain='bulka.com.kz'
nginx_conf='/etc/nginx/nginx.conf'
site_conf='/etc/nginx/sites-available/iiko-bonus'
fixed_noble_version='1.24.0-2ubuntu7.3'
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
backup_dir="/var/backups/bulka-nginx-hardening-${timestamp}"
proof_file="/tmp/bulka-acquiring-proof-${timestamp}.txt"

test -f "$nginx_conf"
test -f "$site_conf"
install -d -m 0700 "$backup_dir"
cp -a "$nginx_conf" "$backup_dir/nginx.conf"
cp -a "$site_conf" "$backup_dir/iiko-bonus"

rollback() {
  trap - ERR
  echo 'Hardening failed; restoring the previous Nginx configuration.' >&2
  cp -a "$backup_dir/nginx.conf" "$nginx_conf"
  cp -a "$backup_dir/iiko-bonus" "$site_conf"
  if nginx -t; then
    systemctl reload nginx || true
  fi
}
trap rollback ERR

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nginx nginx-common

installed_version=$(dpkg-query -W -f='${Version}' nginx)
if ! dpkg --compare-versions "$installed_version" ge "$fixed_noble_version"; then
  echo "Nginx package ${installed_version} is older than Ubuntu's fixed package ${fixed_noble_version}." >&2
  exit 1
fi

python3 - "$nginx_conf" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

text, token_count = re.subn(
    r'(?m)^([ \t]*)#?[ \t]*server_tokens[ \t]+[^;]+;',
    lambda match: f'{match.group(1)}server_tokens off;',
    text,
)
if token_count == 0:
    text, http_count = re.subn(
        r'(?m)^([ \t]*http[ \t]*\{[ \t]*)$',
        lambda match: f'{match.group(1)}\n\tserver_tokens off;',
        text,
        count=1,
    )
    if http_count != 1:
        raise SystemExit('Could not locate the Nginx http block')

text, tls_count = re.subn(
    r'(?m)^([ \t]*)ssl_protocols[ \t]+[^;]+;',
    lambda match: f'{match.group(1)}ssl_protocols TLSv1.2 TLSv1.3;',
    text,
)
if tls_count == 0:
    text, http_count = re.subn(
        r'(?m)^([ \t]*http[ \t]*\{[ \t]*)$',
        lambda match: f'{match.group(1)}\n\tssl_protocols TLSv1.2 TLSv1.3;',
        text,
        count=1,
    )
    if http_count != 1:
        raise SystemExit('Could not add the TLS protocol policy')

path.write_text(text, encoding='utf-8')
PY

nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx

headers=$(curl -fsSkI --resolve "${domain}:443:127.0.0.1" "https://${domain}/healthz")
server_header=$(printf '%s\n' "$headers" | awk -F': ' 'tolower($1)=="server" {gsub("\r", "", $2); print $2; exit}')
if [[ -z "$server_header" || "$server_header" == */* ]]; then
  echo "The public Server header still exposes a version: ${server_header:-missing}" >&2
  exit 1
fi
printf '%s\n' "$headers" | grep -qi '^Content-Security-Policy:'
printf '%s\n' "$headers" | grep -qi '^X-Bulka-WAF: active'

waf_status=$(curl -sSk -o /dev/null -w '%{http_code}' \
  --resolve "${domain}:443:127.0.0.1" \
  "https://${domain}/?foo=/etc/passwd&bar=/bin/sh")
test "$waf_status" = '403'

{
  printf 'checked_at_utc=%s\n' "$timestamp"
  printf 'domain=%s\n' "$domain"
  printf 'os='; . /etc/os-release; printf '%s %s\n' "$NAME" "$VERSION_ID"
  printf 'nginx_ubuntu_package=%s\n' "$installed_version"
  printf 'ubuntu_fixed_version_cve_2025_23419=%s\n' "$fixed_noble_version"
  printf 'server_header=%s\n' "$server_header"
  printf 'content_security_policy=present\n'
  printf 'application_waf=active\n'
  printf 'owasp_lfi_probe_http_status=%s\n' "$waf_status"
  printf 'nginx_configuration=valid\n'
} >"$proof_file"
chmod 0644 "$proof_file"

trap - ERR
echo
cat "$proof_file"
echo
echo "Backup: $backup_dir"
echo "Proof:  $proof_file"
