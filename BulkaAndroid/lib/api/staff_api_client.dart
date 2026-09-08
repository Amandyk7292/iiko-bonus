part of '../main.dart';

class StaffApiException implements Exception {
  const StaffApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;
  @override
  String toString() => message;
}

/// Employee sessions are isolated from customer tokens and persisted in Keychain.
/// Uses the same server-issued, revocable session as the web admin, never iiko credentials.
class StaffApiClient {
  StaffApiClient({
    http.Client? client,
    String? baseUrl,
    SessionStorageBackend? storage,
    @visibleForTesting bool? browserTransport,
  }) : _client = client ?? createBulkaHttpClient(),
       _base = Uri.parse(baseUrl ?? _apiBaseUrl),
       _storage = storage ?? const SessionStorageBackend(),
       _browserTransport = browserTransport ?? kIsWeb;
  static const sessionKey = 'bulka_staff_session_v1';
  final http.Client _client;
  final Uri _base;
  final SessionStorageBackend _storage;
  final bool _browserTransport;
  String? _token;
  String branchId = '';
  List<String> branchIds = [];
  String get scopeKey => branchId.isNotEmpty ? branchId : branchIds.join(',');
  VoidCallback? onUnauthorized;
  Future<void> _sessionCleanup = Future<void>.value();

  Future<Map<String, dynamic>?> restore() async {
    if (!_browserTransport) _token = await _storage.read(key: sessionKey);
    if (!_browserTransport && _token == null) return null;
    try {
      return Map<String, dynamic>.from(
        (await request('/session'))['user'] as Map,
      );
    } on StaffApiException catch (error) {
      if (error.status == 401) return null;
      rethrow;
    }
  }

  /// Imports only a server-issued native session. Web keeps its HttpOnly cookie
  /// in the browser and never writes an admin token into web storage.
  Future<void> adoptSessionCookie(String cookie) async {
    if (_browserTransport) return;
    final token = RegExp(
      r'^bulka_admin=([^;,\s]+)(?:;|$)',
    ).firstMatch(cookie)?.group(1);
    if (token == null ||
        cookie.length > 8192 ||
        cookie.contains(RegExp(r'[\r\n]'))) {
      throw const AdminPortalLoginException('auth_admin_session_error');
    }
    if (token == _token) return;
    await _sessionCleanup;
    await _storage.write(key: sessionKey, value: token);
    _token = token;
    branchId = '';
    branchIds = [];
  }

  Future<Map<String, dynamic>> login(
    String username,
    String password,
    String code,
  ) async {
    return _authenticate('/login', {
      'username': username.trim(),
      'password': password,
      if (code.trim().isNotEmpty) 'code': code.trim(),
    });
  }

  Future<Map<String, dynamic>> exchangeOperatorAccess(String token) =>
      _authenticate('/whatsapp/operator-access', {'token': token});

  Future<dynamic> requestPhone(String phone) => request(
    '/login/phone/request',
    method: 'POST',
    body: {'phone': phone.trim()},
    authenticated: false,
  );
  Future<Map<String, dynamic>> verifyPhone(String phone, String code) =>
      _authenticate('/login/phone/verify', {
        'phone': phone.trim(),
        'code': code.trim(),
      });

  Future<Map<String, dynamic>> _authenticate(
    String endpoint,
    Map<String, dynamic> body,
  ) async {
    final response = await _send(
      endpoint,
      method: 'POST',
      body: body,
      authenticated: false,
      headers: {'Origin': _base.origin},
    );
    final data = _decode(response);
    final cookie = response.headers['set-cookie'] ?? '';
    final token = RegExp(
      r'(?:^|[,;]\s*)bulka_admin=([^;,\s]+)',
    ).firstMatch(cookie)?.group(1);
    if (token == null ||
        token.isEmpty ||
        data is! Map ||
        data['user'] is! Map) {
      throw const StaffApiException(
        502,
        'SESSION_MISSING',
        'Не удалось создать сессию сотрудника',
      );
    }
    await _sessionCleanup;
    await _storage.write(key: sessionKey, value: token);
    _token = token;
    return Map<String, dynamic>.from(data['user'] as Map);
  }

  Future<void> logout() async {
    try {
      await request('/logout', method: 'POST');
    } on StaffApiException catch (error) {
      // Expired/revoked already means signed out. A network or server failure
      // still propagates so we never claim a live session was revoked.
      if (error.status != 401) rethrow;
    }
    _token = null;
    branchId = '';
    branchIds = [];
    if (!_browserTransport) await _storage.delete(key: sessionKey);
  }

