import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    'signing', Path(__file__).parents[1] / 'scripts/prepare-ios-device-signing.py')
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class StoreSigningTests(unittest.TestCase):
    def test_store_profile_accepted(self):
        signing.validate_distribution({'Entitlements': {'get-task-allow': False}}, True)

    def test_device_and_enterprise_profiles_rejected(self):
        for extra in [{'ProvisionedDevices': ['device']}, {'ProvisionsAllDevices': True},
                      {'Entitlements': {'get-task-allow': True}}]:
            with self.assertRaises(ValueError):
                signing.validate_distribution({'Entitlements': {}, **extra}, True)

    def test_device_mode_still_rejects_store_profiles(self):
        with self.assertRaises(ValueError):
            signing.validate_distribution({'Entitlements': {}}, False)


if __name__ == '__main__':
    unittest.main()
