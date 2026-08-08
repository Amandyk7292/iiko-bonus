# Bulka VPS rebuild runbook

This runbook rebuilds the application tier on a new Ubuntu 24.04 VPS without
depending on files from the failed host. The recovery-time objective is two
hours after a replacement VPS, DNS access, the protected production `.env`,
and the latest verified database/storage backups are available.

Do not copy an old `node_modules`, PM2 home, TLS private key, or unchecked
release directory from the failed host. Start a timer, keep an incident log,
and record every SHA and health result.

## Recovery inputs

Prepare these on a trusted recovery workstation before changing DNS:

- the 40-character commit SHA from a successful `CI` run on `main`;
- the `production-web-<SHA>` artifact from that same GitHub Actions run;
- a freshly decrypted production `.env` obtained from the approved escrow;
- the latest verified database dump and Supabase Storage snapshot when the
  managed database/storage service also needs recovery;
- the deploy SSH public key, DNS-provider access, and TLS contact email.

The artifact contains `BulkaAndroid/build/web`, `admin-ui/dist`, and
`artifacts/production-web/SHA256SUMS`. Download it from the successful workflow
run without using an artifact from a failed, cancelled, pull-request, or
different-SHA run. Extract it into a clean checkout and verify it:

```bash
git clone https://github.com/Amandyk7292/iiko-bonus.git bulka-recovery
cd bulka-recovery
git checkout --detach "${RELEASE_SHA:?set the successful 40-character SHA}"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
git status --porcelain --untracked-files=no | grep -q . && exit 1 || true
unzip ../production-web-${RELEASE_SHA}.zip
sha256sum --check artifacts/production-web/SHA256SUMS
test -f BulkaAndroid/build/web/release-version.json
test -f admin-ui/dist/index.html
```

Keep the checkout. It is used again for the first managed deployment.

## 0-25 minutes: secure base host

Log in to the replacement VPS as the provider's initial root user. Replace the
placeholder SSH key before running these commands:

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg nginx certbot \
  python3-certbot-nginx postgresql-client rsync unzip util-linux

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
  >/etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node -e 'if (process.versions.node.split(".")[0] !== "22") process.exit(1)'
npm install --global pm2@6.0.14

id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos '' deploy
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
printf '%s\n' 'REPLACE_WITH_APPROVED_DEPLOY_PUBLIC_KEY' \
  >/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys

install -d -o deploy -g deploy -m 0750 \
  /var/www/iiko-bonus \
  /home/deploy/iiko-bonus-staging/current \
  /home/deploy/.bulka-releases \
  /home/deploy/.bulka-releases/database-backups
```

Confirm a new SSH session can log in as `deploy` before closing the root
session. Disable root/password SSH login only after that check, following the
VPS provider's recovery-access policy. Do not grant blanket passwordless sudo;
the one-time Nginx and systemd steps below are performed by root.

## 25-50 minutes: install the attested release

Copy the clean recovery checkout to `/home/deploy/bulka-recovery` with `rsync`
or `scp`. Do not transfer `.git`, `.env`, `node_modules`, signing keys, or local
scratch files. Then run as root on the new VPS:

```bash
source_root=/home/deploy/bulka-recovery
project=/var/www/iiko-bonus
test -f "$source_root/BulkaAndroid/build/web/release-version.json"
test -f "$source_root/admin-ui/dist/index.html"

install -d -o deploy -g deploy -m 0750 \
  "$project/src" "$project/public" "$project/admin-ui/dist" \
  "$project/scripts" "$project/supabase/migrations"
rsync -a --delete "$source_root/src/" "$project/src/"
rsync -a --delete "$source_root/public/" "$project/public/"
rsync -a --delete "$source_root/BulkaAndroid/build/web/" "$project/public/app/"
rsync -a --delete "$source_root/admin-ui/dist/" "$project/admin-ui/dist/"
rsync -a --delete "$source_root/scripts/" "$project/scripts/"
rsync -a --delete "$source_root/supabase/migrations/" "$project/supabase/migrations/"
install -o deploy -g deploy -m 0640 \
  "$source_root/index.js" "$source_root/package.json" \
  "$source_root/package-lock.json" "$source_root/supabase_schema.sql" \
  "$project/"
chown -R deploy:deploy "$project"
```

From the recovery workstation, transfer the decrypted environment file to a
temporary path without printing its contents:

```bash
scp production.env deploy@NEW_VPS:/home/deploy/production.env.pending
```

On the VPS, verify the file owner and permissions, then install and remove the
temporary copy:

```bash
test "$(stat -c '%U' /home/deploy/production.env.pending)" = deploy
chmod 0600 /home/deploy/production.env.pending
install -o deploy -g deploy -m 0600 \
  /home/deploy/production.env.pending /var/www/iiko-bonus/.env
