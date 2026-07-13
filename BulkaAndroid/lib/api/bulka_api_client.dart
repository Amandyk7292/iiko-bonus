part of '../main.dart';

const _apiBaseUrl = String.fromEnvironment(
  'BULKA_API_BASE_URL',
  defaultValue: 'https://bulka.com.kz',
);

class BulkaApiClient {
  BulkaApiClient({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  String? _accessToken;

  void setAccessToken(String? token) {
    _accessToken = token;
  }

  Map<String, String> _headers({String? bearerToken, bool json = true}) {
    final token = bearerToken ?? _accessToken;
    return {
      if (json) 'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      'Accept-Language': AppLang.current,
    };
  }

  Uri _uri(String path) {
    final base = _apiBaseUrl.endsWith('/')
        ? _apiBaseUrl.substring(0, _apiBaseUrl.length - 1)
        : _apiBaseUrl;
    return Uri.parse('$base$path');
  }

  Future<ProfileResponse> getProfile(String phone) async {
    final json = await _post('/api/guest/profile', {'phone': phone});
    return ProfileResponse.fromJson(json);
  }

  Future<Tier?> getCustomerLoyalty() async {
    final json = await _get('/api/customer/loyalty');
    if (json['success'] == false) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    final nested = json['loyalty'] ?? json['tier'] ?? json['data'];
    final source = _asMap(nested);
    if (source.isNotEmpty) return Tier.fromJson(source);
    if (json.containsKey('name') ||
        json.containsKey('level') ||
        json.containsKey('progress')) {
      return Tier.fromJson(json);
    }
    return null;
  }

  Future<List<City>> getCities() async {
    final json = await _get('/api/public/cities');
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_load_cities'.tr));
    }
    final list = json['cities'] as List?;
    if (list == null) return [];
    return list.map((item) => City.fromJson(_asMap(item))).toList();
  }

  Future<OtpRequestResult> requestOtp({
    required String phone,
    required String token,
  }) async {
    final json = await _post('/api/auth/request-otp', {
      'phone': phone,
      'token': token,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_send_code'.tr));
    }
    return OtpRequestResult(
      whatsappUrl: _nullableString(json['whatsappUrl'] ?? json['whatsapp_url']),
      whatsappPhone: _nullableString(
        json['whatsappPhone'] ?? json['whatsapp_phone'],
      ),
    );
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
      throw ApiException(
        response.message ?? response.error ?? 'error_invalid_code'.tr,
      );
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
    required String registrationToken,
  }) async {
    final json = await _post('/api/auth/register', {
      'phone': phone,
      'name': name,
      'surname': surname,
      'gender': gender,
      'birthdate': birthdate,
      'email': email,
    }, bearerToken: registrationToken);
    final response = ProfileResponse.fromJson(json);
    if (!response.success) {
      throw ApiException(
        response.message ?? response.error ?? 'error_register'.tr,
      );
    }
    return response;
  }

  Future<void> updateProfile({
    required String phone,
    String? name,
    String? lastName,
    String? gender,
    String? birthDate,
    String? email,
    String? region,
  }) async {
    final response = await _client
        .put(
          _uri('/api/customer/profile'),
          headers: {..._headers()},
          body: jsonEncode({
            'name': ?name,
            'last_name': ?lastName,
            'gender': ?gender,
            'birth_date': ?birthDate,
            'email': ?email,
            'region': ?region,
          }),
        )
        .timeout(const Duration(seconds: 15));
    final json = _decode(response);
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<void> deleteAccount(String phone) async {
    final response = await _client
        .delete(
          _uri('/api/customer/profile'),
          headers: {..._headers(json: false)},
        )
        .timeout(const Duration(seconds: 15));
    final json = _decode(response);
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_delete_account'.tr));
    }
  }

  Future<void> registerFcmToken(String fcmToken) async {
    final json = await _post('/api/customer/fcm-token', {
      'fcmToken': fcmToken,
      'language': AppLang.current,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
  }

  Future<void> clearFcmToken() async {
    final response = await _client
        .delete(_uri('/api/customer/fcm-token'), headers: _headers(json: false))
        .timeout(const Duration(seconds: 15));
    if (response.statusCode >= 400) throw ApiException('error_network'.tr);
  }

  Future<String> getQrToken(String phone) async {
    final json = await _post('/api/guest/qr-token', {});
    final token = _asString(json['token']);
    if (json['success'] == true && token.isNotEmpty) return token;
    throw ApiException(_messageFrom(json, 'qr_unavailable'.tr));
  }

  Future<String> createWalletUrl(String phone) async {
    final json = await _post('/api/wallet/token', {});
    final preferred = defaultTargetPlatform == TargetPlatform.iOS
        ? _asString(json['appleUrl'])
        : _asString(json['googleUrl']);
    final path = preferred.isNotEmpty ? preferred : _asString(json['url']);
    if (path.isNotEmpty) {
      return path.startsWith('http') ? path : _uri(path).toString();
    }
    throw ApiException(_messageFrom(json, 'wallet_unavailable'.tr));
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

  Future<List<AppNotification>> getNotifications() async {
    final json = await _get('/api/customer/notifications');
    final items = json['notifications'];
    if (json['success'] != true || items is! List) return const [];
    return items.map((item) => AppNotification.fromJson(_asMap(item))).toList();
  }

  Future<void> markNotificationRead(String id) async {
    final json = await _post('/api/customer/notifications/$id/read', {});
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
  }

  Future<void> markAllNotificationsRead() async {
    final json = await _post('/api/customer/notifications/read-all', {});
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
  }

  Future<Map<String, List<String>>> getLocations() async {
    final json = await _get('/api/guest/locations');
    if (json['success'] == true && json['cityLocations'] is Map) {
      final data = json['cityLocations'] as Map;
      final result = <String, List<String>>{};
      for (final entry in data.entries) {
        if (entry.value is List) {
          result[entry.key.toString()] = (entry.value as List)
              .map((e) => e.toString())
              .toList();
        }
      }
      return result;
    }
    return const {};
  }

  Future<Map<String, dynamic>> createKaspiPayment({
    required List<Map<String, dynamic>> cartItems,
    required String orderType,
    required String scheduledAt,
    required String checkoutId,
    String? branch,
    String? branchId,
    DeliveryAddress? deliveryAddress,
    String? additionalPhone,
    String? promoCode,
    String? comment,
  }) async {
    final json = await _post('/api/customer/kaspi-pay/create', {
      'items': cartItems,
      'orderType': orderType,
      'branch': branch,
      'branchId': branchId,
      'scheduledAt': scheduledAt,
      'pickupTime': scheduledAt,
      'deliveryAddress': deliveryAddress?.toOrderPayload(),
      'checkoutId': checkoutId,
      'additionalPhone': additionalPhone,
      'promoCode': promoCode,
      'comment': comment,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_kaspi_payment'.tr));
    }
    return json;
  }

  Future<Map<String, dynamic>> quoteKaspiOrder({
    required List<Map<String, dynamic>> cartItems,
    String? orderType,
    String? branch,
    String? branchId,
    String? scheduledAt,
    DeliveryAddress? deliveryAddress,
    String? promoCode,
  }) async {
    final json = await _post('/api/customer/kaspi-pay/quote', {
      'items': cartItems,
      'orderType': orderType,
      'branch': branch,
      'branchId': branchId,
      'scheduledAt': scheduledAt,
      'deliveryAddress': deliveryAddress?.toOrderPayload(),
      'promoCode': promoCode,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_kaspi_payment'.tr));
    }
    return json;
  }

  Future<Map<String, dynamic>> checkKaspiPaymentStatus(
    String operationId,
  ) async {
    final json = await _get('/api/customer/kaspi-pay/status/$operationId');
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_kaspi_status'.tr));
    }
    return json;
  }

  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    final json = await _get('/api/guest/locations');
    final rawLocations = json['locations'];
    if (json['success'] == true && rawLocations is List) {
      return rawLocations
          .map((item) => BakeryLocation.fromJson(_asMap(item)))
          .where(
            (location) => location.active && location.displayLabel.isNotEmpty,
          )
          .toList();
    }

    final legacy = json['cityLocations'];
    if (json['success'] == true && legacy is Map) {
      final result = <BakeryLocation>[];
      for (final entry in legacy.entries) {
        if (entry.value is! List) continue;
        for (final item in entry.value as List) {
          final label = item.toString().trim();
          if (label.isEmpty) continue;
          result.add(
            BakeryLocation(
              id: '',
              name: label,
              address: '',
              city: entry.key.toString(),
            ),
          );
        }
      }
      return result;
    }
    return const [];
  }

  Future<List<Map<String, dynamic>>> searchDeliveryAddress(String query) async {
    final uri =
        '/api/public/geocode/search?q=${Uri.encodeQueryComponent(query)}';
    final json = await _get(uri);
    final results = json['results'];
    if (json['success'] != true || results is! List) return const [];
    return results.map((item) => _asMap(item)).toList();
  }

  Future<Map<String, dynamic>> reverseDeliveryAddress({
    required double latitude,
    required double longitude,
  }) async {
    final json = await _get(
      '/api/public/geocode/reverse?lat=$latitude&lon=$longitude',
    );
    if (json['success'] != true || json['result'] is! Map) {
      throw ApiException(_messageFrom(json, 'map_search_not_found'.tr));
    }
    return _asMap(json['result']);
  }

  Future<List<DeliveryAddress>> getCustomerAddresses() async {
    final json = await _get('/api/customer/addresses');
    final items = json['addresses'];
    if (json['success'] != true || items is! List) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return items
        .map((item) => DeliveryAddress.fromJson(_asMap(item)))
        .where(
          (address) => address.id.isNotEmpty && address.hasValidCoordinates,
        )
        .toList();
  }

  Future<DeliveryAddress> createCustomerAddress(DeliveryAddress address) async {
    final json = await _post(
      '/api/customer/addresses',
      address.toOrderPayload(),
    );
    final value = _asMap(json['address']);
    if (json['success'] != true || value.isEmpty) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return DeliveryAddress.fromJson(value);
  }

  Future<DeliveryAddress> updateCustomerAddress(DeliveryAddress address) async {
    final json = await _put(
      '/api/customer/addresses/${Uri.encodeComponent(address.id)}',
      address.toOrderPayload(),
    );
    final value = _asMap(json['address']);
    if (json['success'] != true || value.isEmpty) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return DeliveryAddress.fromJson(value);
  }

  Future<void> deleteCustomerAddress(String id) async {
    final json = await _delete(
      '/api/customer/addresses/${Uri.encodeComponent(id)}',
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<void> setDefaultCustomerAddress(String id) async {
    final json = await _patch(
      '/api/customer/addresses/${Uri.encodeComponent(id)}/default',
      const {},
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<List<CustomerOrder>> getCustomerOrders({
    bool completed = false,
  }) async {
    final scope = completed ? 'completed' : 'active';
    final json = await _get('/api/customer/orders?scope=$scope&pageSize=50');
    final orders = json['orders'];
    if (json['success'] != true || orders is! List) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return orders.map((item) => CustomerOrder.fromJson(_asMap(item))).toList();
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final response = await _client
        .get(_uri(path), headers: _headers(json: false))
        .timeout(const Duration(seconds: 15));
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    String? bearerToken,
  }) async {
    final response = await _client
        .post(
          _uri(path),
          headers: _headers(bearerToken: bearerToken),
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 15));
    return _decode(response);
  }

  Future<Map<String, dynamic>> _put(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _client
        .put(_uri(path), headers: _headers(), body: jsonEncode(body))
        .timeout(const Duration(seconds: 15));
    return _decode(response);
  }

  Future<Map<String, dynamic>> _patch(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _client
        .patch(_uri(path), headers: _headers(), body: jsonEncode(body))
        .timeout(const Duration(seconds: 15));
    return _decode(response);
  }

  Future<Map<String, dynamic>> _delete(String path) async {
    final response = await _client
        .delete(_uri(path), headers: _headers(json: false))
        .timeout(const Duration(seconds: 15));
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    final text = utf8.decode(response.bodyBytes);
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    final json = _asMap(decoded);
    if (response.statusCode >= 400) {
      throw ApiException(
        _messageFrom(json, 'error_network'.tr),
        statusCode: response.statusCode,
      );
    }
    return json;
  }
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}
