"""Verify iOS release contents, distribution identity, and artifact provenance."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import zipfile


WORKFLOW = '.github/workflows/ios-device-build.yml'
PROVENANCE = 'release-provenance.json'
SHOREBIRD_APP = 'aa065f22-7fd3-458b-99ff-9c6fd096355f'
LAUNCH_SHA = 'd0e12de33820f8ccc2fe1bac034a73bd4f6e2b426f8d56593cc00e264b54a1b0'


def validate_source_run(run, artifacts, expected_sha, repository, run_id):
    if not re.fullmatch(r'[0-9a-f]{40}', expected_sha):
        raise ValueError('Expected a full source commit SHA')
    if not re.fullmatch(r'[1-9][0-9]*', str(run_id)):
        raise ValueError('Expected a numeric build workflow run ID')
    if (str(run.get('id')) != str(run_id) or run.get('event') != 'workflow_dispatch'
            or run.get('conclusion') != 'success' or run.get('status') != 'completed'
            or run.get('path') != WORKFLOW or run.get('head_sha') != expected_sha
            or run.get('head_branch') != 'main'
            or run.get('head_repository', {}).get('full_name') != repository):
        raise ValueError('IPA must come from the successful trusted main release workflow')
    name = f'bulka-iphone-appstore-release-{expected_sha}'
    matches = [item for item in artifacts if item.get('name') == name]
    if len(matches) != 1 or matches[0].get('expired'):
        raise ValueError('Expected exactly one unexpired App Store release artifact')
    return name


def _verify_profile(archive, bundle_root, bundle, distribution, temp):
    path = Path(temp) / (bundle + '.mobileprovision')
    path.write_bytes(archive.read(bundle_root + '/embedded.mobileprovision'))
    profile = plistlib.loads(subprocess.check_output(
        ['security', 'cms', '-D', '-i', str(path)], stderr=subprocess.PIPE))
    entitlements = profile.get('Entitlements', {})
    identifier = entitlements.get('application-identifier', '')
    team = profile.get('TeamIdentifier', [])
    prefix, _, profile_bundle = identifier.partition('.')
    if (len(team) != 1 or profile_bundle != bundle
            or prefix not in profile.get('ApplicationIdentifierPrefix', [])):
        raise ValueError('IPA provisioning bundle or team mismatch: ' + bundle)
    devices = profile.get('ProvisionedDevices')
    if distribution == 'device' and not devices:
        raise ValueError('IPA profile does not allow direct device installation')
    if distribution == 'appstore' and (devices or profile.get('ProvisionsAllDevices')):
        raise ValueError('IPA uses a device or enterprise profile instead of an App Store profile')
    if distribution == 'appstore' and entitlements.get('get-task-allow'):
        raise ValueError('App Store IPA unexpectedly allows debugging')
    return team[0]


def verify(directory, expected, distribution='device', *, expected_version=None,
           expected_build=None, require_ota=False, expected_launch_sha=None,
           expected_shorebird_app=None):
    if distribution not in {'device', 'appstore'}:
        raise ValueError('Invalid IPA distribution')
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
        version = info.get('CFBundleShortVersionString')
        build = info.get('CFBundleVersion')
        if expected_version is not None and version != expected_version:
            raise ValueError('Built IPA marketing version mismatch')
        if expected_build is not None and build != str(expected_build):
            raise ValueError('Built IPA build number mismatch')
        primary_icon = info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {})
        if primary_icon.get('CFBundleIconName') != 'BulkaSolid':
            raise ValueError('IPA still references the old app icon catalog')
        if not primary_icon.get('UIPrerenderedIcon'):
            raise ValueError('IPA is missing the prerendered icon setting')
        root = roots[0].rsplit('/', 1)[0]
        asset_root = root + '/Frameworks/App.framework/flutter_assets/'
        launch_sha = None
        if expected_launch_sha is not None:
            launch_sha = hashlib.sha256(archive.read(
                asset_root + 'assets/brand/bulka-launch.png')).hexdigest()
            if launch_sha != expected_launch_sha:
                raise ValueError('IPA launch artwork differs from the expected PNG')
            if asset_root + 'assets/brand/launch_animation.mp4' in archive.namelist():
                raise ValueError('IPA still bundles the obsolete startup video')
        widgets = [name for name in archive.namelist()
                   if name.startswith(root + '/PlugIns/')
                   and name.endswith('.appex/Info.plist')]
        if len(widgets) != 1:
            raise ValueError('Expected exactly one Bulka widget extension')
        widget_info = plistlib.loads(archive.read(widgets[0]))
        widget_bundle = expected + '.BulkaWidget'
        if (widget_info.get('CFBundleIdentifier') != widget_bundle
                or widget_info.get('CFBundleShortVersionString') != version
                or widget_info.get('CFBundleVersion') != build):
            raise ValueError('IPA widget bundle or version mismatch')
        with tempfile.TemporaryDirectory() as temp:
            team = _verify_profile(archive, root, expected, distribution, temp)
            widget_team = _verify_profile(archive, widgets[0].rsplit('/', 1)[0],
                                          widget_bundle, distribution, temp)
            if team != widget_team:
                raise ValueError('IPA app and widget signing teams differ')
            if require_ota:
                config = archive.read(asset_root + 'shorebird.yaml').decode('utf-8')
                app_values = re.findall(r'^app_id:\s*[\'"]?([a-f0-9-]+)[\'"]?\s*(?:#.*)?$', config, re.M)
                auto_values = [value.split('#', 1)[0].strip().lower() for value in
                               re.findall(r'^auto_update:\s*([^\r\n]+)', config, re.M)]
                if (not expected_shorebird_app or app_values != [expected_shorebird_app]
                        or (auto_values and auto_values != ['true'])):
                    raise ValueError('IPA Shorebird configuration does not enable the expected updater')
                engine = Path(temp) / 'Flutter'
                engine.write_bytes(archive.read(root + '/Frameworks/Flutter.framework/Flutter'))
                symbols = subprocess.check_output(
                    ['nm', '-gUj', str(engine)], stderr=subprocess.PIPE).decode('utf-8')
                if '_shorebird_next_boot_patch_number' not in symbols.split():
                    raise ValueError('IPA was built without the Shorebird updater engine')
        print('Verified IPA:', expected, 'version', info.get('CFBundleShortVersionString'),
              'build', info.get('CFBundleVersion'))
        return {'schemaVersion': 1, 'ipaFile': packages[0].name,
                'ipaSha256': hashlib.sha256(packages[0].read_bytes()).hexdigest(),
                'bundleId': expected, 'distribution': distribution, 'version': version,
                'buildNumber': build, 'otaEnabled': bool(require_ota),
                'launchSha256': launch_sha, 'shorebirdAppId': expected_shorebird_app}


def verify_provenance(directory, source_commit, run_id, repository):
    if (not re.fullmatch(r'[0-9a-f]{40}', source_commit or '')
            or not re.fullmatch(r'[1-9][0-9]*', str(run_id or '')) or not repository):
        raise ValueError('Expected explicit source commit, build run, and repository')
    record = json.loads((Path(directory) / PROVENANCE).read_text(encoding='utf-8'))
    if (record.get('schemaVersion') != 1 or record.get('sourceCommit') != source_commit
            or str(record.get('runId')) != str(run_id) or record.get('repository') != repository
            or record.get('workflow') != WORKFLOW or record.get('buildMode') != 'release'
            or record.get('distribution') != 'appstore' or record.get('otaEnabled') is not True
            or record.get('launchSha256') != LAUNCH_SHA
            or record.get('shorebirdAppId') != SHOREBIRD_APP
            or not re.fullmatch(r'\d+\.\d+\.\d+', str(record.get('version', '')))
            or not re.fullmatch(r'[1-9][0-9]*', str(record.get('buildNumber', '')))):
        raise ValueError('IPA artifact provenance does not match the requested OTA release')
    verified = verify(directory, 'com.bulka.bonus', 'appstore',
                      expected_version=record.get('version'), expected_build=record.get('buildNumber'),
                      require_ota=True, expected_launch_sha=record.get('launchSha256'),
                      expected_shorebird_app=record.get('shorebirdAppId'))
    if verified != {key: record.get(key) for key in verified}:
        raise ValueError('IPA artifact contents or checksum differ from release provenance')
    return verified


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--expected-bundle-id', required=True)
    parser.add_argument('--distribution', choices=('device', 'appstore'), default='device')
    parser.add_argument('--expected-version')
    parser.add_argument('--expected-build')
    parser.add_argument('--require-ota', action='store_true')
    parser.add_argument('--expected-launch-sha256')
    parser.add_argument('--expected-shorebird-app-id')
    parser.add_argument('--metadata-output')
    parser.add_argument('--source-commit')
    parser.add_argument('--run-id')
    parser.add_argument('--repository')
    parser.add_argument('--build-mode', choices=('profile', 'release'))
    parser.add_argument('--verify-provenance', action='store_true')
    args = parser.parse_args()
    if args.verify_provenance:
        verify_provenance(args.directory, args.source_commit, args.run_id, args.repository)
    else:
        record = verify(args.directory, args.expected_bundle_id, args.distribution,
                        expected_version=args.expected_version, expected_build=args.expected_build,
                        require_ota=args.require_ota, expected_launch_sha=args.expected_launch_sha256,
                        expected_shorebird_app=args.expected_shorebird_app_id)
        if args.metadata_output:
            if (not re.fullmatch(r'[0-9a-f]{40}', args.source_commit or '')
                    or not re.fullmatch(r'[1-9][0-9]*', args.run_id or '') or not args.repository
                    or not args.build_mode or not args.expected_version or not args.expected_build):
                parser.error('Release metadata requires explicit source/run/repository/mode/version/build')
            record.update(sourceCommit=args.source_commit, runId=args.run_id,
                          repository=args.repository, workflow=WORKFLOW, buildMode=args.build_mode)
            Path(args.metadata_output).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
