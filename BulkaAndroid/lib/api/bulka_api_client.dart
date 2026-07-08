part of '../main.dart';

const _apiBaseUrl = String.fromEnvironment(
  'BULKA_API_BASE_URL',
  defaultValue: 'https://iiko-bonus.onrender.com',
);

class BulkaApiClient {
  BulkaApiClient({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Uri _uri(String path) {
    final base = _apiBaseUrl.endsWith('/')
        ? _apiBaseUrl.substring(0, _apiBaseUrl.length - 1)
        : _apiBaseUrl;
    return Uri.parse('$base$path');
  }

  Future<ProfileResponse> getProfile(String phone) async {
    final json = await _post('/api/guest/profile', {
      'phone': phone,
      'name': '',
      'register': false,
    });
    return ProfileResponse.fromJson(json);
  }

  Future<void> requestOtp({
    required String phone,
    required String token,
  }) async {
    final json = await _post('/api/auth/request-otp', {
      'phone': phone,
      'token': token,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'Ошибка при отправке кода'));
    }
  }

  Future<ProfileResponse> verifyOtp({
    required String phone,
    required String code,
  }) async {
    final json = await _post('/api/auth/verify-otp', {
      'phone': phone,
      'code': code,
    });
    final response = ProfileResponse.fromJson(json);
    if (!response.success) {
      throw ApiException(response.message ?? response.error ?? 'Неверный код');
    }
    return response;
  }

  Future<ProfileResponse> registerCustomer({
    required String phone,
    required String name,
    String? surname,
    String? gender,
    String? birthdate,
    String? email,
  }) async {
    final json = await _post('/api/auth/register', {
      'phone': phone,
      'name': name,
      'surname': surname,
      'gender': gender,
      'birthdate': birthdate,
      'email': email,
    });
    final response = ProfileResponse.fromJson(json);
    if (!response.success) {
      throw ApiException(response.message ?? response.error ?? 'Ошибка при регистрации');
    }
    return response;
  }

  Future<String> getQrToken(String phone) async {
    final json = await _post('/api/guest/qr-token', {'phone': phone});
    final token = _asString(json['token']);
    if (json['success'] == true && token.isNotEmpty) return token;
    throw ApiException(_messageFrom(json, 'QR временно недоступен'));
  }

  Future<String> createWalletUrl(String phone) async {
    final json = await _post('/api/wallet/token', {'phone': phone});
    final url = _asString(json['url']);
    if (url.isNotEmpty) return url;
    throw ApiException(_messageFrom(json, 'Wallet временно недоступен'));
  }

  Future<List<PromoStory>> getStories() async {
    final json = await _get('/api/guest/stories');
    final stories = json['stories'];
    if (json['success'] == true && stories is List) {
      return stories.map((item) => PromoStory.fromJson(_asMap(item))).toList();
    }
    return const [];
  }

  Future<List<NewsItem>> getNews() async {
    final json = await _get('/api/guest/news');
    final news = json['news'];
    if (json['success'] == true && news is List) {
      return news.map((item) => NewsItem.fromJson(_asMap(item))).toList();
    }
    return const [];
  }

  Future<Map<String, List<String>>> getLocations() async {
    final json = await _get('/api/guest/locations');
    if (json['success'] == true && json['cityLocations'] is Map) {
      final data = json['cityLocations'] as Map;
      final result = <String, List<String>>{};
      for (final entry in data.entries) {
        if (entry.value is List) {
          result[entry.key.toString()] =
              (entry.value as List).map((e) => e.toString()).toList();
        }
      }
      return result;
    }
    return const {};
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final response = await _client.get(_uri(path));
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _client.post(
      _uri(path),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    final text = utf8.decode(response.bodyBytes);
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    final json = _asMap(decoded);
    if (response.statusCode >= 400) {
      throw ApiException(_messageFrom(json, 'Ошибка сети'));
    }
    return json;
  }
}

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
