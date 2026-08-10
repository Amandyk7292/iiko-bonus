#!/usr/bin/env bash
set -Eeuo pipefail

deploy_user=${DEPLOY_USER:-deploy}
expected_fingerprint=${EXPECTED_DEPLOY_KEY_FINGERPRINT:-}
confirmation=${CONFIRM_DEPLOY_KEY_LOGIN:-}
install_fail2ban=${INSTALL_FAIL2BAN:-yes}
drop_in=/etc/ssh/sshd_config.d/99-bulka-hardening.conf
jail=/etc/fail2ban/jail.d/bulka-sshd.local
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
backup_dir="/var/backups/bulka-ssh-${timestamp}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run through sudo from the verified deploy-key session.' >&2
  exit 1
fi
if [[ ! $deploy_user =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo 'DEPLOY_USER is invalid.' >&2
  exit 1
fi
if [[ $confirmation != "${deploy_user}@key-session-verified-twice" ]]; then
  echo 'Two independent key-only deploy logins must be verified first.' >&2
  exit 1
fi
if [[ ! $expected_fingerprint =~ ^SHA256:[A-Za-z0-9+/]+$ ]]; then
  echo 'EXPECTED_DEPLOY_KEY_FINGERPRINT must be an OpenSSH SHA256 fingerprint.' >&2
  exit 1
fi
if ! id "$deploy_user" >/dev/null 2>&1; then
  echo "Deploy user ${deploy_user} does not exist." >&2
  exit 1
fi

authorized_keys="$(getent passwd "$deploy_user" | cut -d: -f6)/.ssh/authorized_keys"
test -f "$authorized_keys"
if ! ssh-keygen -lf "$authorized_keys" | awk '{print $2}' | grep -Fxq "$expected_fingerprint"; then
  echo 'The verified deploy key fingerprint is not installed on the VPS.' >&2
  exit 1
fi

install -d -m 0700 "$backup_dir"
if [[ -f $drop_in ]]; then cp -a "$drop_in" "$backup_dir/ssh-drop-in"; fi
if [[ -f $jail ]]; then cp -a "$jail" "$backup_dir/fail2ban-jail"; fi

rollback() {
  local status=$?
  trap - ERR
  if [[ -f $backup_dir/ssh-drop-in ]]; then
    cp -a "$backup_dir/ssh-drop-in" "$drop_in"
  else
    rm -f -- "$drop_in"
  fi
  if [[ -f $backup_dir/fail2ban-jail ]]; then
    install -d -m 0755 "$(dirname "$jail")"
    cp -a "$backup_dir/fail2ban-jail" "$jail"
  else
    rm -f -- "$jail"
  fi
  sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  systemctl restart fail2ban 2>/dev/null || true
  echo "SSH hardening failed and configuration was restored from ${backup_dir}." >&2
  exit "$status"
}
trap rollback ERR

if ! command -v fail2ban-server >/dev/null 2>&1; then
  if [[ $install_fail2ban != yes ]]; then
    echo 'fail2ban is missing; rerun with INSTALL_FAIL2BAN=yes.' >&2
    exit 1
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends fail2ban
fi

install -d -m 0755 /etc/ssh/sshd_config.d /etc/fail2ban/jail.d
cat >"$drop_in" <<EOF
# Managed by Bulka SSH hardening. Backup: ${backup_dir}
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
AllowUsers ${deploy_user}
EOF
chmod 0600 "$drop_in"

cat >"$jail" <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 4
findtime = 10m
bantime = 1h
bantime.increment = true
EOF
chmod 0644 "$jail"

sshd -t
effective=$(sshd -T -C "user=${deploy_user},host=bulka.com.kz,addr=127.0.0.1")
for setting in \
  'permitrootlogin no' \
  'passwordauthentication no' \
  'kbdinteractiveauthentication no' \
  'pubkeyauthentication yes' \
  'x11forwarding no'; do
  grep -Fxq "$setting" <<<"$effective"
done

systemctl enable --now fail2ban
systemctl restart fail2ban
systemctl is-active --quiet fail2ban
if systemctl list-unit-files ssh.service >/dev/null 2>&1; then
  systemctl reload ssh
else
  systemctl reload sshd
fi

trap - ERR
echo 'SSH hardening is active. Keep the current session open and verify two new key-only sessions.'
echo "Backup: ${backup_dir}"
