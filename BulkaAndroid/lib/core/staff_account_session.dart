part of '../main.dart';

/// App-level staff identity verified by the server, separate from the customer's
/// bonus account. The same session drives the profile, native cashier and portal.
class StaffAccountSession extends ChangeNotifier {
  StaffAccountSession({
    StaffApiClient? api,
    AdminPortalLoginClient? loginClient,
    Future<String?> Function()? readPortalCookie,
    Future<void> Function()? clearPortalCookie,
  }) : api = api ?? StaffApiClient(),
       _login = loginClient ?? AdminPortalLoginClient(),
       _readCookie = readPortalCookie ?? _nativeCookie,
       _clearCookie = clearPortalCookie ?? _clearNativeCookie {
    this.api.onUnauthorized = () {
      ++_serverRevocationRevision;
      user = null;
      error = null;
      unawaited(_savePreviousWebSession(false));
      _notify();
    };
  }

  final StaffApiClient api;
  final AdminPortalLoginClient _login;
  final Future<String?> Function() _readCookie;
  final Future<void> Function() _clearCookie;
  Map<String, dynamic>? user;
  Future<void>? _restoring;
  Future<void>? _loggingOut;
  int _revision = 0;
  int _serverRevocationRevision = 0;
  bool _disposed = false;
  static const previousWebSessionKey = 'bulka_staff_signed_in_v1';
  bool _hasPreviousWebSession = false;
  Future<bool>? _previousWebSessionRead;
  Future<void> _previousWebSessionWrite = Future<void>.value();
  int _hintRevision = 0;
  String? error;
  bool get hasPreviousWebSession => _hasPreviousWebSession;
  String get role => '${user?['role'] ?? ''}';
  bool get isCashier => role == 'cashier';
  bool get isAuthenticated => user != null;
  bool get canOpenPortal => isAuthenticated && !isCashier;
  String get displayName =>
      '${user?['displayName'] ?? user?['username'] ?? ''}';

  static Future<String?> _nativeCookie() async {
    if (kIsWeb) return null;
    try {
      return await AdminPortalLoginClient._channel.invokeMethod<String>(
        'readCookie',
      );
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  static Future<void> _clearNativeCookie() async {
    if (kIsWeb) return;
    await AdminPortalLoginClient._channel.invokeMethod<void>('clearCookie');
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// A browsing hint only: the HttpOnly server cookie remains the sole web
  /// credential, and identity/role always come from /admin/api/session.
  Future<bool> readPreviousWebSession() {
    if (!api._browserTransport) return Future<bool>.value(false);
    return _previousWebSessionRead ??= _readPreviousWebSession();
  }

  Future<bool> _readPreviousWebSession() async {
    final revision = _hintRevision;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (revision == _hintRevision) {
        _hasPreviousWebSession = prefs.getBool(previousWebSessionKey) == true;
      }
    } catch (_) {
      // Storage restrictions must never grant access or prevent sign-in.
    }
    return _hasPreviousWebSession;
  }

  Future<void> _savePreviousWebSession(bool value) {
    if (!api._browserTransport) return Future<void>.value();
    ++_hintRevision;
    _hasPreviousWebSession = value;
    _previousWebSessionRead = Future<bool>.value(value);
    // Serialize storage writes so an old revocation cannot overwrite a later
    // verified login when the browser's storage responds slowly.
    return _previousWebSessionWrite = _previousWebSessionWrite.then((_) async {
      try {
        final prefs = await SharedPreferences.getInstance();
        if (value) {
          await prefs.setBool(previousWebSessionKey, true);
        } else {
          await prefs.remove(previousWebSessionKey);
        }
      } catch (_) {
        // The hint contains no identity or credential and is best effort only.
      }
    });
  }

  Future<void> restore() =>
      _restoring ??= _restore().whenComplete(() => _restoring = null);

  Future<void> _restore() async {
    final revision = _revision;
    final serverRevision = _serverRevocationRevision;
    try {
      // Also recovers the existing WebView-only sign-in after upgrading IPA 18.
      final cookie = await _readCookie();
      if (_disposed ||
          revision != _revision ||
          serverRevision != _serverRevocationRevision) {
        return;
      }
      if (cookie != null && cookie.isNotEmpty) {
        await api.adoptSessionCookie(cookie);
      }
      final restored = await api.restore().timeout(
        Duration(seconds: api._browserTransport ? 8 : 30),
      );
      if (_disposed ||
          revision != _revision ||
          serverRevision != _serverRevocationRevision) {
        await _previousWebSessionWrite;
        return;
      }
      user = restored;
      error = null;
      if (restored != null) {
        await _savePreviousWebSession(true);
      } else {
        await _previousWebSessionWrite;
      }
      if (_disposed ||
          revision != _revision ||
          serverRevision != _serverRevocationRevision) {
        return;
      }
    } catch (_) {
      if (_disposed ||
          revision != _revision ||
          serverRevision != _serverRevocationRevision) {
        await _previousWebSessionWrite;
        return;
      }
      // A network interruption must not turn an already verified staff member
      // into a guest. A server 401 is handled by the API's invalidation callback.
      error = 'auth_admin_network_error'.tr;
    }
    _notify();
  }

  Future<void> signIn(String username, String password, String code) async {
    await _loggingOut;
    final revision = ++_revision;
    await _restoring;
    if (_disposed || revision != _revision) return;
    final result = await _login.login(username, password, code);
    if (_disposed || revision != _revision) return;
    if (result.cookie != null) await api.adoptSessionCookie(result.cookie!);
    if (_disposed || revision != _revision) return;
    api._markBrowserSessionVerified();
    user = result.user;
    error = null;
    await _savePreviousWebSession(true);
    if (_disposed || revision != _revision) return;
    _notify();
  }

  Future<void> logout() =>
      _loggingOut ??= _logout().whenComplete(() => _loggingOut = null);

  Future<void> _logout() async {
    ++_revision;
    await _restoring;
    await api.logout();
    user = null;
    error = null;
    await _savePreviousWebSession(false);
    _notify();
    try {
      await _clearCookie();
    } on PlatformException {
      /* Server session is already revoked. */
    } on MissingPluginException {
      /* No native cookie store on this platform. */
    }
  }

  @override
  void dispose() {
    _disposed = true;
    api.onUnauthorized = null;
    api.close();
    _login.dispose();
    super.dispose();
  }
}

class StaffSessionRestorationScreen extends StatelessWidget {
  const StaffSessionRestorationScreen({
    required this.loading,
    required this.onRetry,
    this.error,
    super.key,
  });
  final bool loading;
  final String? error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: loading
          ? const CircularProgressIndicator()
          : Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    error ?? 'auth_admin_network_error'.tr,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => unawaited(onRetry()),
                    child: Text('retry_btn'.tr),
                  ),
                ],
              ),
            ),
    ),
  );
}
