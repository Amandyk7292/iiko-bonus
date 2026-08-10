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
the receiver; never test by deliberately stopping production.

After Cloudflare is active, set the GitHub Actions repository variable
`PRODUCTION_REQUIRE_CLOUDFLARE=true`. The monitor will then fail whenever the
`CF-Ray` signal disappears.
