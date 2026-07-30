#!/usr/bin/env bash
set -Eeuo pipefail

project='/var/www/iiko-bonus'
env_file="$project/.env"
service_user='deploy'
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
changed=0

current_user=$(id -un)
if [[ $current_user == 'root' ]]; then
  backup_root='/var/backups'
elif [[ $current_user == "$service_user" ]]; then
  backup_root='/home/deploy/.bulka-config-backups'
else
  echo "Run this script as root or ${service_user}." >&2
  exit 1
fi
backup="${backup_root}/bulka-iiko-astana-${timestamp}.env"
test -d "$project"
test -f "$env_file"
test -f "$project/scripts/probe-iiko-city-profile.js"
command -v node >/dev/null
command -v curl >/dev/null
id "$service_user" >/dev/null 2>&1
if [[ $current_user == 'root' ]]; then
  command -v sudo >/dev/null
  sudo -u "$service_user" -H bash -lc 'command -v pm2 >/dev/null'
else
  command -v pm2 >/dev/null
fi

restart_production() {
  if [[ $current_user == 'root' ]]; then
    sudo -u "$service_user" -H bash -lc \
      "cd '$project' && env HOST=127.0.0.1 pm2 reload iiko-bonus --update-env"
  else
    (
      cd "$project"
      env HOST=127.0.0.1 pm2 reload iiko-bonus --update-env
    )
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ $changed -eq 1 && -f $backup ]]; then
    echo 'Activation failed; restoring the previous iiko configuration.' >&2
    cp -a -- "$backup" "$env_file"
    restart_production >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap rollback ERR

echo
echo 'Bulka · separate iiko Cloud profile for Astana'
echo 'The API login is hidden and written only to the VPS environment.'
echo 'The existing IIKO_API_LOGIN and other default-city settings are not changed.'
echo
read -r -s -p 'Astana iiko Cloud API login: ' api_login
echo

if (( ${#api_login} < 16 || ${#api_login} > 256 )); then
  echo 'The API login has an unexpected length.' >&2
  exit 1
fi
if [[ $api_login =~ [[:space:][:cntrl:]] ]]; then
  echo 'The API login must not contain whitespace or control characters.' >&2
  exit 1
fi

echo 'Checking the Astana External Menu and prices with a read-only request...'
export BULKA_IIKO_CITY_API_LOGIN="$api_login"
probe_output=$(
  cd "$project"
  DOTENV_CONFIG_PATH="$env_file" NODE_ENV=development \
    node -r dotenv/config scripts/probe-iiko-city-profile.js
)
probe_json=$(printf '%s\n' "$probe_output" | tail -n 1)
printf '%s\n' "$probe_output" | sed '$d'
export BULKA_IIKO_PROBE_JSON="$probe_json"

probe_summary=$(
  node -e '
    const data = JSON.parse(process.env.BULKA_IIKO_PROBE_JSON || "{}");
    if (data.status !== "ok" || !data.organizationId || !data.externalMenuId) process.exit(1);
    process.stdout.write(
      `${data.productsCount} products, ${data.categoriesCount} categories, ` +
      `organization ${data.organizationId}, menu ${data.externalMenuId}`
    );
  '
)
echo "Astana iiko credentials accepted: ${probe_summary}."

install -d -m 0700 "$backup_root"
cp -a -- "$env_file" "$backup"
chmod 0600 "$backup"

export BULKA_IIKO_ENV_FILE="$env_file"
node <<'NODE'
const fs = require('node:fs');

const file = process.env.BULKA_IIKO_ENV_FILE;
const probe = JSON.parse(process.env.BULKA_IIKO_PROBE_JSON || '{}');
const updates = new Map([
  ['IIKO_ASTANA_API_LOGIN', process.env.BULKA_IIKO_CITY_API_LOGIN],
  ['IIKO_ASTANA_ORGANIZATION_ID', probe.organizationId || ''],
  ['IIKO_ASTANA_EXTERNAL_MENU_ID', probe.externalMenuId || ''],
  ['IIKO_ASTANA_PRICE_CATEGORY_ID', probe.priceCategoryId || ''],
  ['IIKO_ASTANA_PRICE_CATEGORY_NAME', probe.priceCategoryName || ''],
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
const temporary = `${file}.iiko-astana.tmp`;
fs.writeFileSync(temporary, `${lines.join('\n').replace(/\n+$/, '')}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
fs.renameSync(temporary, file);
NODE
if [[ $current_user == 'root' ]]; then
  chown --reference="$backup" "$env_file"
fi
chmod 0600 "$env_file"
changed=1

unset api_login BULKA_IIKO_CITY_API_LOGIN

echo 'Restarting Bulka production...'
restart_production
for _attempt in {1..30}; do
  if curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS 'http://127.0.0.1:3000/readyz' >/dev/null

astana_branch_id=$(
  cd "$project"
  DOTENV_CONFIG_PATH="$env_file" node -r dotenv/config <<'NODE'
const { supabase } = require('./src/config/supabase');
(async () => {
  const { data, error } = await supabase
    .from('bulka_locations')
    .select('id')
    .ilike('city', 'Астана')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('No active Astana branch found');
  process.stdout.write(String(data.id));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
)

curl -fsS \
  --get \
  --data-urlencode "branchId=${astana_branch_id}" \
  --data-urlencode 'orderType=pickup' \
  'http://127.0.0.1:3000/api/guest/menu' |
  node -e '
    let source = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { source += chunk; });
    process.stdin.on("end", () => {
      const data = JSON.parse(source);
      if (!data.success || data.iikoProfile !== "astana" || !Array.isArray(data.products)) {
        process.exit(1);
      }
      process.stdout.write(`ASTANA_IIKO_ACTIVE products=${data.products.length}\n`);
    });
  '

if [[ $current_user == 'root' ]]; then
  sudo -u "$service_user" -H bash -lc 'pm2 save' >/dev/null
else
  pm2 save >/dev/null
fi
changed=0
trap - ERR

echo 'The default IIKO_API_LOGIN remains unchanged.'
