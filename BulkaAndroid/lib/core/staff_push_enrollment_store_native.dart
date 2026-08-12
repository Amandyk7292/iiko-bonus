import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keeps only the employee's opt-in intent. FCM credentials are never written
/// here; iOS stores this bit in Keychain and Android in Keystore-backed storage.
abstract final class StaffPushEnrollmentStore {
  static const _key = 'staffPushEnrollmentIntentV1';
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  static Future<bool> read() async =>
      await _storage.read(key: _key) == 'enabled';

  static Future<void> write(bool enabled) => enabled
      ? _storage.write(key: _key, value: 'enabled')
      : _storage.delete(key: _key);
}
