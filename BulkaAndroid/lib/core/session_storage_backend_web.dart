import 'package:web/web.dart' as web;

/// Web session persistence that never exposes a long-lived refresh token.
///
/// The short-lived access token is limited to the current browser tab. The
/// backend owns the refresh token in an HttpOnly, Secure, SameSite cookie.
class SessionStorageBackend {
  const SessionStorageBackend();

  bool get persistsRefreshToken => false;

  static final Map<String, String> _memoryFallback = <String, String>{};
  static const _refreshKey = 'bulka_refresh_token';

  Future<String?> read({required String key}) async {
    if (key == _refreshKey) {
      await delete(key: key);
      return null;
    }
    try {
      final current =
          web.window.sessionStorage.getItem(key) ?? _memoryFallback[key];
      if (current != null && current.isNotEmpty) return current;

      // Move an access token left by an older release out of localStorage.
      final legacy = web.window.localStorage.getItem(key);
      if (legacy != null && legacy.isNotEmpty) {
        web.window.sessionStorage.setItem(key, legacy);
        web.window.localStorage.removeItem(key);
        _memoryFallback[key] = legacy;
        return legacy;
      }
      return null;
    } catch (_) {
      return _memoryFallback[key];
    }
  }

  Future<void> write({required String key, required String value}) async {
    if (key == _refreshKey) {
      await delete(key: key);
      return;
    }
    _memoryFallback[key] = value;
    try {
      web.window.sessionStorage.setItem(key, value);
      web.window.localStorage.removeItem(key);
    } catch (_) {
      // Safari may deny persistent storage in private/embedded contexts.
      // The in-memory fallback keeps the current tab usable.
    }
  }

  Future<void> delete({required String key}) async {
    _memoryFallback.remove(key);
    try {
      web.window.sessionStorage.removeItem(key);
      web.window.localStorage.removeItem(key);
    } catch (_) {
      // The value is already removed from the in-memory fallback.
    }
  }
}
