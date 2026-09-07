"""Read dashboard credentials from stdin and update only their four dotenv keys.

Run over SSH; never supply passwords as command-line arguments.
The service reload is handled by the normal verified deployment.
"""
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


def configure():
    destination = Path('/var/www/iiko-bonus/.env')
    allowed = {f'IIKO_DASHBOARD_{city}_{field}' for city in ('AKTAU', 'ASTANA') for field in ('LOGIN', 'PASSWORD')}
    payload = json.loads(sys.stdin.read(16384))
    if set(payload) != allowed:
        raise ValueError('Unexpected configuration keys')
    for value in payload.values():
        if not isinstance(value, str) or not value or len(value) > 512 or any(c in value for c in '\r\n\0'):
            raise ValueError('Invalid configuration value')
    original = destination.read_text(encoding='utf-8')
    backup_dir = Path.home() / '.bulka-config-backups'
    backup_dir.mkdir(mode=0o700, exist_ok=True)
    backup = backup_dir / ('iiko-dashboard-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.env')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write(original)
    lines = [line for line in original.splitlines() if re.split(r'\s*=\s*', line, maxsplit=1)[0].strip() not in allowed]
    lines.extend(f'{key}={json.dumps(payload[key], ensure_ascii=False)}' for key in sorted(allowed))
    fd, temporary = tempfile.mkstemp(prefix='.iiko-dashboard-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write('\n'.join(lines) + '\n')
        os.chmod(temporary, 0o600)
        shutil.copystat(destination, temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('Dashboard credentials configured for two Chain servers; other settings preserved.')


if __name__ == '__main__':
    try:
        configure()
    except Exception:
        print('Dashboard configuration failed; secret values suppressed.', file=sys.stderr)
        sys.exit(1)
