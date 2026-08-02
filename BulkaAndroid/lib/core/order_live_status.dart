part of '../main.dart';

abstract final class OrderLiveStatus {
  static const MethodChannel _channel = MethodChannel(
    'com.bulka.bonus/order_status',
  );
  static BulkaApiClient? _api;
  static String? _lastPayload;

  static void attach(BulkaApiClient api) {
    _api = api;
    if (kIsWeb) return;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'liveActivityToken') return;
      final payload = _asMap(call.arguments);
      final client = _api;
      if (client == null || !client.isAuthenticated) return;
      await client.registerLiveActivity(
        pushToken: _asString(payload['pushToken']),
        activityId: _asString(payload['activityId']),
        installationId: await PushNotifications.installationId(),
        orderId: _asString(payload['orderId']),
        environment: _asString(payload['environment'], fallback: 'production'),
      );
    });
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
    if (order == null || order.isClosed || !(await _ordersEnabled())) {
      await clear(order: order);
      return;
    }
    final eta = order.eta?.toUtc();
    final payload = <String, dynamic>{
      'orderId': order.id,
      'orderNumber': order.number,
      'branch': order.branch,
      'status': _status(order),
      'orderStatus': order.orderStatus,
      'deliveryStatus': order.deliveryStatus,
      'fulfillmentType': order.effectiveFulfillmentType,
      'etaMillis': eta?.millisecondsSinceEpoch,
      'progress': _progress(order),
      'courierName': order.courier?.name ?? '',
      'language': AppLang.current,
    };
    final encoded = jsonEncode(payload);
    if (_lastPayload == encoded) return;
    _lastPayload = encoded;
    try {
      await _channel.invokeMethod<void>('updateOrderStatus', payload);
    } catch (error) {
      debugPrint('Native order status unavailable: $error');
    }
  }

  static Future<void> clear({CustomerOrder? order}) async {
    if (kIsWeb) return;
    _lastPayload = null;
    try {
      await _channel.invokeMethod<void>('clearOrderStatus', {
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
