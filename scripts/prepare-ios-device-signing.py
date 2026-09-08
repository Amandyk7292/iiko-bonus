"""Prepare ephemeral macOS signing inputs for the manual iPhone build."""
import base64
import datetime
import json
import os
from pathlib import Path
import plistlib
import secrets
import subprocess
import sys


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def prepare():
    if sys.platform != 'darwin':
        raise ValueError('Signing requires a macOS runner')
    app = Path.cwd()
    temp = Path(os.environ['RUNNER_TEMP']).resolve() / 'bulka-signing'
    temp.mkdir(mode=0o700, parents=True, exist_ok=True)
    profiles = {}
    for bundle, secret_name in [('com.bulka.bonus', 'IOS_APP_PROFILE'),
                                ('com.bulka.bonus.BulkaWidget', 'IOS_WIDGET_PROFILE')]:
        source = temp / (bundle + '.mobileprovision')
        source.write_bytes(base64.b64decode(os.environ[secret_name], validate=True))
        source.chmod(0o600)
        profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(source)))
        entitlement = profile['Entitlements']
        identifier = entitlement['application-identifier']
        if identifier.split('.', 1)[1] != bundle:
            raise ValueError('Provisioning profile bundle mismatch: ' + bundle)
        if profile['ExpirationDate'] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
            raise ValueError('Expired provisioning profile: ' + bundle)
        if not profile.get('ProvisionedDevices'):
            raise ValueError('Use development or ad hoc profiles for direct device installation')
        target = Path.home() / 'Library/MobileDevice/Provisioning Profiles'
        target.mkdir(parents=True, exist_ok=True)
        (target / (profile['UUID'] + '.mobileprovision')).write_bytes(source.read_bytes())
        profiles[bundle] = profile
    runner = profiles['com.bulka.bonus']
    team = runner['TeamIdentifier'][0]
    development = bool(runner['Entitlements'].get('get-task-allow'))
    for profile in profiles.values():
        if profile['TeamIdentifier'][0] != team:
            raise ValueError('App and widget profiles must use the same team')
        if bool(profile['Entitlements'].get('get-task-allow')) != development:
            raise ValueError('App and widget profile types must match')
    if not set.intersection(*(set(p['ProvisionedDevices']) for p in profiles.values())):
        raise ValueError('App and widget profiles have no common device')
    firebase = base64.b64decode(os.environ['IOS_FIREBASE_PLIST'], validate=True)
    if plistlib.loads(firebase).get('BUNDLE_ID') != 'com.bulka.bonus':
        raise ValueError('Firebase bundle mismatch')
    (app / 'ios/Runner/GoogleService-Info.plist').write_bytes(firebase)
    certificate = temp / 'certificate.p12'
    certificate.write_bytes(base64.b64decode(os.environ['IOS_CERTIFICATE_P12'], validate=True))
    certificate.chmod(0o600)
    keychain = temp / 'build.keychain-db'
    password = secrets.token_urlsafe(32)
    run('security', 'create-keychain', '-p', password, str(keychain))
    run('security', 'set-keychain-settings', '-lut', '21600', str(keychain))
    run('security', 'unlock-keychain', '-p', password, str(keychain))
    run('security', 'import', str(certificate), '-P', os.environ['IOS_CERTIFICATE_PASSWORD'],
        '-A', '-t', 'cert', '-f', 'pkcs12', '-k', str(keychain))
    run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
        '-k', password, str(keychain))
    run('security', 'list-keychains', '-d', 'user', '-s', str(keychain))
    identity = 'Apple Development' if development else 'Apple Distribution'
    settings = {}
    for bundle, profile in profiles.items():
        target = 'Runner' if bundle == 'com.bulka.bonus' else 'BulkaWidget'
        original = app / ('ios/Runner/RunnerRelease.entitlements' if target == 'Runner'
                          else 'ios/BulkaWidget/BulkaWidget.entitlements')
        entitlements = plistlib.loads(original.read_bytes())
        allowed = profile['Entitlements']
        if 'aps-environment' in entitlements:
            if 'aps-environment' not in allowed:
                raise ValueError('Profile must support push notifications')
            entitlements['aps-environment'] = allowed['aps-environment']
        for group in entitlements.get('com.apple.security.application-groups', []):
            if group not in allowed.get('com.apple.security.application-groups', []):
                raise ValueError('Profile is missing a required app group')
        path = temp / (target + '.entitlements')
        path.write_bytes(plistlib.dumps(entitlements))
        settings[target] = {'team': team, 'identity': identity,
                            'profile': profile['UUID'], 'entitlements': str(path)}
    (temp / 'targets.json').write_text(json.dumps(settings), encoding='utf-8')
    export = {'method': 'debugging' if development else 'release-testing',
              'signingStyle': 'manual', 'teamID': team, 'signingCertificate': identity,
              'provisioningProfiles': {b: p['UUID'] for b, p in profiles.items()},
              'manageAppVersionAndBuildNumber': False}
    (temp / 'ExportOptions.plist').write_bytes(plistlib.dumps(export))
    print('Validated app and widget profiles; prepared temporary signing keychain.')


if __name__ == '__main__':
    try:
        prepare()
    except subprocess.CalledProcessError:
        # Never echo command arguments: security commands contain passwords.
        sys.exit('Apple signing setup failed; check certificate and password secrets.')
    except (ValueError, KeyError) as error:
        sys.exit(str(error))
