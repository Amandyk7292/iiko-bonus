"""Reject stale, mismatched, non-OTA, or untrusted iOS release artifacts."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location(
    'verify_ipa', ROOT / 'scripts/verify-ios-device-ipa.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = 'a' * 40
REPO = 'reviewed/bulka'


class DeviceIpaVerification(unittest.TestCase):
    def create_package(self, directory, bundle='com.bulka.bonus', *,
                       widget_bundle=None, widget_build='51', widget=True,
                       launch=None, old_video=False, config=None):
        root = 'Payload/Runner.app'
        assets = root + '/Frameworks/App.framework/flutter_assets/'
        with zipfile.ZipFile(Path(directory) / 'Bulka.ipa', 'w') as archive:
            archive.writestr(root + '/Info.plist', plistlib.dumps({
                'CFBundleIdentifier': bundle,
                'CFBundleShortVersionString': '1.0.9', 'CFBundleVersion': '51',
                'CFBundleIcons': {'CFBundlePrimaryIcon': {
                    'CFBundleIconName': 'BulkaSolid', 'UIPrerenderedIcon': True}}}))
            archive.writestr(root + '/embedded.mobileprovision', b'cms-profile')
            if widget:
                archive.writestr(root + '/PlugIns/BulkaWidget.appex/Info.plist', plistlib.dumps({
                    'CFBundleIdentifier': widget_bundle or bundle + '.BulkaWidget',
                    'CFBundleShortVersionString': '1.0.9', 'CFBundleVersion': widget_build}))
                archive.writestr(root + '/PlugIns/BulkaWidget.appex/embedded.mobileprovision', b'cms-widget')
            archive.writestr(assets + 'assets/brand/bulka-launch.png',
                            launch if launch is not None else
                            (ROOT / 'BulkaAndroid/assets/brand/bulka-launch.png').read_bytes())
            if old_video:
                archive.writestr(assets + 'assets/brand/launch_animation.mp4', b'old-video')
            archive.writestr(assets + 'shorebird.yaml', config if config is not None
                            else f'app_id: {module.SHOREBIRD_APP}\n')
            archive.writestr(root + '/Frameworks/Flutter.framework/Flutter', b'fixture-engine')

    @contextlib.contextmanager
    def decoded(self, *, device=False, debug=False, enterprise=False,
                team_mismatch=False, wrong_profile=False, symbols=True,
                profile_changes=None, signed_changes=None, widget_signed_changes=None,
                signature_failure=False, malformed_signed=False, legacy_prefix=False):
        def read(command, **kwargs):
            self.assertEqual(kwargs.get('stderr'), subprocess.PIPE)
            if command[0] == 'ditto':
                self.assertEqual(command[:2], ['ditto', '-xk'])
                with zipfile.ZipFile(command[2]) as archive:
                    archive.extractall(command[3])
                return b''
            if command[0] == 'codesign':
                widget = Path(command[-1]).name.endswith('.appex')
                bundle = 'com.bulka.bonus' + ('.BulkaWidget' if widget else '')
                self.assertTrue((Path(command[-1]) / 'Info.plist').is_file())
                if command[1] == '--verify':
                    self.assertEqual(command[1:4], ['--verify', '--deep', '--strict'])
                    if signature_failure:
                        raise subprocess.CalledProcessError(1, command, stderr=b'private-native-diagnostic')
                    return b''
                self.assertEqual(command[1:5], ['--display', '--entitlements', '-', '--xml'])
                if malformed_signed:
                    return b'not-a-plist'
                prefix = 'LEGACY' if legacy_prefix else 'BULKATEAM'
                signed = {
                    'application-identifier': f'{prefix}.{bundle}',
                    'com.apple.developer.team-identifier': 'BULKATEAM',
                    'get-task-allow': debug,
                    'com.apple.security.application-groups': [module.APP_GROUP]}
                if not widget:
                    signed.update({module.APP_ATTEST: 'production', 'aps-environment': 'production',
                                   module.ASSOCIATED_DOMAINS: ['applinks:bulka.com.kz']})
                signed.update((widget_signed_changes if widget else signed_changes) or {})
                return plistlib.dumps(signed)
            if command[0] == 'nm':
                return (b'_shorebird_next_boot_patch_number\n' if symbols else b'_FlutterEngineMain\n')
            self.assertEqual(command[:3], ['security', 'cms', '-D'])
            bundle = Path(command[-1]).stem
            team = 'OTHERTEAM' if team_mismatch and bundle.endswith('BulkaWidget') else 'BULKATEAM'
            prefix = 'LEGACY' if legacy_prefix else team
            profile = {'TeamIdentifier': [team], 'ApplicationIdentifierPrefix': [prefix], 'Entitlements': {
                'application-identifier': f'{prefix}.{bundle if not wrong_profile else "com.foreign.app"}',
                'get-task-allow': debug, 'com.apple.developer.team-identifier': team,
                module.APP_ATTEST: ['development', 'production'],
                'aps-environment': 'production', module.ASSOCIATED_DOMAINS: '*',
                'com.apple.security.application-groups': [module.APP_GROUP]}}
            profile['Entitlements'].update(profile_changes or {})
            if device:
                profile['ProvisionedDevices'] = ['fixture-device']
            if enterprise:
                profile['ProvisionsAllDevices'] = True
            return plistlib.dumps(profile)
        with patch.object(module.subprocess, 'check_output', side_effect=read) as calls:
            with contextlib.redirect_stdout(io.StringIO()):
                yield calls

    def store(self, directory):
        return module.verify(directory, 'com.bulka.bonus', 'appstore',
                             expected_version='1.0.9', expected_build='51',
                             require_ota=True, expected_launch_sha=module.LAUNCH_SHA,
                             expected_shorebird_app=module.SHOREBIRD_APP)

    def create_provenance(self, directory):
        self.create_package(directory)
        with self.decoded():
            record = self.store(directory)
        record.update(sourceCommit=SHA, runId='123', repository=REPO,
                      workflow=module.WORKFLOW, buildMode='release')
        (Path(directory) / module.PROVENANCE).write_text(json.dumps(record), encoding='utf-8')
        return record

    def test_rejects_other_bulka_before_reading_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory, 'com.bulka.app')
            with patch.object(module.subprocess, 'check_output') as decode:
                with self.assertRaisesRegex(ValueError, 'bundle ID mismatch'):
                    module.verify(directory, 'com.bulka.bonus')
                decode.assert_not_called()

    def test_rejects_store_only_package_for_direct_install(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory)
            with self.decoded(), self.assertRaisesRegex(ValueError, 'direct device installation'):
                module.verify(directory, 'com.bulka.bonus')

    def test_accepts_expected_app_and_widget_with_device_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory)
            with self.decoded(device=True) as calls:
                record = module.verify(directory, 'com.bulka.bonus')
            self.assertEqual(record['version'], '1.0.9')
            self.assertEqual(sum(call.args[0][0] == 'security' for call in calls.call_args_list), 2)
            self.assertEqual(sum(call.args[0][0] == 'codesign' for call in calls.call_args_list), 4)
            self.assertTrue(record['signedEntitlementsVerified'])

    def test_accepts_store_ota_release_with_latest_artwork(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory)
            with self.decoded() as calls:
                record = self.store(directory)
            self.assertTrue(record['otaEnabled'])
            self.assertTrue(record['signedEntitlementsVerified'])
            self.assertEqual(record['launchSha256'], module.LAUNCH_SHA)
            self.assertEqual(calls.call_args.args[0][:2], ['nm', '-gUj'])

    def test_accepts_provider_permission_arrays_and_legacy_prefix_for_exact_signed_rights(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory)
            with self.decoded(legacy_prefix=True):
                record = self.store(directory)
            self.assertTrue(record['signedEntitlementsVerified'])

    def test_rejects_actual_runner_rights_even_when_profile_permissions_allow_them(self):
        cases = [
            {'application-identifier': 'BULKATEAM.com.foreign.app'},
            {'com.apple.developer.team-identifier': 'FOREIGNTEAM'},
            {'get-task-allow': True},
            {module.APP_ATTEST: 'development'},
            {module.APP_ATTEST: ['production']},
            {'aps-environment': 'development'},
            {module.ASSOCIATED_DOMAINS: ['*']},
            {module.ASSOCIATED_DOMAINS: ['applinks:foreign.example']},
            {'com.apple.security.application-groups': ['group.foreign']},
        ]
        for changes in cases:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory)
                with self.decoded(signed_changes=changes), self.assertRaisesRegex(ValueError, 'signed'):
                    self.store(directory)

    def test_rejects_actual_widget_identity_debug_or_group(self):
        for changes in [
            {'application-identifier': 'BULKATEAM.com.foreign.widget'},
            {'com.apple.developer.team-identifier': 'FOREIGNTEAM'},
            {'get-task-allow': True},
            {'com.apple.security.application-groups': ['group.foreign']},
        ]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory)
                with self.decoded(widget_signed_changes=changes), self.assertRaisesRegex(ValueError, 'signed'):
                    self.store(directory)

    def test_rejects_profile_permission_mismatch_without_generic_wildcard_bypass(self):
        for changes in [
            {module.APP_ATTEST: ['development']}, {module.APP_ATTEST: '*'},
            {'aps-environment': 'development'},
            {module.ASSOCIATED_DOMAINS: ['applinks:foreign.example']},
            {'com.apple.security.application-groups': ['*']},
        ]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory)
                with self.decoded(profile_changes=changes), self.assertRaisesRegex(ValueError, 'does not permit'):
                    self.store(directory)

    def test_signature_tool_failures_or_non_plist_entitlements_stop_verification(self):
        for options, message in [({'signature_failure': True}, 'code signature verification failed'),
                                 ({'malformed_signed': True}, 'not a plist')]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory)
                with self.decoded(**options), self.assertRaisesRegex(ValueError, message) as failure:
                    self.store(directory)
                self.assertNotIn('private-native-diagnostic', str(failure.exception))

    def test_rejects_wrong_version_and_build_before_profile_decode(self):
        for option, value, message in [('expected_version', '1.0.8', 'marketing version'),
                                       ('expected_build', '43', 'build number')]:
            with self.subTest(option=option), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory)
                with patch.object(module.subprocess, 'check_output') as calls:
                    with self.assertRaisesRegex(ValueError, message):
                        module.verify(directory, 'com.bulka.bonus', **{option: value})
                    calls.assert_not_called()

    def test_rejects_missing_or_mismatched_widget(self):
        for options in [{'widget': False}, {'widget_build': '43'}, {'widget_bundle': 'com.foreign.widget'}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory, **options)
                with self.decoded(), self.assertRaisesRegex(ValueError, 'widget'):
                    self.store(directory)

    def test_rejects_device_enterprise_debug_and_foreign_team_store_profiles(self):
        for options in [{'device': True}, {'enterprise': True}, {'debug': True},
                        {'team_mismatch': True}, {'wrong_profile': True}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory)
                with self.decoded(**options), self.assertRaises(ValueError):
                    self.store(directory)

    def test_rejects_old_artwork_or_bundled_video(self):
        for options in [{'launch': b'old-photo'}, {'old_video': True}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory, **options)
                with self.decoded(), self.assertRaisesRegex(ValueError, 'artwork|startup video'):
                    self.store(directory)

    def test_rejects_foreign_app_or_disabled_ota(self):
        for config in ['app_id: another-app\n', f'app_id: {module.SHOREBIRD_APP}\nauto_update: false\n',
                       f'app_id: {module.SHOREBIRD_APP}\nauto_update: FALSE # disabled\n',
                       f'app_id: {module.SHOREBIRD_APP}\nauto_update: false\nauto_update: true\n']:
            with self.subTest(config=config), tempfile.TemporaryDirectory() as directory:
                self.create_package(directory, config=config)
                with self.decoded(), self.assertRaisesRegex(ValueError, 'Shorebird configuration'):
                    self.store(directory)

    def test_rejects_plain_flutter_engine_even_with_shorebird_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory)
            with self.decoded(symbols=False), self.assertRaisesRegex(ValueError, 'without the Shorebird'):
                self.store(directory)

    def test_accepts_matching_release_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            record = self.create_provenance(directory)
            with self.decoded():
                verified = module.verify_provenance(directory, SHA, '123', REPO)
            self.assertEqual(verified['ipaSha256'], record['ipaSha256'])

    def test_rejects_wrong_source_run_ota_and_missing_png_provenance(self):
        for key, value in [('sourceCommit', 'b' * 40), ('runId', '124'), ('otaEnabled', False),
                           ('signedEntitlementsVerified', False),
                           ('launchSha256', None), ('shorebirdAppId', 'foreign-app')]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                record = self.create_provenance(directory)
                record[key] = value
                (Path(directory) / module.PROVENANCE).write_text(json.dumps(record), encoding='utf-8')
                with self.decoded(), self.assertRaisesRegex(ValueError, 'provenance'):
                    module.verify_provenance(directory, SHA, '123', REPO)

    def test_rejects_checksum_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            record = self.create_provenance(directory)
            record['ipaSha256'] = '0' * 64
            (Path(directory) / module.PROVENANCE).write_text(json.dumps(record), encoding='utf-8')
            with self.decoded(), self.assertRaisesRegex(ValueError, 'checksum'):
                module.verify_provenance(directory, SHA, '123', REPO)

    def test_only_successful_main_dispatch_and_exact_unexpired_artifact_are_trusted(self):
        run = {'id': 123, 'event': 'workflow_dispatch', 'conclusion': 'success', 'status': 'completed',
               'path': module.WORKFLOW, 'head_sha': SHA, 'head_branch': 'main',
               'head_repository': {'full_name': REPO}}
        artifact = {'name': 'bulka-iphone-appstore-release-' + SHA, 'expired': False}
        self.assertEqual(module.validate_source_run(run, [artifact], SHA, REPO, '123'), artifact['name'])
        for key, value in [('event', 'pull_request'), ('conclusion', 'failure'), ('status', 'in_progress'),
                           ('path', '.github/workflows/other.yml'), ('head_sha', 'b' * 40),
                           ('head_branch', 'feature'), ('head_repository', {'full_name': 'fork/bulka'})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.validate_source_run({**run, key: value}, [artifact], SHA, REPO, '123')
        for artifacts in [[], [artifact, artifact], [{**artifact, 'expired': True}]]:
            with self.subTest(artifacts=artifacts), self.assertRaises(ValueError):
                module.validate_source_run(run, artifacts, SHA, REPO, '123')


if __name__ == '__main__':
    unittest.main()
