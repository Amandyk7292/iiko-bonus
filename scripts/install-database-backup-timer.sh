#!/usr/bin/env bash
set -Eeuo pipefail

project=${BULKA_PROJECT_DIR:-/var/www/iiko-bonus}
service_file=/etc/systemd/system/bulka-database-backup.service
timer_file=/etc/systemd/system/bulka-database-backup.timer
backup_root=/home/deploy/.bulka-releases/database-backups
portable_root=/home/deploy/.bulka-tools/postgresql
portable_bin="$portable_root/usr/lib/postgresql/17/bin"
portable_lib="$portable_root/usr/lib/x86_64-linux-gnu"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script as root.' >&2
  exit 1
fi
if [[ $project != /var/www/iiko-bonus ]]; then
  echo "Unsafe project directory: $project" >&2
  exit 1
fi
if [[ ! -f "$project/.env" || ! -f "$project/scripts/backup-database.sh" ]]; then
  echo 'Bulka environment or backup script is missing.' >&2
  exit 1
fi
if {
  ! command -v pg_dump >/dev/null ||
    ! command -v pg_restore >/dev/null
} && {
  [[ ! -x "$portable_bin/pg_dump" ]] ||
    [[ ! -x "$portable_bin/pg_restore" ]]
}; then
  echo 'postgresql-client is required before enabling database backups.' >&2
  exit 2
fi
install -d -o deploy -g deploy -m 0700 "$backup_root"

cat >"$service_file" <<EOF
[Unit]
Description=Bulka verified PostgreSQL backup
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=deploy
Group=deploy
EnvironmentFile=$project/.env
Environment=PATH=$portable_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=LD_LIBRARY_PATH=$portable_lib
Environment=BULKA_DATABASE_BACKUP_DIR=$backup_root
Environment=BULKA_DATABASE_BACKUP_RETENTION_DAYS=14
ExecStart=/usr/bin/env bash $project/scripts/backup-database.sh
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$backup_root
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat >"$timer_file" <<'EOF'
[Unit]
Description=Run the Bulka database backup every day

[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true
RandomizedDelaySec=900
Unit=bulka-database-backup.service

[Install]
WantedBy=timers.target
EOF

chmod 0644 "$service_file" "$timer_file"
systemctl daemon-reload
systemctl enable --now bulka-database-backup.timer
systemctl start bulka-database-backup.service
systemctl --no-pager --full status bulka-database-backup.timer