  Future<http.Response> _send(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    // API paths are local contracts. Never forward employee credentials to redirects or external URLs.
    final endpointPath = Uri.decodeComponent(
      endpoint.split(RegExp(r'[?#]')).first,
    );
    if (!endpoint.startsWith('/') ||
        endpoint.startsWith('//') ||
        endpointPath.contains('://') ||
        endpointPath.split('/').contains('..') ||
        endpointPath.contains('\\')) {
      throw ArgumentError.value(endpoint, 'endpoint');
    }
    final baseUri = _base.resolve('/admin/api$endpoint');
    final uri = query.isEmpty
        ? baseUri
        : baseUri.replace(
            queryParameters: {...baseUri.queryParameters, ...query},
          );
    final sentToken = authenticated ? _token : null;
    final request = http.Request(method, uri)..followRedirects = false;
    request.headers.addAll({
      'Accept': 'application/json',
      ...headers,
      if (authenticated && _token != null) 'Authorization': 'Bearer $_token',
      if (authenticated &&
          branchId.isNotEmpty &&
          endpoint != '/session' &&
          endpoint != '/scope')
        'X-Bulka-Branch-Id': branchId,
      if (authenticated &&
          branchId.isEmpty &&
          branchIds.isNotEmpty &&
          endpoint != '/session' &&
          endpoint != '/scope')
        (endpoint == '/menu' || endpoint.startsWith('/menu/')
                ? 'X-Bulka-Branch-Id'
                : 'X-Bulka-Branch-Ids'):
            endpoint == '/menu' || endpoint.startsWith('/menu/')
            ? branchIds.first
            : branchIds.join(','),
    });
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      final response = await http.Response.fromStream(
        await _client.send(request),
      ).timeout(const Duration(seconds: 120));
      if (response.statusCode == 401) _invalidate(sentToken);
      return response;
    } on TimeoutException {
      throw const StaffApiException(
        504,
        'TIMEOUT',
        'Сервер не ответил вовремя. Повторите запрос.',
      );
    } on http.ClientException {
      throw const StaffApiException(
        0,
        'NETWORK',
        'Нет связи с сервером. Проверьте интернет.',
      );
    }
  }

  void _invalidate(String? sentToken) {
    // A response from a previous login must not sign out the new session.
    if (!_browserTransport && (sentToken == null || sentToken != _token)) {
      return;
    }
    _token = null;
    branchId = '';
    branchIds = [];
    _sessionCleanup = _browserTransport
        ? Future<void>.value()
        : _storage.delete(key: sessionKey);
    unawaited(_sessionCleanup.catchError((Object _) {}));
    onUnauthorized?.call();
  }

  dynamic _decode(http.Response response) {
    dynamic data;
    try {
      data = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StaffApiException(
        response.statusCode,
        data is Map ? '${data['code'] ?? 'API_ERROR'}' : 'API_ERROR',
        response.statusCode == 401
            ? staffText(
                'Сессия завершена. Войдите снова.',
                'Сессия аяқталды. Қайта кіріңіз.',
                'Your session has ended. Please sign in again.',
              )
            : data is Map
            ? '${data['error'] ?? data['message'] ?? 'Не удалось выполнить запрос'}'
            : 'Не удалось выполнить запрос',
      );
    }
    if (response.statusCode == 204) return <String, dynamic>{};
    if (data == null) {
      throw const StaffApiException(
        502,
        'INVALID_RESPONSE',
        'Не удалось прочитать ответ сервера',
      );
    }
    return data;
  }

  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async => _decode(
    await _send(
      endpoint,
      method: method,
      body: body,
      authenticated: authenticated,
      headers: headers,
      query: query,
    ),
  );

  Future<Map<String, dynamic>> report(
    String endpoint,
    Map<String, dynamic> query, {
    bool Function()? isCancelled,
  }) async {
    final deadline = DateTime.now().add(const Duration(minutes: 3));
    do {
      if (isCancelled?.call() == true) {
        throw const StaffApiException(499, 'CANCELLED', 'Запрос отменён');
      }
      final result = Map<String, dynamic>.from(
        await request(
              endpoint,
              method: 'POST',
              body: query,
              headers: const {'X-Iiko-Async': '1'},
            )
            as Map,
      );
      if (result['pending'] != true) return result;
      if (DateTime.now().isAfter(deadline)) {
        throw const StaffApiException(
          504,
          'TIMEOUT',
          'Подготовка отчёта заняла слишком много времени',
        );
      }
      await Future<void>.delayed(const Duration(seconds: 1));
    } while (true);
  }

  Future<Uint8List> exportFile(
    String endpoint, {
    String method = 'POST',
    Object? body,
  }) async {
    final response = await _send(endpoint, method: method, body: body);
    if (response.statusCode != 200) _decode(response);
    final bytes = response.bodyBytes;
    if (bytes.length < 4 || bytes[0] != 0x50 || bytes[1] != 0x4b) {
      throw const StaffApiException(
        502,
        'INVALID_EXPORT',
        'Сервер не вернул файл Excel',
      );
    }
    return bytes;
  }

  Stream<Map<String, dynamic>> events({String? lastEventId}) async* {
    final sentToken = _token;
    final request = http.Request(
      'GET',
      _base
          .resolve('/admin/api/events')
          .replace(
            queryParameters: {
              if (branchId.isNotEmpty) 'scopeBranchId': branchId,
              if (branchId.isEmpty && branchIds.isNotEmpty)
                'scopeBranchIds': branchIds.join(','),
              if (lastEventId != null && lastEventId.isNotEmpty)
                'lastEventId': lastEventId,
            },
          ),
    )..followRedirects = false;
    request.headers.addAll({
      'Accept': 'text/event-stream',
      if (_token != null) 'Authorization': 'Bearer $_token',
    });
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      if (response.statusCode == 401) _invalidate(sentToken);
      _decode(
        await http.Response.fromStream(
          response,
        ).timeout(const Duration(seconds: 20)),
      );
      return;
    }
    String type = 'message', id = '';
    final data = <String>[];
    await for (final line
        in response.stream
            .timeout(const Duration(seconds: 50))
            .transform(utf8.decoder)
            .transform(const LineSplitter())) {
      if (line.isEmpty) {
        if (data.isNotEmpty) {
          final decoded = jsonDecode(data.join('\n'));
          yield {'type': type, 'id': id, 'data': decoded};
        }
        type = 'message';
        id = '';
        data.clear();
      } else if (line.startsWith('event:')) {
        type = line.substring(6).trim();
      } else if (line.startsWith('id:')) {
        id = line.substring(3).trim();
      } else if (line.startsWith('data:')) {
        data.add(line.substring(5).trimLeft());
      }
    }
  }

  Future<dynamic> uploadImage(
    String endpoint,
    Uint8List bytes,
    String filename,
  ) async {
    if (![
      '/menu/upload-image',
      '/loyalty-tiers/upload-image',
    ].contains(endpoint)) {
      throw ArgumentError.value(endpoint);
    }
    if (bytes.length > 8 * 1024 * 1024) {
      throw const StaffApiException(
        413,
        'IMAGE_TOO_LARGE',
        'Изображение должно быть меньше 8 МБ',
      );
    }
    final sentToken = _token;
    final request = http.MultipartRequest(
      'POST',
      _base.resolve('/admin/api$endpoint'),
    )..followRedirects = false;
    request.headers.addAll({
      'Accept': 'application/json',
      if (sentToken != null) 'Authorization': 'Bearer $sentToken',
      if (branchId.isNotEmpty) 'X-Bulka-Branch-Id': branchId,
      if (branchId.isEmpty && branchIds.isNotEmpty)
        'X-Bulka-Branch-Id': branchIds.first,
    });
    final ext = filename.toLowerCase().split('.').last;
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        bytes,
        filename: filename,
        contentType: MediaType(
          'image',
          ext == 'png'
              ? 'png'
              : ext == 'webp'
              ? 'webp'
              : 'jpeg',
        ),
      ),
    );
    final response = await http.Response.fromStream(
      await _client.send(request),
    ).timeout(const Duration(seconds: 120));
    if (response.statusCode == 401) _invalidate(sentToken);
    return _decode(response);
  }

  void close() => _client.close();

  Future<dynamic> sendVoice(
    String conversationId,
    Uint8List bytes,
    int durationSeconds,
    String clientMessageId,
  ) async {
    if (!RegExp(r'^[a-fA-F0-9-]{36}$').hasMatch(conversationId) ||
        bytes.isEmpty ||
        bytes.length > 16 * 1024 * 1024 ||
        durationSeconds < 1 ||
        durationSeconds > 120) {
      throw ArgumentError('Invalid voice message');
    }
    final sentToken = _token;
    final request = http.MultipartRequest(
      'POST',
      _base.resolve('/admin/api/whatsapp/conversations/$conversationId/voice'),
    )..followRedirects = false;
    request.headers.addAll({
      'Accept': 'application/json',
      if (sentToken != null) 'Authorization': 'Bearer $sentToken',
    });
    request.fields.addAll({
      'durationSeconds': '$durationSeconds',
      'clientMessageId': clientMessageId,
    });
    request.files.add(
      http.MultipartFile.fromBytes(
        'audio',
        bytes,
        filename: 'voice.m4a',
        contentType: MediaType('audio', 'mp4'),
      ),
    );
    final response = await http.Response.fromStream(
      await _client.send(request),
    ).timeout(const Duration(seconds: 120));
    if (response.statusCode == 401) _invalidate(sentToken);
    return _decode(response);
  }
}
