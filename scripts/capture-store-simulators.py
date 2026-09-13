import json, os, subprocess, time
from pathlib import Path

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, timeout=300, **kwargs).strip()

devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))['devices']
flat = [d for group in devices.values() for d in group]
selected = []
for family, match in [('iphone', 'iPhone 17 Pro Max'), ('ipad', 'iPad Pro 13-inch')]:
    candidates = [d for d in flat if match in d['name']]
    if not candidates:
        raise RuntimeError(f'Missing simulator {match}: {[d["name"] for d in flat]}')
    selected.append((family, candidates[0]))
for family, device in selected:
    udid = device['udid']
    if device['state'] != 'Booted': run('xcrun', 'simctl', 'boot', udid)
    run('xcrun', 'simctl', 'bootstatus', udid, '-b')
    run('xcrun', 'simctl', 'status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
    output = Path('store-screenshots') / family
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(['flutter', 'drive', '--driver=test_driver/store_screenshots.dart',
                    '--target=integration_test/store_screenshots_test.dart', '-d', udid,
                    '--dart-define=BULKA_API_BASE_URL=https://bulka.com.kz'],
                   env={**os.environ, 'SCREENSHOT_DIR': str(output.resolve())}, check=True, timeout=1200)
    import hashlib
    files = list(output.glob('*.png'))
    if len(files) != 3 or len({hashlib.sha256(f.read_bytes()).hexdigest() for f in files}) != 3:
        raise RuntimeError('Missing or duplicated screenshots')
    run('xcrun', 'simctl', 'shutdown', udid)
