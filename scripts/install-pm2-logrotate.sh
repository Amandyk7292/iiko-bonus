#!/usr/bin/env bash
set -Eeuo pipefail

command -v pm2 >/dev/null

if ! pm2 describe pm2-logrotate >/dev/null 2>&1; then
  pm2 install pm2-logrotate
fi

pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:rotateModule true
pm2 save

configuration=$(pm2 conf)
grep -Fq 'pm2-logrotate:max_size 20M' <<<"$configuration"
grep -Fq 'pm2-logrotate:retain 14' <<<"$configuration"
grep -Fq 'pm2-logrotate:compress true' <<<"$configuration"

echo 'PM2 logs rotate at 20 MB, retain 14 archives and use gzip compression.'
