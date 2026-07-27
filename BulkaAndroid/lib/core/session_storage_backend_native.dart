import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Stores customer session tokens in Keychain on iOS and Keystore-backed
/// encrypted preferences on Android.
class SessionStorageBackend {
  const SessionStorageBackend();

  bool get persistsRefreshToken => true;

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  Future<String?> read({required String key}) => _storage.read(key: key);

  Future<void> write({required String key, required String value}) =>
      _storage.write(key: key, value: value);

  Future<void> delete({required String key}) => _storage.delete(key: key);
}
