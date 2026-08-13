# Production edge operations

The application-level fixes do not grant DNS, root, Cloudflare, or alert-receiver
authority. Complete the steps below from the accounts that own those controls.
Never disable the existing route until the replacement has passed its checks.

## SSH

From a trusted workstation, prove two fresh, independent key-only sessions first:

```powershell
ssh -o BatchMode=yes -o ControlMaster=no bulka-vps 'id -un'
ssh -o BatchMode=yes -o ControlMaster=no bulka-vps 'id -un'
ssh-keygen -lf "$HOME/.ssh/bulka_vps_ed25519.pub"
```

Keep one session and the provider console open. Upload
`scripts/harden-vps-ssh.sh`, then run it through `sudo`, supplying the fingerprint
printed above:

```bash
sudo EXPECTED_DEPLOY_KEY_FINGERPRINT='SHA256:REPLACE_ME' \
  CONFIRM_DEPLOY_KEY_LOGIN='deploy@key-session-verified-twice' \
  INSTALL_FAIL2BAN=yes bash ./harden-vps-ssh.sh
```

Do not close the original session until two new sessions work and
`systemctl is-active fail2ban` reports `active`. The script validates `sshd`,
backs up the previous files, and restores them automatically if validation or
reload fails. Provider-console access is the recovery path for an operator
mistake after a successful reload.

## `www` DNS and certificate

In the authoritative Hoster.kz DNS account, replace the obsolete
`www.bulka.com.kz` record with a CNAME to `bulka.com.kz` (or the same approved
origin A record). Preserve the previous record and TTL in the change record.
After public resolvers return the approved origin, run:

```bash
sudo EXPECTED_ORIGIN_IP='REPLACE_WITH_APPROVED_ORIGIN' \
  CONFIRM_DNS_WWW='www.bulka.com.kz' bash ./scripts/activate-www-domain.sh
```

This expands the existing certificate and adds a permanent redirect to the
canonical apex. It refuses to run while apex and `www` resolve differently.

## External WAF

Follow `docs/external-waf.md`. DNS must be moved to the verified Cloudflare
account before `prepare-cloudflare-origin.sh` is run. The origin-lockdown step
is deliberately fail-closed and must not be run against the current Hoster.kz
nameservers.

## Independent monitoring and alerts

`.github/workflows/production-monitor.yml` checks health, readiness, release
provenance, TLS, and the canonical `www` redirect every ten minutes outside the
VPS. GitHub Actions records a failed check even when the application host is
offline and keeps one open `[monitor] Production edge is unhealthy` incident
issue updated with the latest failed run. Close that issue only after a clean
manual workflow run.

Configure these GitHub Actions secrets in the repository settings:

- `PRODUCTION_MONITOR_WEBHOOK_URL`: an HTTPS receiver owned by operations;
- `PRODUCTION_MONITOR_BEARER_TOKEN`: optional receiver credential.

Configure the same operations receiver in the VPS environment as
`OPS_ALERT_WEBHOOK_URL` and, when required, `OPS_ALERT_BEARER_TOKEN`. Restart
through the normal attested deployment, then trigger a supervised test alert at
the receiver; never test by deliberately stopping production. The receiver must
return a 2xx response and deduplicate retries by the `Idempotency-Key` header.

Staff-order alerts use a durable database queue and the same receiver. Keep
`STAFF_ORDER_ACCEPT_SLA_SECONDS=120`. After the receiver is verified, set
`OPS_ALERT_RECEIVER_REQUIRED=true` so a missing receiver or unreadable alert
queue fails readiness. The durable alert queue always gates readiness. In
required mode, an alert backlog older than five minutes also fails readiness.
Before that switch, detailed readiness and Prometheus metrics report a missing
receiver as degraded/config-pending without stopping production.
An "active iPad" means a currently authorized, non-revoked iOS enrollment that
has sent a kitchen-screen heartbeat within the last 90 seconds. The embedded
staff UI sends it every 30 seconds while the kitchen page is visible and online;
backgrounded, disconnected, expired-session, or revoked devices fail coverage.
The `no_active_ipad` incident is demand-triggered: it opens when a branch has a
fresh paid, unaccepted order but no active kitchen iPad. It is intentionally not
an all-night branch-presence alarm; add an explicit shift schedule before making
idle branches alert outside active order demand.
Production staff push also requires `RUN_BACKGROUND_WORKERS=true`, valid Firebase
service-account credentials, and `STAFF_PUSH_REQUIRED=true`. Required mode makes
readiness fail if the workers are disabled or Firebase messaging cannot initialize.

Each paid order has two independent staff-push episodes: the immediate new-order
push and one reminder due 60 seconds after the durable paid transition. The reminder
uses its own provider ID and dedupe key, but keeps the original paid-transition
expiry, so neither notification can live longer than 15 minutes. Its recipient
snapshot includes every still-authorized, non-revoked iOS cashier enrollment for the
branch, even when the app was backgrounded and its 90-second coverage heartbeat is
stale. Authorization, branch, token, order state, acceptance state, and TTL are
revalidated immediately before contacting Firebase. A terminal reminder failure or
uncertain outcome enters the same durable operations-alert queue; no Telegram-specific
integration is required.

The kitchen screen is the on-device fallback: while a paid order remains server-
confirmed `queued`, it shows a sticky critical banner and repeats one shared siren
every 25 seconds. iPad Safari may require the visible **Enable/Unlock sound** action
after launch or an audio interruption. The alarm stops only after the server commits
the first `queued -> preparing` acknowledgement. That acknowledgement records a
server-derived actor, timestamp, session hash, and (when unambiguous) installation;
only a masked iPad label is returned to the admin UI. Visibility, reconnect, and
online events trigger an immediate coalesced refresh so a different iPad's acceptance
clears the alarm without waiting for the 30-second poll.

After Cloudflare is active, set the GitHub Actions repository variable
`PRODUCTION_REQUIRE_CLOUDFLARE=true`. The monitor will then fail whenever the
`CF-Ray` signal disappears.
