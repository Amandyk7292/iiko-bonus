import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CashierInviteDetails {
  const CashierInviteDetails({
    required this.token,
    required this.name,
    this.branchName = '',
    this.city = '',
  });

  final String token;
  final String name;
  final String branchName;
  final String city;

  String get location =>
      [city, branchName].where((part) => part.trim().isNotEmpty).join(' · ');
}

/// A cashier invitation is used only while creating a new customer account.
class PendingCashierInvite {
  static const key = 'pendingCashierInviteV1';
  static const lifetime = Duration(days: 30);
  static final tokenNotifier = ValueNotifier<String?>(null);
  static int _mutationRevision = 0;
  static Future<void>? _mutations;

  static Future<T> _serialize<T>(Future<T> Function() operation) async {
    final previous = _mutations;
    final gate = Completer<void>();
    _mutations = gate.future;
    try {
      if (previous != null) await previous;
      return await operation();
    } finally {
      gate.complete();
      if (identical(_mutations, gate.future)) _mutations = null;
    }
  }

  static String? validToken(String? value) {
    final token = value?.trim().toLowerCase();
    return token != null && RegExp(r'^[0-9a-f]{64}$').hasMatch(token)
        ? token
        : null;
  }

  static String? tokenFromUri(Uri uri) {
    final trusted =
        (uri.scheme == 'https' &&
            uri.host == 'bulka.com.kz' &&
            (uri.path == '/cashier-register' || uri.path == '/profile') &&
            !uri.hasPort &&
            uri.userInfo.isEmpty) ||
        (uri.scheme == 'bulka' &&
            uri.host == 'profile' &&
            uri.path.isEmpty &&
            uri.userInfo.isEmpty);
    if (!trusted || uri.queryParametersAll['cashier']?.length != 1) {
      return null;
    }
    return validToken(uri.queryParameters['cashier']);
  }

  static Future<void> capture(Uri uri) async {
    final token = tokenFromUri(uri);
    if (token == null) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString('phone') != null || await read() != null) return;
    await setToken(token);
  }

  static Future<String?> read({DateTime? now}) {
    final revision = _mutationRevision;
    return _serialize(() async {
      final prefs = await SharedPreferences.getInstance();
      // SharedPreferences updates its cache before its platform write resolves.
      // Wait for committed mutations before publishing any invitation.
      if (revision != _mutationRevision) return null;
      try {
        final raw = prefs.getString(key);
        if (raw == null) return tokenNotifier.value = null;
        final data = jsonDecode(raw) as Map<String, dynamic>;
        final token = validToken(data['token'] as String?);
        final capturedAt = DateTime.tryParse(
          data['capturedAt'] as String? ?? '',
        );
        final current = (now ?? DateTime.now()).toUtc();
        if (token == null ||
            capturedAt == null ||
            capturedAt.isAfter(current) ||
            current.difference(capturedAt) >= lifetime ||
            prefs.getString('phone') != null) {
          await prefs.remove(key);
          if (revision == _mutationRevision) tokenNotifier.value = null;
          return null;
        }
        return tokenNotifier.value = token;
      } catch (_) {
        await prefs.remove(key);
        if (revision == _mutationRevision) tokenNotifier.value = null;
        return null;
      }
    });
  }

  static Future<void> setToken(
    String token, {
    DateTime? now,
    bool Function()? isCurrent,
  }) async {
    final normalized = validToken(token);
    if (normalized == null) throw ArgumentError.value(token, 'token');
    final revision = ++_mutationRevision;
    bool current() =>
        revision == _mutationRevision && (isCurrent?.call() ?? true);
    return _serialize(() async {
      final prefs = await SharedPreferences.getInstance();
      if (!current()) return;
      if (prefs.getString('phone') != null) {
        await prefs.remove(key);
        if (current()) tokenNotifier.value = null;
        return;
      }
      await prefs.setString(
        key,
        jsonEncode({
          'token': normalized,
          'capturedAt': (now ?? DateTime.now()).toUtc().toIso8601String(),
        }),
      );
      // Writes and removals are serialized: this cleanup cannot erase a newer
      // invitation even when an older platform write finishes after cancel.
      if (!current() || prefs.getString('phone') != null) {
        await prefs.remove(key);
        return;
      }
      tokenNotifier.value = normalized;
    });
  }

  static Future<void> clear() {
    final revision = ++_mutationRevision;
    return _serialize(() async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(key);
      if (revision == _mutationRevision) tokenNotifier.value = null;
    });
  }
}
