import json, os, subprocess, time
from pathlib import Path

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))['devices']
flat = [d for group in devices.values() for d in group]
selected = []
for family, match in [('iphone', 'iPhone 16 Plus'), ('ipad', 'iPad Pro 13-inch')]:
    candidates = [d for d in flat if match in d['name']]
    if not candidates:
        raise RuntimeError(f'Missing simulator {match}: {[d["name"] for d in flat]}')
    selected.append((family, candidates[0]))
for family, device in selected:
    udid = device['udid']
    if device['state'] != 'Booted': run('xcrun', 'simctl', 'boot', udid)
    run('xcrun', 'simctl', 'bootstatus', udid, '-b')
    run('xcrun', 'simctl', 'status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
    run('xcrun', 'simctl', 'install', udid, 'build/ios/iphonesimulator/Runner.app')
    output = Path('store-screenshots') / family
    output.mkdir(parents=True, exist_ok=True)
    for tab, name in [(1, '01-catalog'), (0, '02-home'), (3, '03-locations')]:
        subprocess.run(['xcrun', 'simctl', 'terminate', udid, 'com.bulka.bonus'], capture_output=True)
        run('xcrun', 'simctl', 'launch', udid, 'com.bulka.bonus', env={**os.environ, 'SIMCTL_CHILD_BULKA_SCREEN': str(tab)})
        time.sleep(30)
        run('xcrun', 'simctl', 'io', udid, 'screenshot', str(output / (name + '.png')))
    run('xcrun', 'simctl', 'shutdown', udid)
