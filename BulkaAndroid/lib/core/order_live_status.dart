part of '../main.dart';

abstract final class OrderLiveStatus {
  static const MethodChannel _channel = MethodChannel(
    'com.bulka.bonus/order_status',
  );
  static BulkaApiClient? _api;
  static String? _lastPayload;
  static Timer? _expiryTimer;
  static final _pendingTokens = <String, Map<String, dynamic>>{};
  static final _registeringTokens = <String>{};

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
    if (order.usesDelivery && order.deliveryStatus != 'unassigned') {
      return 'delivery_status_${order.deliveryStatus}'.tr;
    }
    return 'order_status_${order.orderStatus}'.tr;
  }

  static Future<bool> _ordersEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_notificationPreferencesCacheKey);
    if (raw == null) return true;
    try {
      return NotificationPreferences.fromJson(
        _asMap(jsonDecode(raw)),
      ).ordersEnabled;
    } catch (_) {
      return true;
    }
  }

  static Future<void> sync(CustomerOrder? order) async {
    if (kIsWeb) return;
    _expiryTimer?.cancel();
    _expiryTimer = null;
    final expiresAt =
        order != null && !order.usesDelivery && order.orderStatus == 'ready'
        ? order.liveActivityExpiresAt
        : null;
    final expired = expiresAt != null && !expiresAt.isAfter(DateTime.now());
    if (order == null ||
        order.paymentStatus != 'paid' ||
        order.isClosed ||
        expired ||
        !(await _ordersEnabled())) {
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
      if (applied != false) _lastPayload = encoded;
    } catch (error) {
      debugPrint('Native order status unavailable: $error');
    }
  }

  static Future<void> clear({
    CustomerOrder? order,
    bool dismissImmediately = false,
  }) async {
    if (kIsWeb) return;
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