rm -f /home/deploy/production.env.pending
```

If Supabase is healthy, do not restore it merely because the VPS failed. If the
database or Storage also failed, follow [database-recovery.md](database-recovery.md),
restore into a new target first, validate it, and only then update the new
VPS `.env`. Never restore a dump over an unverified live target.

## 50-75 minutes: start production and private staging

Run application commands as `deploy`; background workers run only in the
production process:

```bash
sudo -u deploy -H bash -lc '
  set -Eeuo pipefail
  cd /var/www/iiko-bonus
  npm ci --omit=dev --no-audit --no-fund
  env NODE_ENV=production HOST=127.0.0.1 PORT=3000 \
    pm2 start src/server.js --name iiko-bonus --cwd /var/www/iiko-bonus --update-env

  rsync -a --delete --exclude=.env \
    /var/www/iiko-bonus/ /home/deploy/iiko-bonus-staging/current/
  ln -sfn /var/www/iiko-bonus/.env /home/deploy/iiko-bonus-staging/current/.env
  cd /home/deploy/iiko-bonus-staging/current
  npm ci --omit=dev --no-audit --no-fund
  env NODE_ENV=production HOST=127.0.0.1 PORT=3101 \
    RUN_BOTS=false RUN_BACKGROUND_WORKERS=false \
    RUN_WHATSAPP_OUTBOX_WORKER=false RUN_YANDEX_DELIVERY_WORKER=false \
    YANDEX_DELIVERY_ENABLED=false GEMINI_ASSISTANT_ENABLED=false \
    pm2 start src/server.js --name iiko-bonus-staging \
      --cwd /home/deploy/iiko-bonus-staging/current --update-env
  pm2 save
'

env PATH="$PATH:/usr/bin" pm2 startup systemd -u deploy --hp /home/deploy
sudo -u deploy -H bash -lc 'pm2 save'
curl -fsS http://127.0.0.1:3000/readyz
curl -fsS http://127.0.0.1:3101/readyz
```

Install the pinned PM2 log rotation after its script is present:

```bash
sudo -u deploy -H bash -lc \
  'bash /var/www/iiko-bonus/scripts/install-pm2-logrotate.sh'
```

## 75-100 minutes: Nginx, TLS, and DNS

Create `/etc/nginx/conf.d/bulka-backend-upstream.conf`:

```nginx
upstream bulka_backend {
    server 127.0.0.1:3000 max_fails=1 fail_timeout=2s;
    server 127.0.0.1:3101 backup max_fails=1 fail_timeout=2s;
    keepalive 32;
}
```

Create `/etc/nginx/sites-available/iiko-bonus` before requesting the
certificate:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name bulka.com.kz www.bulka.com.kz;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://bulka_backend;
    }
}
```

Enable and validate it, point DNS at the replacement VPS, then request TLS:

```bash
ln -s /etc/nginx/sites-available/iiko-bonus /etc/nginx/sites-enabled/iiko-bonus
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
certbot --nginx -d bulka.com.kz -d www.bulka.com.kz \
  --redirect --agree-tos --no-eff-email --email 'REPLACE_WITH_TLS_CONTACT'
nginx -t
systemctl is-active --quiet nginx
systemctl is-enabled --quiet certbot.timer
```

Run the versioned access-log hardening script as root. Activate Cloudflare and
origin lockdown only in the order documented in [external-waf.md](external-waf.md):

```bash
bash /var/www/iiko-bonus/scripts/harden-nginx-access-logs.sh
```

## 100-120 minutes: verification and managed release baseline

Verify loopback and public endpoints before declaring recovery:

```bash
curl -fsS http://127.0.0.1:3000/livez
curl -fsS http://127.0.0.1:3000/readyz
curl -fsS https://bulka.com.kz/livez
curl -fsS https://bulka.com.kz/readyz
curl -fsS https://bulka.com.kz/admin/ >/dev/null
curl -fsS https://bulka.com.kz/.well-known/apple-app-site-association >/dev/null
curl -fsS https://bulka.com.kz/.well-known/assetlinks.json >/dev/null
```

On the recovery workstation, run the browser smoke test against the public
host, then create the first managed release/rollback snapshot from the same
clean SHA and already verified CI artifact:

```powershell
$env:BULKA_RELEASE_URL = 'https://bulka.com.kz'
python .\scripts\e2e-release-smoke.py

.\scripts\deploy-vps.ps1
```

The deploy command must attest a clean `main` HEAD equal to the live
`origin/main` SHA and a successful GitHub `CI` run. It downloads and verifies
the exact production-web artifact again; ignored files copied for the manual
bootstrap are never trusted as the managed release input. Set `GITHUB_TOKEN`
with repository `Actions: read` permission for the artifact download. Never put
that token on the command line.

Finally install the database backup timer, confirm the offsite job from the
recovery workstation, and record evidence:

```bash
bash /var/www/iiko-bonus/scripts/install-database-backup-timer.sh
systemctl list-timers --all | grep bulka
sudo -u deploy -H pm2 status
find /home/deploy/.bulka-releases -maxdepth 2 -name .healthy -print
```

Record the recovered SHA, GitHub run ID, artifact checksum result, database
recovery point, DNS/TLS timestamps, `/readyz` result, browser smoke result, PM2
process list, backup timer, and the operator who completed each stage. If any
required check fails at the two-hour boundary, keep the incident open and do
not describe the service as recovered.

## Emergency provenance bypass

The normal release gate is mandatory. During an incident, an accountable
operator may explicitly bypass only the origin/CI attestation while the clean
working-tree check remains enforced:

```powershell
.\scripts\deploy-vps.ps1 `
  -EmergencyBypassProvenanceGate `
  -EmergencyBypassReason 'INC-123: approved by owner at 2026-08-08T12:00Z'
```

The script prints a prominent warning and records the reason in the release
manifest. Follow up by pushing the exact commit, obtaining a successful CI run,
and redeploying normally.
