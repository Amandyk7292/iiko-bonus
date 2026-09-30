import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Referral identity has its own lifetime, independent of accounts, session
/// tokens and push-installation preferences. Never delete it on logout/deletion.
class ReferralDeviceIdentity {
  static const channel = MethodChannel('com.bulka.bonus/referral_device');
  static const _storage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accountName: 'com.bulka.bonus.referral-device',
      accessibility: KeychainAccessibility.first_unlock_this_device,
      synchronizable: false,
    ),
  );
  static const _key = 'referralDeviceV2';
  static Future<Map<String, String>?>? _pending;

  static Future<Map<String, String>?> read() =>
      _pending ??= _read().whenComplete(() => _pending = null);

  static Future<String?> proof(String nonce) async {
    if (kIsWeb) return null;
    try {
      return await channel
          .invokeMethod<String>('proof', {'nonce': nonce})
          .timeout(const Duration(seconds: 45));
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    } on TimeoutException {
      return null;
    }
  }

  static Future<Map<String, String>?> _read() async {
    if (kIsWeb) return null;
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        final id = (await channel.invokeMethod<String>(
          'androidId',
        ))?.toLowerCase();
        if (id == null ||
            !RegExp(r'^[a-f0-9]{16}$').hasMatch(id) ||
            id == '0000000000000000' ||
            id == '9774d56d682e549c') {
          return null;
        }
        return {'kind': 'android_id', 'id': id};
      }
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        var id = await _storage.read(key: _key);
        if (id == null) {
          final random = Random.secure();
          id = List.generate(
            32,
            (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
          ).join();
          await _storage.write(key: _key, value: id);
        }
        // A corrupt/unavailable Keychain must not generate a fresh eligible ID.
        if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(id)) return null;
        return {'kind': 'ios_keychain', 'id': id};
      }
    } on PlatformException {
      return null;
    } on MissingPluginException {
      // Older Android binaries keep registration/order access, without rewards.
      return null;
    }
    return null;
  }
}
