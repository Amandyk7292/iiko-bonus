#!/usr/bin/env bash
set -Eeuo pipefail

target=/home/deploy/.bulka-tools/postgresql
temporary=$(mktemp -d /tmp/bulka-postgresql-client.XXXXXX)
next="${target}.next"
previous="${target}.previous"
client_major=17
pg_bin="$target/usr/lib/postgresql/$client_major/bin"
pg_lib="$target/usr/lib/x86_64-linux-gnu"

case "$target" in
  /home/deploy/.bulka-tools/postgresql) ;;
  *) echo 'Unsafe PostgreSQL tool directory.' >&2; exit 1 ;;
esac
trap 'rm -rf -- "$temporary" "$next"' EXIT

if env LD_LIBRARY_PATH="$pg_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$pg_bin/pg_dump" --version >/dev/null 2>&1 &&
  env LD_LIBRARY_PATH="$pg_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$pg_bin/pg_restore" --version >/dev/null 2>&1; then
  echo 'Portable PostgreSQL backup tools are ready.'
  exit 0
fi

cd "$temporary"
source /etc/os-release
case "${VERSION_CODENAME:-}" in
  noble | jammy) distribution="${VERSION_CODENAME}-pgdg" ;;
  *) echo 'Unsupported Ubuntu release for PostgreSQL client.' >&2; exit 1 ;;
esac
architecture=$(dpkg --print-architecture)
case "$architecture" in
  amd64 | arm64) ;;
  *) echo "Unsupported PostgreSQL client architecture: $architecture" >&2; exit 1 ;;
esac

apt_root="$temporary/apt"
keyring="$apt_root/postgresql.gpg"
sources="$apt_root/postgresql.list"
install -d -m 0755 \
  "$apt_root/var/lib/apt/lists/partial" \
  "$apt_root/var/cache/apt/archives/partial"
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc |
  gpg --batch --yes --dearmor --output "$keyring"
chmod 0644 "$keyring"
printf \
  'deb [arch=%s signed-by=%s] https://apt.postgresql.org/pub/repos/apt %s main\n' \
  "$architecture" \
  "$keyring" \
  "$distribution" >"$sources"
apt_options=(
  -o "Dir::Etc::sourcelist=$sources"
  -o "Dir::Etc::sourceparts=-"
  -o "Dir::State=$apt_root/var/lib/apt"
  -o "Dir::Cache=$apt_root/var/cache/apt"
  -o APT::Get::List-Cleanup=0
  -o Acquire::Languages=none
)
apt-get "${apt_options[@]}" update >/dev/null
apt-get "${apt_options[@]}" download "postgresql-client-$client_major" libpq5 >/dev/null
install -d -m 0755 "$next"
for archive in ./*.deb; do
  dpkg-deb -x "$archive" "$next"
done

next_bin="$next/usr/lib/postgresql/$client_major/bin"
next_lib="$next/usr/lib/x86_64-linux-gnu"
env LD_LIBRARY_PATH="$next_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$next_bin/pg_dump" --version
env LD_LIBRARY_PATH="$next_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$next_bin/pg_restore" --version

if [[ -d $target ]]; then
  rm -rf -- "$previous"
  mv -- "$target" "$previous"
fi
mv -- "$next" "$target"
echo "Portable PostgreSQL client installed in $target"
