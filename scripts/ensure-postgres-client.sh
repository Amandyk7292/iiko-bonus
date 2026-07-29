#!/usr/bin/env bash
set -Eeuo pipefail

target=/home/deploy/.bulka-tools/postgresql
temporary=$(mktemp -d /tmp/bulka-postgresql-client.XXXXXX)
next="${target}.next"
previous="${target}.previous"
pg_bin="$target/usr/lib/postgresql/16/bin"
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
apt-get download postgresql-client-16 libpq5 >/dev/null
install -d -m 0755 "$next"
for archive in ./*.deb; do
  dpkg-deb -x "$archive" "$next"
done

next_bin="$next/usr/lib/postgresql/16/bin"
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
