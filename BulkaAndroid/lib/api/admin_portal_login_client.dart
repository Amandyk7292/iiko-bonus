part of '../main.dart';

class AdminPortalLoginException implements Exception {
  const AdminPortalLoginException(this.messageKey, {this.needsCode = false});
  final String messageKey;
  final bool needsCode;
}

/// Authenticates against the existing admin endpoint. Customer sessions are not
/// involved. Native apps preserve the server's HttpOnly cookie in WebView;
/// browsers receive that cookie directly and never read or store its value.
class AdminPortalLoginClient {
  AdminPortalLoginClient({
    http.Client? client,
    String? baseUrl,
    @visibleForTesting bool? browserTransport,
    @visibleForTesting Future<void> Function(Uri, String)? installCookie,
  }) : _client = client ?? createBulkaHttpClient(),
       _base = Uri.parse(baseUrl ?? _apiBaseUrl),
       _browserTransport = browserTransport ?? kIsWeb,
       _installCookie = installCookie ?? _installNativeCookie;

  final http.Client _client;
  final Uri _base;
  final bool _browserTransport;
  final Future<void> Function(Uri, String) _installCookie;
  static const _channel = MethodChannel('com.bulka.bonus/admin_session');

  static Future<void> _installNativeCookie(Uri uri, String cookie) async {
    final installed = await _channel
        .invokeMethod<bool>('installCookie', {
          'url': uri.toString(),
          'cookie': cookie,
        })
        .timeout(const Duration(seconds: 10));
    if (installed != true) {
      throw const AdminPortalLoginException('auth_admin_session_error');
    }
  }

  Future<void> login(String username, String password, String code) async {
    final uri = _base.resolve('/admin/api/login');
    if (!_browserTransport && uri.origin != bulkaProductionOrigin) {
      throw const AdminPortalLoginException('auth_admin_session_error');
    }
    final request = http.Request('POST', uri)..followRedirects = false;
    request.headers.addAll({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (!_browserTransport) 'Origin': uri.origin,
    });
    request.body = jsonEncode({
      'username': username.trim(),
      'password': password,
      if (code.trim().isNotEmpty) 'code': code.trim(),
    });
    try {
      final response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 30));
      final Object? data;
      try {
        data = jsonDecode(utf8.decode(response.bodyBytes));
      } on FormatException {
        throw const AdminPortalLoginException('auth_admin_unavailable');
      }
      if (response.statusCode == 401) {
        final needsCode =
            data is Map &&
            data['error'] == 'Invalid credentials or verification code';
        throw AdminPortalLoginException(
          needsCode ? 'auth_admin_code_required' : 'auth_admin_invalid',
          needsCode: needsCode,
        );
      }
      if (response.statusCode == 429) {
        throw const AdminPortalLoginException('auth_admin_rate_limit');
      }
      if (response.statusCode != 200 || data is! Map || data['user'] is! Map) {
        throw const AdminPortalLoginException('auth_admin_unavailable');
      }
      if (!_browserTransport) {
        final cookie = response.headers['set-cookie'] ?? '';
        if (!cookie.startsWith('bulka_admin=') ||
            cookie.contains(RegExp(r'[\r\n]')) ||
            !RegExp(
              r';\s*HttpOnly(?:;|$)',
              caseSensitive: false,
            ).hasMatch(cookie) ||
            !RegExp(
              r';\s*Secure(?:;|$)',
              caseSensitive: false,
            ).hasMatch(cookie) ||
            !RegExp(
              r';\s*Path=/admin(?:;|$)',
              caseSensitive: false,
            ).hasMatch(cookie)) {
          throw const AdminPortalLoginException('auth_admin_session_error');
        }
        await _installCookie(uri.resolve('/admin'), cookie);
      }
    } on TimeoutException {
      throw const AdminPortalLoginException('auth_admin_network_error');
    } on http.ClientException {
      throw const AdminPortalLoginException('auth_admin_network_error');
    } on PlatformException {
      throw const AdminPortalLoginException('auth_admin_session_error');
    } on MissingPluginException {
      throw const AdminPortalLoginException('auth_admin_session_error');
    }
  }

  void dispose() => _client.close();
}

Future<void> loginAdminPortal(
  String username,
  String password,
  String code,
) async {
  final client = AdminPortalLoginClient();
  try {
    await client.login(username, password, code);
  } finally {
    client.dispose();
  }
}
