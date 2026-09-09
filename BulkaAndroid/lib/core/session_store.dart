part of '../main.dart';

class SessionTokens {
  const SessionTokens({this.accessToken, this.refreshToken});

  final String? accessToken;
  final String? refreshToken;

  bool get isComplete =>
      accessToken != null &&
      accessToken!.isNotEmpty &&
      refreshToken != null &&
      refreshToken!.isNotEmpty;
}

String customerPreferenceKey(String base, String? scope) {
  final normalized =
      (scope?.trim().isNotEmpty == true ? scope!.trim() : 'guest').replaceAll(
        RegExp(r'[^A-Za-z0-9_-]'),
        '_',
      );
  return '${base}_$normalized';
}

abstract final class SessionStore {
  static const _storage = SessionStorageBackend();
  static const _accessKey = 'bulka_access_token';
  static const _refreshKey = 'bulka_refresh_token';
  static const _recordKey = 'bulka_customer_session_v2';
  static Future<void>? _pendingWrite;

  static Future<void> _serialize(Future<void> Function() operation) {
    final previous = _pendingWrite;
    final next = () async {
      if (previous != null) await previous;
      await operation();
    }();
    final settled = next.catchError((Object _) {});
    _pendingWrite = settled;
    unawaited(
      settled.then((_) {
        if (identical(_pendingWrite, settled)) _pendingWrite = null;
      }),
    );
    return next;
  }

  static Future<String> recoveryKey() => _storage.recoveryKey();

  static Future<SessionTokens> readAndMigrate(SharedPreferences prefs) async {
    final pending = _pendingWrite;
    if (pending != null) await pending;
    if (_storage.persistsRefreshToken) {
      final record = await _storage.read(key: _recordKey);
      if (record != null) {
        final data = _asMap(jsonDecode(record));
        return SessionTokens(
          accessToken: _nullableString(data['accessToken']),
          refreshToken: _nullableString(data['refreshToken']),
        );
      }
    }
    var accessToken = await _storage.read(key: _accessKey);
    var refreshToken = await _storage.read(key: _refreshKey);
    final legacyAccess = prefs.getString('accessToken');
    final legacyRefresh = prefs.getString('refreshToken');
    if ((accessToken == null || accessToken.isEmpty) && legacyAccess != null) {
      accessToken = legacyAccess;
      await _storage.write(key: _accessKey, value: accessToken);
    }
    if (_storage.persistsRefreshToken &&
        (refreshToken == null || refreshToken.isEmpty) &&
        legacyRefresh != null) {
      refreshToken = legacyRefresh;
      await _storage.write(key: _refreshKey, value: refreshToken);
    }
    if (!_storage.persistsRefreshToken) refreshToken = null;
    if (_storage.persistsRefreshToken &&
        (accessToken != null || refreshToken != null)) {
      await _serialize(
        () => _storage.write(
          key: _recordKey,
          value: jsonEncode({
            'accessToken': accessToken,
            'refreshToken': refreshToken,
          }),
        ),
      );
    }
    await prefs.remove('accessToken');
    await prefs.remove('refreshToken');
    return SessionTokens(accessToken: accessToken, refreshToken: refreshToken);
  }

  static const _legacyCustomerKeys = {
    'delivery_addresses',
    'selected_delivery_address_id',
    'checkout_phone',
    'checkout_comment',
    'checkout_promo',
    'checkout_scheduled_at',
    'checkout_preorder_fulfillment',
  };

  static const _accountIdentityKeys = {
    'phone',
    'customer',
    'transactions',
    'accessToken',
    'refreshToken',
  };

  static const _scopedCustomerPrefixes = {
    'delivery_addresses_',
    'selected_delivery_address_id_',
    'checkout_phone_',
    'checkout_comment_',
    'checkout_promo_',
    'checkout_scheduled_at_',
    'checkout_preorder_fulfillment_',
    'checkout_id_',
    'checkout_id_created_at_',
    'customer_orders_cache_',
    'pending_gift_purchase_v1_',
    'pending_forte_operation_v1_',
  };

  static Future<void> write(String accessToken, String? refreshToken) =>
      _serialize(() async {
        if (_storage.persistsRefreshToken) {
          // Commit the pair in one Keychain/Keystore entry. A terminated app
          // must never reopen with tokens from two different rotations.
          await _storage.write(
            key: _recordKey,
            value: jsonEncode({
              'accessToken': accessToken,
              'refreshToken': refreshToken,
            }),
          );
        } else {
          await _storage.write(key: _accessKey, value: accessToken);
        }
      });

  static Future<void> clear() => _serialize(() async {
    await Future.wait([
      _storage.delete(key: _recordKey),
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshKey),
    ]);
  });

  static Future<void> clearLegacyCustomerData(SharedPreferences prefs) async {
    await Future.wait(
      _legacyCustomerKeys
          .where(prefs.containsKey)
          .map((key) => prefs.remove(key)),
    );
  }

  static Future<void> clearCustomerData(SharedPreferences prefs) async {
    final keys = prefs.getKeys().where(
      (key) =>
          _accountIdentityKeys.contains(key) ||
          _legacyCustomerKeys.contains(key) ||
          _scopedCustomerPrefixes.any(key.startsWith),
    );
    await Future.wait(keys.map((key) => prefs.remove(key)));
  }
}
