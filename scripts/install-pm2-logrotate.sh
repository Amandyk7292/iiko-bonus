#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly logrotate_version='3.0.0'
readonly logrotate_package="pm2-logrotate@${logrotate_version}"
readonly expected_pm2_home="${HOME:?HOME is required}/.pm2"
pm2_home=${PM2_HOME:-$expected_pm2_home}

command -v pm2 >/dev/null
command -v node >/dev/null

if [[ $(realpath -m -- "$pm2_home") != $(realpath -m -- "$expected_pm2_home") ]]; then
  echo "Unsafe PM2_HOME for log rotation: $pm2_home" >&2
  exit 1
fi

secure_directory() {
  local directory=$1
  if [[ -e $directory || -L $directory ]]; then
    [[ -d $directory && ! -L $directory ]] || {
      echo "Refusing unsafe PM2 directory: $directory" >&2
      return 1
    }
  else
    mkdir -p -- "$directory"
  fi
  chmod 0700 -- "$directory"
}

secure_regular_file() {
  local file=$1
  [[ -e $file || -L $file ]] || return 0
  [[ -f $file && ! -L $file ]] || {
    echo "Refusing unsafe PM2 file: $file" >&2
    return 1
  }
  chmod 0600 -- "$file"
}

secure_directory "$pm2_home"
secure_directory "$pm2_home/logs"
secure_directory "$pm2_home/pids"
secure_directory "$pm2_home/modules"

module_manifest="$pm2_home/modules/pm2-logrotate/node_modules/pm2-logrotate/package.json"
module_root="$pm2_home/modules/pm2-logrotate"
if [[ -e $module_root || -L $module_root ]]; then
  [[ -d $module_root && ! -L $module_root ]] || {
    echo "Refusing unsafe PM2 module directory: $module_root" >&2
    exit 1
  }
fi
installed_version=''
if [[ -f $module_manifest && ! -L $module_manifest ]]; then
  installed_version=$(node -p 'require(process.argv[1]).version' "$module_manifest" 2>/dev/null || true)
fi

if [[ $installed_version != "$logrotate_version" ]] ||
  ! pm2 describe pm2-logrotate >/dev/null 2>&1; then
  pm2 uninstall pm2-logrotate >/dev/null 2>&1 || true
  pm2 install "$logrotate_package"
fi

[[ -d $module_root && ! -L $module_root ]]
[[ -f $module_manifest && ! -L $module_manifest ]]
actual_version=$(node -p 'require(process.argv[1]).version' "$module_manifest")
if [[ $actual_version != "$logrotate_version" ]]; then
  echo "Unexpected pm2-logrotate version: $actual_version" >&2
  exit 1
fi
pm2 describe pm2-logrotate >/dev/null

pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:rotateModule true
pm2 save

secure_directory "$pm2_home"
secure_directory "$pm2_home/logs"
secure_directory "$pm2_home/pids"
secure_directory "$pm2_home/modules"
while IFS= read -r -d '' log_file; do
  secure_regular_file "$log_file"
done < <(find "$pm2_home/logs" -maxdepth 1 -type f -print0)
symlinked_log=$(find "$pm2_home/logs" -maxdepth 1 -type l -print -quit)
if [[ -n $symlinked_log ]]; then
  echo "Refusing symlinked file in PM2 logs: $pm2_home/logs" >&2
  exit 1
fi
secure_regular_file "$pm2_home/dump.pm2"
secure_regular_file "$pm2_home/pm2.log"

configuration=$(pm2 conf)
grep -Fq 'pm2-logrotate:max_size 20M' <<<"$configuration"
grep -Fq 'pm2-logrotate:retain 14' <<<"$configuration"
grep -Fq 'pm2-logrotate:compress true' <<<"$configuration"

echo "PM2 log rotation ${logrotate_version} is pinned; logs are private, rotate at 20 MB and retain 14 gzip archives."
