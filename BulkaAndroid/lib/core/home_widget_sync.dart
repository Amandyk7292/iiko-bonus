part of '../main.dart';

/// Keeps the native Android/iOS home-screen widget in sync with the latest
/// authenticated customer and active order. The widget never stores a QR code
/// or any reusable credential.
abstract final class HomeWidgetSync {
  static const appGroupId = 'group.com.bulka.bonus';
  static const androidProvider = 'BulkaHomeWidgetProvider';
  static const iOSWidgetKind = 'BulkaHomeWidget';

  static bool get _supported {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }

  static Future<void> initialize() async {
    if (!_supported) return;
    try {
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        await HomeWidget.setAppGroupId(appGroupId);
      }
    } catch (_) {
      // A widget must never block app startup if the native extension is not
      // available in a local/debug build.
    }
  }

  static Future<void> update({
    required Customer customer,
    CustomerOrder? activeOrder,
  }) async {
    if (!_supported) return;
    try {
      await initialize();
      await Future.wait([
        HomeWidget.saveWidgetData<bool>('widget_is_signed_in', true),
        HomeWidget.saveWidgetData<double>('widget_balance', customer.balance),
        HomeWidget.saveWidgetData<String>(
          'widget_tier',
          customer.tier?.localizedName ?? '',
        ),
        HomeWidget.saveWidgetData<String>('widget_order_id', activeOrder?.id),
        HomeWidget.saveWidgetData<int>(
          'widget_order_number',
          activeOrder?.number,
        ),
        HomeWidget.saveWidgetData<String>(
          'widget_order_status',
          activeOrder?.orderStatus,
        ),
        HomeWidget.saveWidgetData<String>(
          'widget_delivery_status',
          activeOrder?.deliveryStatus,
        ),
        HomeWidget.saveWidgetData<String>(
          'widget_order_type',
          activeOrder?.fulfillmentType,
        ),
        HomeWidget.saveWidgetData<String>(
          'widget_order_eta',
          activeOrder?.estimatedDeliveryAt?.toIso8601String(),
        ),
      ]);
      await _reload();
    } catch (_) {
      // Widget synchronization is best-effort and must not affect ordering or
      // loyalty flows.
    }
  }

  static Future<void> clear() async {
    if (!_supported) return;
    try {
      await initialize();
      await Future.wait([
        HomeWidget.saveWidgetData<bool>('widget_is_signed_in', false),
        HomeWidget.saveWidgetData<double>('widget_balance', 0),
        HomeWidget.saveWidgetData<String>('widget_tier', null),
        HomeWidget.saveWidgetData<String>('widget_order_id', null),
        HomeWidget.saveWidgetData<int>('widget_order_number', null),
        HomeWidget.saveWidgetData<String>('widget_order_status', null),
        HomeWidget.saveWidgetData<String>('widget_delivery_status', null),
        HomeWidget.saveWidgetData<String>('widget_order_type', null),
        HomeWidget.saveWidgetData<String>('widget_order_eta', null),
      ]);
      await _reload();
    } catch (_) {}
  }

  static Future<void> updateFromPush(Map<String, dynamic> data) async {
    if (!_supported) return;
    final type = data['type']?.toString();
    if (!const {'bonus', 'order', 'delivery', 'refund'}.contains(type)) return;
    try {
      await initialize();
      final writes = <Future<bool?>>[
        HomeWidget.saveWidgetData<bool>('widget_is_signed_in', true),
      ];
      final balance = double.tryParse(data['balance']?.toString() ?? '');
      if (balance != null) {
        writes.add(
          HomeWidget.saveWidgetData<double>('widget_balance', balance),
        );
      }

      final status = data['orderStatus']?.toString();
      final closed = const {
        'completed',
        'delivered',
        'cancelled',
        'canceled',
        'refunded',
      }.contains(status);
      final orderId = data['orderId']?.toString();
      final orderNumber = int.tryParse(data['orderNumber']?.toString() ?? '');
      if (closed) {
        writes.addAll([
          HomeWidget.saveWidgetData<String>('widget_order_id', null),
          HomeWidget.saveWidgetData<int>('widget_order_number', null),
          HomeWidget.saveWidgetData<String>('widget_order_status', null),
          HomeWidget.saveWidgetData<String>('widget_delivery_status', null),
          HomeWidget.saveWidgetData<String>('widget_order_type', null),
          HomeWidget.saveWidgetData<String>('widget_order_eta', null),
        ]);
      } else if (orderId != null && orderId.isNotEmpty && orderNumber != null) {
        writes.addAll([
          HomeWidget.saveWidgetData<String>('widget_order_id', orderId),
          HomeWidget.saveWidgetData<int>('widget_order_number', orderNumber),
          if (status != null && status.isNotEmpty)
            HomeWidget.saveWidgetData<String>('widget_order_status', status),
          if ((data['deliveryStatus']?.toString() ?? '').isNotEmpty)
            HomeWidget.saveWidgetData<String>(
              'widget_delivery_status',
              data['deliveryStatus'].toString(),
            ),
          if ((data['fulfillmentType']?.toString() ?? '').isNotEmpty)
            HomeWidget.saveWidgetData<String>(
              'widget_order_type',
              data['fulfillmentType'].toString(),
            ),
          if ((data['orderEta']?.toString() ?? '').isNotEmpty)
            HomeWidget.saveWidgetData<String>(
              'widget_order_eta',
              data['orderEta'].toString(),
            ),
        ]);
      }
      await Future.wait(writes);
      await _reload();
    } catch (_) {
      // Background delivery is best-effort. The foreground refresh remains
      // the source of truth when the operating system suppresses background
      // execution.
    }
  }

  static Future<void> _reload() => HomeWidget.updateWidget(
    androidName: androidProvider,
    iOSName: iOSWidgetKind,
  );
}
