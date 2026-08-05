part of '../main.dart';

const _apiBaseUrl = String.fromEnvironment(
  'BULKA_API_BASE_URL',
  defaultValue: 'https://bulka.com.kz',
);

@visibleForTesting
const bulkaPublicOfferVersion = '2026-07-27';

@visibleForTesting
const bulkaPrivacyPolicyVersion = '2026-07-27';

String preferredWalletPath(Map<String, dynamic> json, TargetPlatform platform) {
  if (platform == TargetPlatform.iOS) return _asString(json['appleUrl']);
  if (platform == TargetPlatform.android) return _asString(json['googleUrl']);
  return _asString(json['url']);
}

enum _SessionRefreshResult { refreshed, rejected, unavailable }

class BulkaApiClient {
  BulkaApiClient({
    http.Client? client,
    Future<void> Function(String? accessToken, String? refreshToken)?
    onSessionChanged,
  }) : _client = client ?? createBulkaHttpClient(),
       _onSessionChanged = onSessionChanged;

  final http.Client _client;
  final String _analyticsSessionId = _newAnalyticsId();
  Future<void> Function(String? accessToken, String? refreshToken)?
  _onSessionChanged;
  String? _accessToken;
  String? _refreshToken;
  String? _sessionCacheScope;
  Future<_SessionRefreshResult>? _refreshRequest;
  StreamController<Map<String, dynamic>>? _eventController;
  StreamSubscription<String>? _eventStreamSubscription;
  Completer<void>? _eventStreamDone;
  Completer<void> _eventWakeUp = Completer<void>();
  int _eventGeneration = 0;
  bool _eventLoopRunning = false;
  bool _disposed = false;

  Stream<Map<String, dynamic>> get customerEvents {
    _eventController ??= StreamController<Map<String, dynamic>>.broadcast(
      onListen: _startEventLoopIfAuthenticated,
      onCancel: () {
        _wakeEventLoop();
        unawaited(_cancelEventStream());
      },
    );
    return _eventController!.stream;
  }

  bool get isAuthenticated => _accessToken?.isNotEmpty == true;
  String? get accessToken => _accessToken;
  String? get sessionCacheScope => _sessionCacheScope;

  void setSession({
    String? accessToken,
    String? refreshToken,
    String? cacheScope,
  }) {
    final changed =
        _accessToken != accessToken ||
        _refreshToken != refreshToken ||
        _sessionCacheScope != cacheScope;
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    _sessionCacheScope = cacheScope;
    if (changed) {
      _eventGeneration++;
      _wakeEventLoop();
      unawaited(_cancelEventStream());
    }
    _startEventLoopIfAuthenticated();
  }

  void setAccessToken(String? token) {
    setSession(
      accessToken: token,
      refreshToken: _refreshToken,
      cacheScope: _sessionCacheScope,
    );
  }

  void setSessionListener(
    Future<void> Function(String? accessToken, String? refreshToken)? listener,
  ) {
    _onSessionChanged = listener;
  }

