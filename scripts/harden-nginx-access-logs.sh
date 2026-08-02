#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script through sudo.' >&2
  exit 1
fi

nginx_conf='/etc/nginx/nginx.conf'
site_conf='/etc/nginx/sites-available/iiko-bonus'
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
backup_dir="/var/backups/bulka-nginx-log-redaction-${timestamp}"
proof_file='/tmp/bulka-nginx-log-redaction-proof.txt'

test -f "$nginx_conf"
test -f "$site_conf"
install -d -m 0700 "$backup_dir"
cp -a "$nginx_conf" "$backup_dir/nginx.conf"
cp -a "$site_conf" "$backup_dir/iiko-bonus"

rollback() {
  local exit_code=$?
  trap - ERR
  cp -a "$backup_dir/nginx.conf" "$nginx_conf"
  cp -a "$backup_dir/iiko-bonus" "$site_conf"
  nginx -t && systemctl reload nginx || true
  exit "$exit_code"
}
trap rollback ERR

python3 - "$nginx_conf" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
directive = (
    "\tlog_format bulka_safe "
    """'$remote_addr - $remote_user [$time_local] """
    """"$request_method $uri $server_protocol" """
    """$status $body_bytes_sent "$http_user_agent"';"""
)
pattern = re.compile(r"(?m)^[ \t]*log_format[ \t]+bulka_safe[ \t]+.*?;[ \t]*$")

if pattern.search(text):
    text = pattern.sub(directive, text, count=1)
else:
    text, count = re.subn(
        r"(?m)^([ \t]*http[ \t]*\{[ \t]*)$",
        lambda match: f"{match.group(1)}\n{directive}",
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit("Could not locate the Nginx http block")

text, count = re.subn(
    r"(?m)^([ \t]*)access_log[ \t]+/var/log/nginx/access\.log(?:[ \t]+[^;]+)?;",
    lambda match: f"{match.group(1)}access_log /var/log/nginx/access.log bulka_safe;",
    text,
    count=1,
)
if count != 1:
    raise SystemExit("Could not locate the primary Nginx access log")

path.write_text(text, encoding="utf-8")
PY

nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx
sleep 2

probe="bulka_nginx_query_probe_${timestamp}"
curl -sS -o /dev/null \
  "https://bulka.com.kz/payment-receipts/00000000-0000-0000-0000-000000000000?expires=2000000000&token=${probe}"
if grep -F -q "$probe" /var/log/nginx/access.log; then
  echo 'Nginx still logged the query token.' >&2
  false
fi

{
  printf 'checked_at_utc=%s\n' "$timestamp"
  printf 'query_strings_logged=false\n'
  printf 'nginx_configuration=valid\n'
  printf 'nginx_service=active\n'
  printf 'backup=%s\n' "$backup_dir"
} >"$proof_file"
chmod 0644 "$proof_file"

trap - ERR
cat "$proof_file"
