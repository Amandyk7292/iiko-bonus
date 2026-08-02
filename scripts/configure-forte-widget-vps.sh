#!/usr/bin/env bash
set -Eeuo pipefail

project='/var/www/iiko-bonus'
env_file="$project/.env"
service_user='deploy'
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
backup="/var/backups/bulka-forte-widget-${timestamp}.env"
changed=0

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script through sudo.' >&2
  exit 1
fi
test -d "$project"
test -f "$env_file"
command -v node >/dev/null
command -v openssl >/dev/null
command -v sudo >/dev/null
id "$service_user" >/dev/null 2>&1
sudo -u "$service_user" -H bash -lc 'command -v pm2 >/dev/null'

restart_production() {
  sudo -u "$service_user" -H bash -lc \
    "cd '$project' && env HOST=127.0.0.1 pm2 restart iiko-bonus --update-env"
}

save_process_list() {
  sudo -u "$service_user" -H bash -lc 'pm2 save'
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ $changed -eq 1 && -f $backup ]]; then
    echo 'Activation failed; restoring the previous environment.' >&2
    cp -a -- "$backup" "$env_file"
    restart_production >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap rollback ERR

echo
echo 'Forte E-commerce Payment Widget activation'
echo 'Values are hidden while typing and are written only to the VPS environment.'
echo
read -r -p 'Shop ID: ' shop_id
read -r -s -p 'Secret Key: ' secret_key
echo
read -r -s -p 'RSA public key (base64, one line): ' webhook_public_key
echo

shop_id=$(printf '%s' "$shop_id" | tr -d '[:space:]')
webhook_public_key=$(printf '%s' "$webhook_public_key" | tr -d '[:space:]')
if [[ ! $shop_id =~ ^[0-9]{1,20}$ ]]; then
  echo 'Shop ID must contain only digits.' >&2
  exit 1
fi
if (( ${#secret_key} < 16 || ${#secret_key} > 512 )); then
  echo 'Secret Key has an unexpected length.' >&2
  exit 1
fi
if [[ ! $webhook_public_key =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  echo 'RSA public key must be copied from the Forte cabinet as one base64 line.' >&2
  exit 1
fi
if ! printf '%s' "$webhook_public_key" |
  base64 --decode 2>/dev/null |
  openssl pkey -pubin -inform DER -noout >/dev/null 2>&1; then
  echo 'RSA public key is not a valid public key.' >&2
  exit 1
fi

echo 'Checking Shop ID and Secret Key with a read-only request...'
probe_token='0000000000000000000000000000000000000000000000000000000000000000'
probe_status=$(
  curl -sS \
    --connect-timeout 10 \
    --max-time 20 \
    -o /dev/null \
    -w '%{http_code}' \
    -u "${shop_id}:${secret_key}" \
    -H 'Accept: application/json' \
    -H 'X-API-Version: 2' \
    "https://securepayments.fortebank.com/ctp/api/checkouts/${probe_token}"
)
if [[ $probe_status == '000' || $probe_status == '401' || $probe_status == '403' ]]; then
  echo "Forte rejected the credentials (HTTP ${probe_status})." >&2
  exit 1
fi
echo "Credentials accepted (safe probe HTTP ${probe_status})."

token_key=$(
  cd "$project"
  DOTENV_CONFIG_PATH="$env_file" node -r dotenv/config -e \
    'process.stdout.write(String(process.env.FORTE_WIDGET_TOKEN_KEY || ""))'
)
if (( ${#token_key} < 32 )); then
  token_key=$(openssl rand -base64 48 | tr -d '\r\n')
fi

install -d -m 0700 /var/backups
cp -a -- "$env_file" "$backup"
chmod 0600 "$backup"

export BULKA_FORTE_SHOP_ID="$shop_id"
export BULKA_FORTE_SECRET_KEY="$secret_key"
export BULKA_FORTE_TOKEN_KEY="$token_key"
export BULKA_FORTE_WEBHOOK_PUBLIC_KEY="$webhook_public_key"
export BULKA_FORTE_ENV_FILE="$env_file"
node <<'NODE'
const fs = require('node:fs');

const file = process.env.BULKA_FORTE_ENV_FILE;
const updates = new Map([
  ['FORTE_WIDGET_ENABLED', 'true'],
  ['FORTE_WIDGET_CHECKOUT_ENABLED', 'true'],
  ['FORTE_WIDGET_SHOP_ID', process.env.BULKA_FORTE_SHOP_ID],
  ['FORTE_WIDGET_SECRET_KEY', process.env.BULKA_FORTE_SECRET_KEY],
  ['FORTE_WIDGET_TOKEN_KEY', process.env.BULKA_FORTE_TOKEN_KEY],
  ['FORTE_WIDGET_WEBHOOK_PUBLIC_KEY', process.env.BULKA_FORTE_WEBHOOK_PUBLIC_KEY],
  ['FORTE_WIDGET_TEST_MODE', 'false'],
  ['FORTE_WIDGET_APPLE_PAY_ENABLED', 'false'],
  ['FORTE_WIDGET_CHECKOUT_API_URL', 'https://securepayments.fortebank.com'],
  ['FORTE_WIDGET_TRANSACTION_API_URL', 'https://gateway.fortebank.com'],
]);
const source = fs.readFileSync(file, 'utf8');
const seen = new Set();
const lines = source.split(/\r?\n/).map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  if (!match || !updates.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${JSON.stringify(String(updates.get(match[1])))}`;
});
for (const [key, value] of updates) {
  if (!seen.has(key)) lines.push(`${key}=${JSON.stringify(String(value))}`);
}
const temporary = `${file}.forte-widget.tmp`;
fs.writeFileSync(temporary, `${lines.join('\n').replace(/\n+$/, '')}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
fs.renameSync(temporary, file);
NODE
chown --reference="$backup" "$env_file"
chmod 0600 "$env_file"
changed=1

unset BULKA_FORTE_SECRET_KEY BULKA_FORTE_TOKEN_KEY secret_key token_key

(
  cd "$project"
  DOTENV_CONFIG_PATH="$env_file" NODE_ENV=development node -r dotenv/config -e '
    const service = require("./src/services/forte-widget.service");
    if (!service.availability()) process.exit(1);
  '
)

echo 'Restarting Bulka production...'
restart_production
for _attempt in {1..30}; do
  if curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null
curl -fsS 'https://bulka.com.kz/payments/forte-widget' >/dev/null
save_process_list >/dev/null

changed=0
trap - ERR
echo
echo 'FORTE_WIDGET_ACTIVE'
echo 'Google Pay is available on supported devices. Apple Pay remains disabled pending Apple registration.'