  Map<String, String> _headers({String? bearerToken, bool json = true}) {
    final token = bearerToken ?? _accessToken;
    return {
      if (json) 'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      'Accept-Language': AppLang.current,
      'X-Bulka-Session': _analyticsSessionId,
      if (kIsWeb) 'X-Bulka-Session-Transport': 'cookie',
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

  Future<BonusExpirySummary> getBonusExpiry({int days = 30}) async {
    final json = await _get('/api/customer/bonus-expiry?days=$days');
    final summary = _asMap(json['summary']);
    if (json['success'] != true || summary.isEmpty) {
      throw ApiException(_messageFrom(json, 'bonus_expiry_load_error'.tr));
    }
    return BonusExpirySummary.fromJson(summary);
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

  Future<ProfileResponse> loginWithPassword({
    required String phone,
    required String password,
  }) async {
    final json = await _post('/api/auth/login', {
      'phone': phone,
      'password': password,
    });
    return ProfileResponse.fromJson(json);
  }

  OtpRequestResult _otpRequestResult(Map<String, dynamic> json) {
    return OtpRequestResult(
      whatsappUrl: _nullableString(json['whatsappUrl'] ?? json['whatsapp_url']),
      whatsappPhone: _nullableString(
        json['whatsappPhone'] ?? json['whatsapp_phone'],
      ),
    );
  }

  Future<OtpRequestResult> startPasswordRegistration({
    required String phone,
    required String password,
    required String token,
  }) async {
    final json = await _post('/api/auth/register/start', {
      'phone': phone,
      'password': password,
      'token': token,
    });
    return _otpRequestResult(json);
  }

  Future<OtpRequestResult> startPasswordReset({
    required String phone,
    required String token,
  }) async {
    final json = await _post('/api/auth/password-reset/start', {
      'phone': phone,
      'token': token,
    });
    return _otpRequestResult(json);
  }

  Future<ProfileResponse> completePasswordReset({
    required String phone,
    required String code,
    required String password,
  }) async {
    final json = await _post('/api/auth/password-reset/complete', {
      'phone': phone,
      'code': code,
      'password': password,
    });
    return ProfileResponse.fromJson(json);
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
    return _otpRequestResult(json);
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
      'acceptedLegal': true,
      'legalConsent': {
        'offerVersion': bulkaPublicOfferVersion,
        'privacyVersion': bulkaPrivacyPolicyVersion,
        'locale': AppLang.current,
        'channel': kIsWeb ? 'web' : 'mobile_app',
        'acceptedAt': DateTime.now().toUtc().toIso8601String(),
      },
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
    String? avatarKey,
  }) async {
    final json = await _put('/api/customer/profile', {
      'name': ?name,
      'last_name': ?lastName,
      'gender': ?gender,
      'birth_date': ?birthDate,
      'email': ?email,
      'region': ?region,
      'avatar_key': ?avatarKey,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<AppReleasePolicy> getAppReleasePolicy(String platform) async {
    final normalized = platform.toLowerCase();
    final json = await _get(
      '/api/public/app-release?platform=${Uri.encodeQueryComponent(normalized)}',
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return AppReleasePolicy.fromJson(json);
  }

  Future<void> deleteAccount(String phone) async {
    final json = await _delete('/api/customer/profile');
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_delete_account'.tr));
    }
  }

  Future<void> registerFcmToken(
    String fcmToken, {
    required String platform,
    required String installationId,
  }) async {
    final json = await _post('/api/customer/fcm-token', {
      'fcmToken': fcmToken,
      'language': AppLang.current,
      'platform': platform,
      'installationId': installationId,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
  }

  Future<void> clearFcmToken({
    required String installationId,
    String? fcmToken,
  }) async {
    await _delete('/api/customer/fcm-token', {
      'installationId': installationId,
      if (fcmToken != null && fcmToken.isNotEmpty) 'fcmToken': fcmToken,
    });
  }

  Future<String> getQrToken(String phone) async {
    final json = await _post('/api/guest/qr-token', {});
    final token = _asString(json['token']);
    if (json['success'] == true && token.isNotEmpty) return token;
    throw ApiException(_messageFrom(json, 'qr_unavailable'.tr));
  }

  Future<String> createWalletUrl(String phone) async {
    final json = await _post('/api/wallet/token', {});
    final preferred = preferredWalletPath(json, defaultTargetPlatform);
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

  Future<List<AppContactCard>> getContactCards() async {
    final json = await _get('/api/public/contact-center');
    final cards = json['cards'];
    if (json['success'] != true || cards is! List) return const [];
    return cards
        .map((item) => AppContactCard.fromJson(_asMap(item)))
        .where((card) => card.id.isNotEmpty)
        .toList(growable: false);
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

  Future<NotificationPreferences> getNotificationPreferences() async {
    final json = await _get('/api/customer/notification-preferences');
    final preferences = _asMap(json['preferences']);
    if (json['success'] != true || preferences.isEmpty) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return NotificationPreferences.fromJson(preferences);
  }

  Future<NotificationPreferences> updateNotificationPreferences(
    NotificationPreferences preferences,
  ) async {
    final json = await _patch(
      '/api/customer/notification-preferences',
      preferences.toJson(),
    );
    final saved = _asMap(json['preferences']);
    if (json['success'] != true || saved.isEmpty) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return NotificationPreferences.fromJson(saved);
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
    String? preorderFulfillmentType,
    String? branch,
    String? branchId,
    DeliveryAddress? deliveryAddress,
    String? additionalPhone,
    String? promoCode,
    String? comment,
    String substitutionPreference = 'call_customer',
  }) async {
    final json = await _post('/api/customer/kaspi-pay/create', {
      'items': cartItems,
      'orderType': orderType,
      'preorderFulfillmentType': preorderFulfillmentType,
      'branch': branch,
      'branchId': branchId,
      'scheduledAt': scheduledAt,
      'pickupTime': scheduledAt,
      'deliveryAddress': deliveryAddress?.toOrderPayload(),
      'checkoutId': checkoutId,
      'additionalPhone': additionalPhone,
      'promoCode': promoCode,
      'comment': comment,
      'substitutionPreference': substitutionPreference,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_kaspi_payment'.tr));
    }
    return json;
  }

  Future<bool> isKaspiPaymentAvailable() async {
    final json = await _get('/api/customer/kaspi-pay/availability');
    return json['success'] == true && json['available'] == true;
  }

  Future<Map<String, dynamic>> quoteKaspiOrder({
    required List<Map<String, dynamic>> cartItems,
    String? orderType,
    String? branch,
    String? branchId,
    String? scheduledAt,
    String? preorderFulfillmentType,
    DeliveryAddress? deliveryAddress,
    String? promoCode,
  }) async {
    final json = await _post('/api/customer/kaspi-pay/quote', {
      'items': cartItems,
      'orderType': orderType,
      'preorderFulfillmentType': preorderFulfillmentType,
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

  Future<Map<String, dynamic>> quoteForteOrder({
    required List<Map<String, dynamic>> cartItems,
    String? orderType,
    String? branch,
    String? branchId,
    String? scheduledAt,
    String? preorderFulfillmentType,
    DeliveryAddress? deliveryAddress,
    String? promoCode,
  }) async {
    final json = await _post('/api/customer/forte-pay/quote', {
      'items': cartItems,
      'orderType': orderType,
      'preorderFulfillmentType': preorderFulfillmentType,
      'branch': branch,
      'branchId': branchId,
      'scheduledAt': scheduledAt,
      'deliveryAddress': deliveryAddress?.toOrderPayload(),
      'promoCode': promoCode,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_forte_payment'.tr));
    }
    return json;
  }

  Future<Map<String, dynamic>> checkKaspiPaymentStatus(
    String operationId,
  ) async {
    final json = await _get(
      '/api/customer/kaspi-pay/status/${Uri.encodeComponent(operationId)}',
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_kaspi_status'.tr));
    }
    return json;
  }

  Future<Map<String, dynamic>> createFortePayment({
    required List<Map<String, dynamic>> cartItems,
    required String orderType,
    required String scheduledAt,
    required String checkoutId,
    String? savedPaymentMethodId,
    String? preorderFulfillmentType,
    String? branch,
    String? branchId,
    DeliveryAddress? deliveryAddress,
    String? additionalPhone,
    String? promoCode,
    String? comment,
    String substitutionPreference = 'call_customer',
  }) async {
    final json = await _post('/api/customer/forte-pay/create', {
      'items': cartItems,
      'orderType': orderType,
      'preorderFulfillmentType': preorderFulfillmentType,
      'branch': branch,
      'branchId': branchId,
      'scheduledAt': scheduledAt,
      'pickupTime': scheduledAt,
      'deliveryAddress': deliveryAddress?.toOrderPayload(),
      'checkoutId': checkoutId,
      'savedPaymentMethodId': savedPaymentMethodId,
      'additionalPhone': additionalPhone,
      'promoCode': promoCode,
      'comment': comment,
      'substitutionPreference': substitutionPreference,
      'language': AppLang.current,
    });
    if (json['success'] != true) {
      throw ApiException(
        _messageFrom(json, 'error_forte_payment'.tr),
        code: _nullableString(json['code']),
        requestId: _requestIdFrom(json),
      );
    }
    return json;
  }

  String? _forteSavedCardLabel;
  String? get forteSavedCardLabel => _forteSavedCardLabel;

  Future<bool> isFortePaymentAvailable() async {
    final json = await _get('/api/customer/forte-pay/availability');
    final savedCard = json['savedCard'];
    if (savedCard is Map) {
      final brand = (savedCard['brand'] ?? 'card').toString().trim();
      final lastFour = (savedCard['lastFour'] ?? '').toString().trim();
      _forteSavedCardLabel = lastFour.length == 4
          ? '${brand.toUpperCase()} •••• $lastFour'
          : null;
    } else {
      _forteSavedCardLabel = null;
    }
    return json['success'] == true && json['available'] == true;
  }

  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async {
    final json = await _get('/api/customer/forte-pay/methods');
    final methods = json['methods'];
    if (json['success'] != true || methods is! List) return const [];
    return methods
        .whereType<Map>()
        .map((method) => Map<String, dynamic>.from(method))
        .toList();
  }

  Future<Map<String, dynamic>> createForteCardSetup() async {
    final json = await _post('/api/customer/forte-pay/card-setup', {
      'language': AppLang.current,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'payment_methods_add_error'.tr));
    }
    return json;
  }

  Future<Map<String, dynamic>> checkForteCardSetupStatus(
    String operationId,
  ) async {
    final json = await _get(
      '/api/customer/forte-pay/card-setup/${Uri.encodeComponent(operationId)}',
    );
    if (json['success'] != true) {
      throw ApiException(
        _messageFrom(json, 'payment_methods_add_error'.tr),
        code: _nullableString(json['code']),
        requestId: _requestIdFrom(json),
      );
    }
    return json;
  }

  Future<void> removeFortePaymentMethod(String methodId) async {
    final json = await _delete(
      '/api/customer/forte-pay/methods/${Uri.encodeComponent(methodId)}',
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_forte_payment'.tr));
    }
    _forteSavedCardLabel = null;
  }

  Future<void> setDefaultFortePaymentMethod(String methodId) async {
    final json = await _patch(
      '/api/customer/forte-pay/methods/${Uri.encodeComponent(methodId)}/default',
      const {},
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_forte_payment'.tr));
    }
  }

  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async {
    final json = await _get(
      '/api/customer/forte-pay/status/${Uri.encodeComponent(operationId)}',
    );
    if (json['success'] != true) {
      throw ApiException(
        _messageFrom(json, 'error_forte_status'.tr),
        code: _nullableString(json['code']),
        requestId: _requestIdFrom(json),
      );
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

  Future<List<Map<String, dynamic>>> searchDeliveryAddress(
    String query, {
    String? city,
  }) async {
    final normalizedCity = city?.trim() ?? '';
    final cityParameter = normalizedCity.isEmpty
        ? ''
        : '&city=${Uri.encodeQueryComponent(normalizedCity)}';
    final uri =
        '/api/public/geocode/search?q=${Uri.encodeQueryComponent(query)}$cityParameter';
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

  Future<CustomerOrder> markCustomerArrived(String orderId) async {
    final json = await _post(
      '/api/customer/orders/${Uri.encodeComponent(orderId)}/arrived',
      const {},
    );
    final order = _asMap(json['order']);
    if (json['success'] != true || order.isEmpty) {
      throw ApiException(_messageFrom(json, 'orders_arrival_error'.tr));
    }
    return CustomerOrder.fromJson(order);
  }

  Future<CustomerOrder> cancelCustomerOrder(String orderId) async {
    final json = await _post(
      '/api/customer/orders/${Uri.encodeComponent(orderId)}/cancel',
      const {},
    );
    final order = _asMap(json['order']);
    if (json['success'] != true || order.isEmpty) {
      throw ApiException(
        _messageFrom(json, 'order_cancel_error'.tr),
        code: _asString(json['code']),
      );
    }
    return CustomerOrder.fromJson(order);
  }

  Future<PickupHandoff> getPickupHandoff(String orderId) async {
    final json = await _get(
      '/api/customer/orders/${Uri.encodeComponent(orderId)}/pickup-handoff',
    );
    final handoff = _asMap(json['handoff']);
    if (json['success'] != true || handoff.isEmpty) {
      throw ApiException(_messageFrom(json, 'pickup_handoff_load_error'.tr));
    }
    return PickupHandoff.fromJson(handoff);
  }

  Future<OrderSubstitution> respondToOrderSubstitution({
    required String orderId,
    required String requestId,
    required bool approved,
  }) async {
    final json = await _post(
      '/api/customer/orders/${Uri.encodeComponent(orderId)}/substitutions/'
      '${Uri.encodeComponent(requestId)}/respond',
      {'approved': approved},
    );
    final substitution = _asMap(json['substitution']);
    if (json['success'] != true || substitution.isEmpty) {
      throw ApiException(
        _messageFrom(json, 'substitution_response_error'.tr),
        code: _asString(json['code']),
      );
    }
    return OrderSubstitution.fromJson(substitution);
  }

  Future<Map<String, dynamic>> getProductOptions(String productId) async {
    final json = await _get(
      '/api/public/product-options?ids=${Uri.encodeQueryComponent(productId)}',
    );
    return _asMap(_asMap(json['products'])[productId]);
  }

  Future<Map<String, Map<String, dynamic>>> getProductOptionsBatch(
    Iterable<String> productIds,
  ) async {
    final ids = productIds
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList(growable: false);
    final result = <String, Map<String, dynamic>>{};
    for (var offset = 0; offset < ids.length; offset += 180) {
      final end = min(offset + 180, ids.length);
      final batch = ids.sublist(offset, end);
      final json = await _get(
        '/api/public/product-options'
        '?ids=${Uri.encodeQueryComponent(batch.join(','))}',
      );
      final products = _asMap(json['products']);
      for (final id in batch) {
        result[id] = _asMap(products[id]);
      }
    }
    return result;
  }

  Future<Map<String, bool>> getProductOptionFlagsBatch(
    Iterable<String> productIds,
  ) async {
    final ids = productIds
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList(growable: false);
    final result = <String, bool>{};
    for (var offset = 0; offset < ids.length; offset += 180) {
      final end = min(offset + 180, ids.length);
      final batch = ids.sublist(offset, end);
      final json = await _get(
        '/api/public/product-options'
        '?summary=1&ids=${Uri.encodeQueryComponent(batch.join(','))}',
      );
      final products = _asMap(json['products']);
      for (final id in batch) {
        result[id] = products[id] == true;
      }
    }
    return result;
  }

  Future<Set<String>> getFavorites() async {
    if (!isAuthenticated) return const {};
    final json = await _get('/api/customer/favorites');
    final values = json['favorites'];
    if (values is! List) return const {};
    return values
        .map((value) => _asString(_asMap(value)['productId']))
        .where((value) => value.isNotEmpty)
        .toSet();
  }

  Future<void> setFavorite(String productId, bool favorite) async {
    final json = await _put('/api/customer/favorites/$productId', {
      'favorite': favorite,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<List<StockSubscription>> getStockSubscriptions() async {
    final json = await _get('/api/customer/stock-subscriptions');
    final values = json['subscriptions'];
    if (json['success'] != true || values is! List) {
      throw ApiException(_messageFrom(json, 'stock_notify_load_error'.tr));
    }
    return values
        .map((value) => StockSubscription.fromJson(_asMap(value)))
        .where(
          (value) =>
              value.id.isNotEmpty &&
              value.productId.isNotEmpty &&
              value.branchId.isNotEmpty,
        )
        .toList(growable: false);
  }

  Future<StockSubscription> createStockSubscription({
    required String productId,
    required String branchId,
  }) async {
    final json = await _post('/api/customer/stock-subscriptions', {
      'productId': productId,
      'branchId': branchId,
    });
    final value = _asMap(json['subscription']);
    if (json['success'] != true || value.isEmpty) {
      throw ApiException(_messageFrom(json, 'stock_notify_save_error'.tr));
    }
    return StockSubscription.fromJson(value);
  }

  Future<void> deleteStockSubscription(String id) async {
    final json = await _delete(
      '/api/customer/stock-subscriptions/${Uri.encodeComponent(id)}',
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'stock_notify_save_error'.tr));
    }
  }

  Future<void> recordProductView(String productId) async {
    if (!isAuthenticated) return;
    await _post('/api/customer/recent/$productId', const {});
  }

  Future<List<String>> getRecentProductIds() async {
    if (!isAuthenticated) return const [];
    final json = await _get('/api/customer/recent?limit=20');
    return (json['recent'] as List? ?? const [])
        .map((value) => _asString(_asMap(value)['productId']))
        .where((value) => value.isNotEmpty)
        .toList();
  }

  Future<List<String>> getRecommendationProductIds() async {
    if (!isAuthenticated) return const [];
    final json = await _get('/api/customer/recommendations?limit=16');
    return (json['recommendations'] as List? ?? const [])
        .map((value) => _asString(_asMap(value)['productId']))
        .where((value) => value.isNotEmpty)
        .toList();
  }

  Future<List<Map<String, dynamic>>> reorder(
    String orderId, {
    String? branchId,
  }) async {
    final json = await _post('/api/customer/orders/$orderId/reorder', {
      if (branchId?.isNotEmpty == true) 'branchId': branchId,
    });
    final cart = _asMap(json['cart']);
    final items = cart['items'];
    if (json['success'] != true || items is! List) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return items.map((value) => _asMap(value)).toList();
  }

  Future<List<SupportRequest>> getSupportRequests() async {
    final json = await _get('/api/customer/support');
    final requests = json['requests'];
    if (json['success'] != true || requests is! List) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return requests
        .map((item) => SupportRequest.fromJson(_asMap(item)))
        .toList();
  }

  Future<SupportRequest> createSupportRequest({
    String? orderId,
    required String category,
    required String message,
    bool refundRequested = false,
    List<String> attachments = const [],
  }) async {
    final json = await _post('/api/customer/support', {
      'orderId': orderId,
      'category': category,
      'message': message,
      'refundRequested': refundRequested,
      'attachments': attachments,
    });
    final request = _asMap(json['request']);
    if (json['success'] != true || request.isEmpty) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return SupportRequest.fromJson(request);
  }

  Future<SupportThread> getSupportThread(String requestId) async {
    final json = await _get(
      '/api/customer/support/${Uri.encodeComponent(requestId)}',
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return SupportThread.fromJson(json);
  }

  Future<SupportThread> sendSupportReply(
    String requestId,
    String message,
  ) async {
    final json = await _post(
      '/api/customer/support/${Uri.encodeComponent(requestId)}/messages',
      {'body': message},
    );
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return SupportThread.fromJson(json);
  }

  Future<String> uploadSupportAttachment({
    required List<int> bytes,
    required String fileName,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      _uri('/api/customer/support/upload'),
    );
    request.headers.addAll(_headers(json: false));
    final extension = fileName.split('.').last.toLowerCase();
    final subtype = extension == 'png'
        ? 'png'
        : extension == 'webp'
        ? 'webp'
        : 'jpeg';
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        bytes,
        filename: fileName,
        contentType: MediaType('image', subtype),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    final json = _asMap(jsonDecode(response.body));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return _asString(_asMap(json['attachment'])['path']);
  }

  Future<void> registerLiveActivity({
    required String pushToken,
    required String activityId,
    required String installationId,
    required String orderId,
    required String environment,
  }) async {
    final json = await _post('/api/customer/live-activity', {
      'pushToken': pushToken,
      'activityId': activityId,
      'installationId': installationId,
      'orderId': orderId,
      'environment': environment,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<void> deactivateLiveActivity({
    String? activityId,
    String? orderId,
  }) async {
    await _delete('/api/customer/live-activity', {
      if (activityId?.isNotEmpty == true) 'activityId': activityId,
      if (orderId?.isNotEmpty == true) 'orderId': orderId,
    });
  }

  Future<void> submitOrderReview({
    required String orderId,
    required int rating,
    String? comment,
    List<Map<String, dynamic>> items = const [],
  }) async {
    final json = await _put('/api/customer/orders/$orderId/review', {
      'rating': rating,
      'comment': comment,
      'items': items,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<Map<String, dynamic>> getReferral() async {
    final json = await _get('/api/customer/referral');
    return _asMap(json['referral']);
  }

  Future<void> redeemReferral(String code) async {
    final json = await _post('/api/customer/referral/redeem', {'code': code});
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
  }

  Future<int> redeemGiftCard(String code) async {
    final json = await _post('/api/customer/gift-cards/redeem', {'code': code});
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return (json['amount'] as num?)?.round() ?? 0;
  }

  Future<Map<String, dynamic>> createGiftCertificatePurchase({
    required String requestId,
    required int amount,
    required String recipientPhone,
    String? recipientName,
    String? message,
    DateTime? deliveryAt,
    required String paymentMethod,
  }) async {
    final json = await _post('/api/customer/gift-certificate-purchases', {
      'requestId': requestId,
      'amount': amount,
      'recipient': {
        'phone': recipientPhone,
        if (recipientName?.trim().isNotEmpty == true)
          'name': recipientName!.trim(),
        if (message?.trim().isNotEmpty == true) 'message': message!.trim(),
      },
      if (deliveryAt != null)
        'deliveryAt': deliveryAt.toUtc().toIso8601String(),
      'paymentMethod': paymentMethod,
      'locale': AppLang.current,
    });
    final purchase = _asMap(json['purchase']);
    final payment = _asMap(json['payment']);
    final purchaseStatus = _asString(purchase['status']).trim().toLowerCase();
    if (json['success'] != true ||
        purchase.isEmpty ||
        (payment.isEmpty && purchaseStatus != 'active')) {
      throw ApiException(_messageFrom(json, 'gift_purchase_error'.tr));
    }
    return {'purchase': purchase, 'payment': payment};
  }

  Future<List<Map<String, dynamic>>> getGiftCertificatePurchases() async {
    final json = await _get('/api/customer/gift-certificate-purchases');
    if (json['success'] != true || json['purchases'] is! List) {
      throw ApiException(_messageFrom(json, 'gift_purchase_error'.tr));
    }
    return (json['purchases'] as List)
        .map(_asMap)
        .where((purchase) => purchase.isNotEmpty)
        .toList(growable: false);
  }

  Future<Map<String, dynamic>> getGiftCertificatePurchase(String id) async {
    final json = await _get(
      '/api/customer/gift-certificate-purchases/${Uri.encodeComponent(id)}',
    );
    final purchase = _asMap(json['purchase']);
    if (json['success'] != true || purchase.isEmpty) {
      throw ApiException(_messageFrom(json, 'gift_purchase_error'.tr));
    }
    return purchase;
  }

  Future<List<Map<String, dynamic>>> getReceivedGiftCards() async {
    final json = await _get('/api/customer/gift-cards');
    if (json['success'] != true || json['cards'] is! List) {
      throw ApiException(_messageFrom(json, 'gift_purchase_error'.tr));
    }
    return (json['cards'] as List)
        .map(_asMap)
        .where((card) => card.isNotEmpty)
        .toList(growable: false);
  }

  Future<Map<String, dynamic>> exportPersonalData() async {
    final json = await _get('/api/customer/profile/export');
    if (json['success'] != true || json['export'] is! Map) {
      throw ApiException(_messageFrom(json, 'error_network'.tr));
    }
    return _asMap(json['export']);
  }

  Future<String> uploadCakeReference({
    required List<int> bytes,
    required String fileName,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      _uri('/api/customer/cake-reference'),
    );
    request.headers.addAll(_headers(json: false));
    final extension = fileName.split('.').last.toLowerCase();
    final subtype = extension == 'png'
        ? 'png'
        : extension == 'webp'
        ? 'webp'
        : 'jpeg';
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        bytes,
        filename: fileName,
        contentType: MediaType('image', subtype),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    final json = _asMap(jsonDecode(response.body));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_messageFrom(json, 'error_save'.tr));
    }
    return _asString(json['url']);
  }

  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
  }) async {
    final query = Uri(
      queryParameters: {
        'branchId': branchId,
        'orderType': orderType,
        'days': '$days',
      },
    ).query;
    final json = await _get('/api/public/fulfillment-slots?$query');
    final slots = json['slots'];
    if (json['success'] != true || slots is! List) {
      throw ApiException(_messageFrom(json, 'checkout_no_time_slots'.tr));
    }
    final requestedOffset = _asInt(
      json['timezoneOffsetMinutes'],
      fallback: 300,
    );
    final timezoneOffsetMinutes = requestedOffset.abs() <= 840
        ? requestedOffset
        : 300;
    final serverTime = DateTime.tryParse(_asString(json['serverTime']));
    return slots
        .map(
          (item) => FulfillmentSlot.fromJson(
            _asMap(item),
            timezoneOffsetMinutes: timezoneOffsetMinutes,
            serverTime: serverTime,
          ),
        )
        .toList();
  }

  Future<void> recordAnalyticsEvents(List<Map<String, dynamic>> events) async {
    if (events.isEmpty) return;
    final body = {'events': events};
    if (isAuthenticated) {
      await _post('/api/customer/analytics/events', body);
      return;
    }
    await _request(
      'POST',
      '/api/public/analytics/events',
      body: body,
      allowRefresh: false,
    );
  }

  void trackEvent(
    String type, {
    String? productId,
    String? categoryId,
    String? branchId,
    String? orderId,
    Map<String, dynamic> properties = const {},
  }) {
    unawaited(
      recordAnalyticsEvents([
        {
          'eventId': _newAnalyticsId(),
          'type': type,
          'occurredAt': DateTime.now().toUtc().toIso8601String(),
          if (productId?.isNotEmpty == true) 'productId': productId,
          if (categoryId?.isNotEmpty == true) 'categoryId': categoryId,
          if (branchId?.isNotEmpty == true) 'branchId': branchId,
          if (orderId?.isNotEmpty == true) 'orderId': orderId,
          if (properties.isNotEmpty) 'properties': properties,
        },
      ]).catchError((_) {}),
    );
  }

  static String _newAnalyticsId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<void> logoutSession() async {
    final refreshToken = _refreshToken;
    if (!kIsWeb && (refreshToken == null || refreshToken.isEmpty)) return;
    try {
      await _request(
        'POST',
        '/api/auth/logout',
        body: {
          if (!kIsWeb && refreshToken != null) 'refreshToken': refreshToken,
        },
        allowRefresh: false,
      );
    } catch (_) {}
  }

  void _startEventLoopIfAuthenticated() {
    if (_disposed ||
        _accessToken == null ||
        _eventController?.hasListener != true) {
      return;
    }
    if (_eventLoopRunning) return;
    _eventLoopRunning = true;
    unawaited(_runEventLoop());
  }

  void _wakeEventLoop() {
    if (!_eventWakeUp.isCompleted) _eventWakeUp.complete();
    _eventWakeUp = Completer<void>();
  }

  Future<void> _cancelEventStream() async {
    final done = _eventStreamDone;
    _eventStreamDone = null;
    if (done != null && !done.isCompleted) done.complete();
    final subscription = _eventStreamSubscription;
    _eventStreamSubscription = null;
    await subscription?.cancel();
  }

  Future<void> _consumeEventStream(
    http.StreamedResponse response,
    int generation,
  ) async {
    final done = Completer<void>();
    late final StreamSubscription<String> subscription;
    subscription = response.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(
          (line) {
            if (generation != _eventGeneration || !line.startsWith('data:')) {
              return;
            }
            try {
              final decoded = jsonDecode(line.substring(5).trim());
              final event = _asMap(decoded);
              if (event.isNotEmpty) _eventController?.add(event);
            } catch (_) {
              // Ignore a malformed SSE frame without dropping the connection.
            }
          },
          onError: (Object error, StackTrace stackTrace) {
            if (!done.isCompleted) done.completeError(error, stackTrace);
          },
          onDone: () {
            if (!done.isCompleted) done.complete();
          },
          cancelOnError: true,
        );

    if (generation != _eventGeneration || _disposed) {
      await subscription.cancel();
      return;
    }
    _eventStreamSubscription = subscription;
    _eventStreamDone = done;
    try {
      await done.future;
    } finally {
      if (identical(_eventStreamSubscription, subscription)) {
        _eventStreamSubscription = null;
      }
      if (identical(_eventStreamDone, done)) _eventStreamDone = null;
      await subscription.cancel();
    }
  }

  Future<void> _runEventLoop() async {
    try {
      while (!_disposed && _eventController?.hasListener == true) {
        if (_accessToken == null) break;
        final generation = _eventGeneration;
        try {
          final request = http.Request('GET', _uri('/api/customer/events'));
          request.headers.addAll(_headers(json: false));
          var response = await _client
              .send(request)
              .timeout(const Duration(seconds: 15));
          if (generation != _eventGeneration || _disposed) break;
          if (response.statusCode == 401) {
            final refresh = await _refreshSession();
            if (generation != _eventGeneration || _disposed) break;
            if (refresh == _SessionRefreshResult.refreshed) {
              final retry = http.Request('GET', _uri('/api/customer/events'));
              retry.headers.addAll(_headers(json: false));
              response = await _client
                  .send(retry)
                  .timeout(const Duration(seconds: 15));
            } else if (refresh == _SessionRefreshResult.rejected) {
              break;
            } else {
              throw ApiException(
                'error_network'.tr,
                code: 'SESSION_REFRESH_UNAVAILABLE',
              );
            }
          }
          if (generation != _eventGeneration || _disposed) break;
          if (response.statusCode >= 400) {
            throw ApiException('error_network'.tr);
          }
          await _consumeEventStream(response, generation);
        } catch (_) {
          if (generation != _eventGeneration || _disposed) break;
          final wakeUp = _eventWakeUp.future;
          await Future.any<void>([
            Future<void>.delayed(const Duration(seconds: 3)),
            wakeUp,
          ]);
        }
      }
    } finally {
      await _cancelEventStream();
      _eventLoopRunning = false;
      _startEventLoopIfAuthenticated();
    }
  }

  Future<Map<String, dynamic>> _get(String path) async {
    return _request('GET', path);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    String? bearerToken,
  }) async {
    return _request(
      'POST',
      path,
      body: body,
      bearerToken: bearerToken,
      allowRefresh: bearerToken == null,
    );
  }

  Future<Map<String, dynamic>> _put(
    String path,
    Map<String, dynamic> body,
  ) async {
    return _request('PUT', path, body: body);
  }

  Future<Map<String, dynamic>> _patch(
    String path,
    Map<String, dynamic> body,
  ) async {
    return _request('PATCH', path, body: body);
  }

  Future<Map<String, dynamic>> _delete(
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    return _request('DELETE', path, body: body);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? bearerToken,
    bool allowRefresh = true,
  }) async {
    Future<http.Response> send() {
      final uri = _uri(path);
      final headers = _headers(bearerToken: bearerToken, json: body != null);
      final encodedBody = body == null ? null : jsonEncode(body);
      return switch (method) {
        'GET' => _client.get(uri, headers: headers),
        'POST' => _client.post(uri, headers: headers, body: encodedBody),
        'PUT' => _client.put(uri, headers: headers, body: encodedBody),
        'PATCH' => _client.patch(uri, headers: headers, body: encodedBody),
        'DELETE' => _client.delete(uri, headers: headers, body: encodedBody),
        _ => throw ArgumentError.value(method, 'method'),
      }.timeout(const Duration(seconds: 15));
    }

    var response = await send();
    if (response.statusCode == 401 &&
        allowRefresh &&
        bearerToken == null &&
        (kIsWeb || _refreshToken?.isNotEmpty == true)) {
      final refresh = await _refreshSession();
      if (refresh == _SessionRefreshResult.refreshed) {
        response = await send();
      } else if (refresh == _SessionRefreshResult.unavailable) {
        throw ApiException(
          'error_network'.tr,
          code: 'SESSION_REFRESH_UNAVAILABLE',
        );
      }
    }
    return _decode(response);
  }

  Future<bool> restoreSession() async {
    if (isAuthenticated) return true;
    if (!kIsWeb && _refreshToken?.isNotEmpty != true) return false;
    return await _refreshSession() == _SessionRefreshResult.refreshed;
  }

  Future<_SessionRefreshResult> _refreshSession() {
    final inFlight = _refreshRequest;
    if (inFlight != null) return inFlight;
    final request = _performRefresh();
    _refreshRequest = request;
    request.whenComplete(() {
      if (identical(_refreshRequest, request)) _refreshRequest = null;
    });
    return request;
  }

  Future<void> _rejectSession() async {
    final hadLocalSession =
        _accessToken?.isNotEmpty == true || _refreshToken?.isNotEmpty == true;
    _accessToken = null;
    _refreshToken = null;
    _eventGeneration++;
    _wakeEventLoop();
    await _cancelEventStream();
    if (hadLocalSession) await _onSessionChanged?.call(null, null);
  }

  Future<_SessionRefreshResult> _performRefresh() async {
    final refreshToken = _refreshToken;
    if (!kIsWeb && (refreshToken == null || refreshToken.isEmpty)) {
      return _SessionRefreshResult.rejected;
    }
    try {
      final response = await _client
          .post(
            _uri('/api/auth/refresh'),
            headers: _headers(),
            body: jsonEncode({
              if (!kIsWeb && refreshToken != null) 'refreshToken': refreshToken,
            }),
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode >= 400) {
        if (response.statusCode == 408 ||
            response.statusCode == 425 ||
            response.statusCode == 429 ||
            response.statusCode >= 500) {
          return _SessionRefreshResult.unavailable;
        }
        await _rejectSession();
        return _SessionRefreshResult.rejected;
      }
      final json = _asMap(jsonDecode(utf8.decode(response.bodyBytes)));
      final accessToken = _nullableString(json['accessToken']);
      final nextRefresh = _nullableString(json['refreshToken']);
      if (accessToken == null || (!kIsWeb && nextRefresh == null)) {
        return _SessionRefreshResult.unavailable;
      }
      _accessToken = accessToken;
      _refreshToken = kIsWeb ? null : nextRefresh;
      await _onSessionChanged?.call(accessToken, nextRefresh);
      return _SessionRefreshResult.refreshed;
    } catch (_) {
      return _SessionRefreshResult.unavailable;
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _eventGeneration++;
    _wakeEventLoop();
    unawaited(_cancelEventStream());
    unawaited(_eventController?.close() ?? Future<void>.value());
    _client.close();
  }

  Map<String, dynamic> _decode(http.Response response) {
    final text = utf8.decode(response.bodyBytes);
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    final json = _asMap(decoded);
    final responseRequestId =
        _requestIdFrom(json) ??
        _nullableString(
          response.headers['x-request-id'] ?? response.headers['request-id'],
        );
    if (response.statusCode >= 400) {
      throw ApiException(
        _messageFrom(json, 'error_network'.tr),
        statusCode: response.statusCode,
        code: _nullableString(json['code']),
        requestId: responseRequestId,
      );
    }
    if (responseRequestId != null && !json.containsKey('_requestId')) {
      json['_requestId'] = responseRequestId;
    }
    return json;
  }
}

String? _requestIdFrom(Map<String, dynamic> json) {
  final nested = _asMap(json['error']);
  final value = _nullableString(
    json['requestId'] ??
        json['request_id'] ??
        json['_requestId'] ??
        nested['requestId'] ??
        nested['request_id'],
  );
  if (value == null ||
      value.length > 160 ||
      !RegExp(r'^[A-Za-z0-9._:-]+$').hasMatch(value)) {
    return null;
  }
  return value;
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code, this.requestId});

  final String message;
  final int? statusCode;
  final String? code;
  final String? requestId;

  String? get supportCode {
    final raw = requestId?.replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
    if (raw == null || raw.isEmpty) return null;
    final short = raw.length <= 10 ? raw : raw.substring(raw.length - 10);
    return short.toUpperCase();
  }

  @override
  String toString() => message;
}
