"""Reject a wrong or non-device IPA before exposing it as an install artifact."""
import argparse
from pathlib import Path
import plistlib
import subprocess
import tempfile
import zipfile


def verify(directory, expected, app_store=False):
    packages = list(Path(directory).glob('*.ipa'))
    if len(packages) != 1:
        raise ValueError('Expected exactly one IPA')
    with zipfile.ZipFile(packages[0]) as archive:
        roots = [name for name in archive.namelist()
                 if name.startswith('Payload/') and name.endswith('.app/Info.plist')
                 and len(name.split('/')) == 3]
        if len(roots) != 1:
            raise ValueError('Expected exactly one application in IPA')
        info = plistlib.loads(archive.read(roots[0]))
        if info.get('CFBundleIdentifier') != expected:
            raise ValueError('Built IPA bundle ID mismatch')
        primary_icon = info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {})
        if primary_icon.get('CFBundleIconName') != 'BulkaSolid':
            raise ValueError('IPA still references the old app icon catalog')
        if not primary_icon.get('UIPrerenderedIcon'):
            raise ValueError('IPA is missing the prerendered icon setting')
        root = roots[0].rsplit('/', 1)[0]
        extensions = [name for name in archive.namelist()
                      if name.startswith(root + '/PlugIns/') and name.endswith('.appex/Info.plist')]
        if not extensions:
            raise ValueError('IPA is missing the widget extension')
        for extension in extensions:
            extension_info = plistlib.loads(archive.read(extension))
            for key in ('CFBundleVersion', 'CFBundleShortVersionString'):
                if not info.get(key) or extension_info.get(key) != info[key]:
                    raise ValueError(f'Extension {key} mismatch: {extension}')
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'embedded.mobileprovision'
            path.write_bytes(archive.read(root + '/embedded.mobileprovision'))
            profile = plistlib.loads(subprocess.check_output(
                ['security', 'cms', '-D', '-i', str(path)], stderr=subprocess.PIPE))
            if app_store and (profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices')
                              or profile.get('Entitlements', {}).get('get-task-allow')):
                raise ValueError('IPA profile is not for App Store distribution')
            if not app_store and not profile.get('ProvisionedDevices'):
                raise ValueError('IPA profile does not allow direct device installation')
        print('Verified IPA:', expected, 'version', info.get('CFBundleShortVersionString'),
              'build', info.get('CFBundleVersion'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--expected-bundle-id', required=True)
    parser.add_argument('--app-store', action='store_true')
    args = parser.parse_args()
    verify(args.directory, args.expected_bundle_id, args.app_store)
