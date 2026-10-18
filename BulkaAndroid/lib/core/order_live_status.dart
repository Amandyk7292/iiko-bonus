part of '../main.dart';

abstract final class OrderLiveStatus {
  static const MethodChannel _channel = MethodChannel(
    'com.bulka.bonus/order_status',
  );
  static BulkaApiClient? _api;
  static String? _lastPayload;
  static int _syncGeneration = 0;
  static Timer? _expiryTimer;
  static final _pendingTokens = <String, Map<String, dynamic>>{};
  static final _registeringTokens = <String>{};
  static BulkaApiClient? _preferencesClient;
  static String? _preferencesScope;
  static Future<NotificationPreferences>? _preferencesLoad;

  static void attach(BulkaApiClient api) {
    _api = api;
    if (kIsWeb) return;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'liveActivityToken') return;
      final payload = _asMap(call.arguments);
      final activityId = _asString(payload['activityId']);
      if (activityId.isEmpty) return;
      _pendingTokens[activityId] = payload;
      await _registerToken(activityId);
    });
  }

  static Future<void> _registerToken(String activityId) async {
    final client = _api;
    final payload = _pendingTokens[activityId];
    if (client == null || !client.isAuthenticated || payload == null) return;
    if (!_registeringTokens.add(activityId)) return;
    try {
      await client.registerLiveActivity(
        pushToken: _asString(payload['pushToken']),
        activityId: _asString(payload['activityId']),
        installationId: await PushNotifications.installationId(),
        orderId: _asString(payload['orderId']),
        environment: _asString(payload['environment'], fallback: 'production'),
      );
      if (identical(_pendingTokens[activityId], payload)) {
        _pendingTokens.remove(activityId);
      }
    } catch (_) {
      // Retain the current token until the next order refresh after recovery.
    } finally {
      _registeringTokens.remove(activityId);
    }
  }

  static double _progress(CustomerOrder order) {
    if (order.isClosed) return 1;
    if (const {'picked_up', 'en_route'}.contains(order.deliveryStatus)) {
      return .82;
    }
    return switch (order.orderStatus) {
      'accepted' => .22,
      'preparing' => .42,
      'ready' => .68,
      _ => .08,
    };
  }

  static String _status(CustomerOrder order) {
    if (order.hasDeliveryResolutionInProgress) {
      return customerOrderStatusLabel(order);
    }
    if (order.usesDelivery && order.deliveryStatus != 'unassigned') {
      return 'delivery_status_${order.deliveryStatus}'.tr;
    }
    return 'order_status_${order.orderStatus}'.tr;
  }

  static Future<bool> _ordersEnabled() async {
    final client = _api;
    final scope = client?.sessionCacheScope;
    if (scope == null) return true;
    bool sameAccount() =>
        identical(client, _api) && scope == client!.sessionCacheScope;
    final prefs = await SharedPreferences.getInstance();
    if (!sameAccount()) return false;
    final cacheKey = _notificationPreferencesCacheKey(scope);
    bool? cachedPreference() {
      final raw = prefs.getString(cacheKey);
      if (raw == null) return null;
      try {
        return NotificationPreferences.fromJson(
          _asMap(jsonDecode(raw)),
        ).ordersEnabled;
      } catch (_) {
        return null;
      }
    }

    final cached = cachedPreference();
    if (cached != null) return cached;
    final pending =
        identical(_preferencesClient, client) && _preferencesScope == scope
        ? _preferencesLoad
        : null;
    final loading = pending ?? client!.getNotificationPreferences();
    _preferencesClient = client;
    _preferencesScope = scope;
    _preferencesLoad = loading;
    try {
      final remote = await loading;
      if (!sameAccount()) return false;
      // A settings save may have completed while the GET was in flight.
      final saved = cachedPreference();
      if (saved != null) return saved;
      await prefs.setString(cacheKey, jsonEncode(remote.toJson()));
      return sameAccount() && remote.ordersEnabled;
    } catch (_) {
      // Retry on the next refresh without inventing a stored user preference.
      return false;
    } finally {
      if (identical(_preferencesLoad, loading)) _preferencesLoad = null;
    }
  }

  static Future<void> sync(CustomerOrder? order) async {
    if (kIsWeb) return;
    final generation = ++_syncGeneration;
    _expiryTimer?.cancel();
    _expiryTimer = null;
    final expiresAt =
        order != null && !order.usesDelivery && order.orderStatus == 'ready'
        ? order.liveActivityExpiresAt
        : null;
    final expired = expiresAt != null && !expiresAt.isAfter(DateTime.now());
    final client = _api;
    final scope = client?.sessionCacheScope;
    final enabled =
        order != null &&
        order.paymentStatus == 'paid' &&
        !order.isClosed &&
        !expired &&
        await _ordersEnabled();
    if (generation != _syncGeneration ||
        !identical(client, _api) ||
        scope != client?.sessionCacheScope) {
      return;
    }
    if (order == null ||
        order.paymentStatus != 'paid' ||
        order.isClosed ||
        expired ||
        !enabled) {
      await clear(order: order, dismissImmediately: expired);
      return;
    }
    if (expiresAt != null) {
      _expiryTimer = Timer(expiresAt.difference(DateTime.now()), () {
        unawaited(clear(order: order, dismissImmediately: true));
      });
    }
    final eta = order.eta?.toUtc();
    final payload = <String, dynamic>{
      'orderId': order.id,
      'orderNumber': order.number,
      'branch': order.branch,
      'status': _status(order),
      'paymentStatus': order.paymentStatus,
      'orderStatus': order.orderStatus,
      'deliveryStatus': order.deliveryStatus,
      'fulfillmentType': order.effectiveFulfillmentType,
      'etaMillis': eta?.millisecondsSinceEpoch,
      'progress': _progress(order),
      'courierName': order.courier?.name ?? '',
      'language': AppLang.current,
      'liveActivityExpiresAtMillis': expiresAt?.millisecondsSinceEpoch,
    };
    final encoded = jsonEncode(payload);
    for (final activityId in _pendingTokens.keys.toList()) {
      unawaited(_registerToken(activityId));
    }
    if (_lastPayload == encoded) return;
    try {
      final applied = await _channel.invokeMethod<bool>(
        'updateOrderStatus',
        payload,
      );
      if (applied != false && generation == _syncGeneration) {
        _lastPayload = encoded;
      }
    } catch (error) {
      debugPrint('Native order status unavailable: $error');
    }
  }

  static Future<void> clear({
    CustomerOrder? order,
    bool dismissImmediately = false,
  }) async {
    if (kIsWeb) return;
    _syncGeneration++;
    _expiryTimer?.cancel();
    _expiryTimer = null;
    _lastPayload = null;
    _pendingTokens.removeWhere(
      (_, payload) => order == null || payload['orderId'] == order.id,
    );
    try {
      await _channel.invokeMethod<void>('clearOrderStatus', {
        'dismissImmediately':
            dismissImmediately ||
            order == null ||
            order.paymentStatus != 'paid',
        if (order != null) ...{
          'orderId': order.id,
          'orderNumber': order.number,
          'status': _status(order),
          'orderStatus': order.orderStatus,
          'deliveryStatus': order.deliveryStatus,
          'fulfillmentType': order.effectiveFulfillmentType,
          'progress': 1.0,
          'branch': order.branch,
        },
      });
    } catch (error) {
      debugPrint('Native order status cleanup unavailable: $error');
    }
    if (_api?.isAuthenticated == true) {
      try {
        await _api!.deactivateLiveActivity(orderId: order?.id);
      } catch (error) {
        debugPrint('Live Activity token cleanup unavailable: $error');
      }
    }
  }
}
