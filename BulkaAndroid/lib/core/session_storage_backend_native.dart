import 'dart:convert';
import 'dart:math';
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

  static const _recoveryKey = 'bulka_session_recovery_v1';
  static Future<String>? _recoveryRequest;

  Future<String> recoveryKey() => _recoveryRequest ??= _readRecoveryKey()
      .whenComplete(() => _recoveryRequest = null);

  Future<String> _readRecoveryKey() async {
    final existing = await _storage.read(key: _recoveryKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final random = Random.secure();
    final value = base64Url
        .encode(List.generate(32, (_) => random.nextInt(256)))
        .replaceAll('=', '');
    await _storage.write(key: _recoveryKey, value: value);
    return value;
  }

  Future<String?> read({required String key}) => _storage.read(key: key);

  Future<void> write({required String key, required String value}) =>
      _storage.write(key: key, value: value);

  Future<void> delete({required String key}) => _storage.delete(key: key);
}
