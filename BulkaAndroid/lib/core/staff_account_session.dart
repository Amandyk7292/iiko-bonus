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
      user = null;
      _notify();
    };
  }

  final StaffApiClient api;
  final AdminPortalLoginClient _login;
  final Future<String?> Function() _readCookie;
  final Future<void> Function() _clearCookie;
  Map<String, dynamic>? user;
  Future<void>? _restoring;
  int _revision = 0;
  bool _disposed = false;
  String? error;
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

  Future<void> restore() =>
      _restoring ??= _restore().whenComplete(() => _restoring = null);

  Future<void> _restore() async {
    final revision = _revision;
    try {
      // Also recovers the existing WebView-only sign-in after upgrading IPA 18.
      final cookie = await _readCookie();
      if (_disposed || revision != _revision) return;
      if (cookie != null && cookie.isNotEmpty) {
        await api.adoptSessionCookie(cookie);
      }
      final restored = await api.restore().timeout(const Duration(seconds: 30));
      if (_disposed || revision != _revision) return;
      user = restored;
      error = null;
    } catch (_) {
      if (_disposed || revision != _revision) return;
      // A network interruption must not turn an already verified staff member
      // into a guest. A server 401 is handled by the API's invalidation callback.
      error = 'auth_admin_network_error'.tr;
    }
    _notify();
  }

  Future<void> signIn(String username, String password, String code) async {
    final revision = ++_revision;
    await _restoring;
    if (_disposed || revision != _revision) return;
    final result = await _login.login(username, password, code);
    if (_disposed || revision != _revision) return;
    if (result.cookie != null) await api.adoptSessionCookie(result.cookie!);
    if (_disposed || revision != _revision) return;
    user = result.user;
    error = null;
    _notify();
  }

  Future<void> logout() async {
    ++_revision;
    await _restoring;
    await api.logout();
    user = null;
    error = null;
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
