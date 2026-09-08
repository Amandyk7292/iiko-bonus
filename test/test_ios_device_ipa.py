"""Regression checks: never install a similarly named but different Bulka app."""
import contextlib
import importlib.util
import io
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    'verify_ipa', Path(__file__).parents[1] / 'scripts/verify-ios-device-ipa.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeviceIpaVerification(unittest.TestCase):
    def create_package(self, directory, bundle):
        with zipfile.ZipFile(Path(directory) / 'Bulka.ipa', 'w') as archive:
            archive.writestr('Payload/Runner.app/Info.plist', plistlib.dumps({
                'CFBundleIdentifier': bundle,
                'CFBundleShortVersionString': '1.0.1', 'CFBundleVersion': '2'}))
            archive.writestr('Payload/Runner.app/embedded.mobileprovision', b'cms-profile')

    def test_rejects_other_bulka_before_reading_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory, 'com.bulka.app')
            with patch.object(module.subprocess, 'check_output') as decode:
                with self.assertRaisesRegex(ValueError, 'bundle ID mismatch'):
                    module.verify(directory, 'com.bulka.bonus')
                decode.assert_not_called()

    def test_rejects_store_only_package_for_direct_install(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory, 'com.bulka.bonus')
            with patch.object(module.subprocess, 'check_output', return_value=plistlib.dumps({})):
                with self.assertRaisesRegex(ValueError, 'direct device installation'):
                    module.verify(directory, 'com.bulka.bonus')

    def test_accepts_expected_app_with_device_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_package(directory, 'com.bulka.bonus')
            with patch.object(module.subprocess, 'check_output',
                              return_value=plistlib.dumps({'ProvisionedDevices': ['test-device']})):
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    module.verify(directory, 'com.bulka.bonus')
                self.assertIn('Verified IPA: com.bulka.bonus', output.getvalue())


if __name__ == '__main__':
    unittest.main()
