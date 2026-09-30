import 'package:bulka_bonus/core/referral_device_identity.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(ReferralDeviceIdentity.channel, null);
  });

  test(
    'Android identity stays the same after session and preferences are cleared',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(ReferralDeviceIdentity.channel, (
            call,
          ) async {
            expect(call.method, 'androidId');
            return 'ABCDEF0123456789';
          });
      final first = await ReferralDeviceIdentity.read();
      SharedPreferences.setMockInitialValues({
        'installationId': 'another-install',
      });
      final second = await ReferralDeviceIdentity.read();
      expect(first, {'kind': 'android_id', 'id': 'abcdef0123456789'});
      expect(second, first);
    },
  );

  test(
    'unavailable or known broken Android IDs cannot acquire a new random identity',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      for (final value in [
        null,
        '0000000000000000',
        '9774d56d682e549c',
        'random-installation',
      ]) {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(
              ReferralDeviceIdentity.channel,
              (call) async => value,
            );
        expect(await ReferralDeviceIdentity.read(), isNull);
      }
    },
  );

  test(
    'iOS keeps the Keychain identity when account and installation preferences are removed',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      final first = await ReferralDeviceIdentity.read();
      expect(first?['id'], matches(RegExp(r'^[a-f0-9]{64}$')));
      expect(first?['kind'], 'ios_keychain');
      SharedPreferences.setMockInitialValues({});
      const tokens = FlutterSecureStorage();
      await tokens.delete(key: 'bulka_access_token');
      await tokens.delete(key: 'bulka_refresh_token');
      expect(await ReferralDeviceIdentity.read(), first);
    },
  );

  test(
    'corrupt Keychain evidence fails closed without generating a replacement',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      FlutterSecureStorage.setMockInitialValues({
        'referralDeviceV2': 'corrupted',
      });
      expect(await ReferralDeviceIdentity.read(), isNull);
      expect(
        await const FlutterSecureStorage().read(key: 'referralDeviceV2'),
        'corrupted',
      );
    },
  );

  test(
    'verification failure keeps identity and cannot become an eligible proof',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(ReferralDeviceIdentity.channel, (
            call,
          ) async {
            if (call.method == 'androidId') return 'abcdef0123456789';
            throw PlatformException(code: 'DEVICE_CHECK_UNAVAILABLE');
          });
      expect(await ReferralDeviceIdentity.proof('test-nonce'), isNull);
      expect((await ReferralDeviceIdentity.read())?['id'], 'abcdef0123456789');
    },
  );
}
