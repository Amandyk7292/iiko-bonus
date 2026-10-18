import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('home_widget');
  late Map<String, dynamic> data;

  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    data = {
      'widget_is_signed_in': true,
      'widget_order_id': 'active-b',
      'widget_order_number': 222,
      'widget_order_status': 'preparing',
      'widget_delivery_status': 'unassigned',
      'widget_order_type': 'pickup',
      'widget_order_eta': '2026-10-18T12:00:00.000Z',
    };
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'saveWidgetData') {
            data[call.arguments['id']] = call.arguments['data'];
          }
          if (call.method == 'getWidgetData') {
            return data[call.arguments['id']];
          }
          return true;
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  for (final status in [
    'completed',
    'delivered',
    'cancelled',
    'canceled',
    'refunded',
  ]) {
    test(
      '$status for an older order preserves the active widget order',
      () async {
        final before = Map<String, dynamic>.of(data);

        await HomeWidgetSync.updateFromPush({
          'type': 'order',
          'orderId': 'closed-a',
          'orderNumber': '111',
          'orderStatus': status,
          'balance': '123',
        });

        for (final entry in before.entries) {
          expect(data[entry.key], entry.value, reason: entry.key);
        }
        expect(data['widget_balance'], 123);
      },
    );
  }

  test('closing the displayed order clears all its native fields', () async {
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'active-b',
      'orderStatus': 'completed',
    });

    for (final key in data.keys.where(
      (key) => key.startsWith('widget_order_'),
    )) {
      expect(data[key], isNull, reason: key);
    }
    expect(data['widget_delivery_status'], isNull);
    expect(data['widget_is_signed_in'], true);
  });

  test(
    'closed push without an order ID cannot erase a displayed order',
    () async {
      await HomeWidgetSync.updateFromPush({
        'type': 'order',
        'orderStatus': 'completed',
      });

      expect(data['widget_order_id'], 'active-b');
      expect(data['widget_order_number'], 222);
    },
  );

  test(
    'foreground update cannot interleave a closing push identity check',
    () async {
      data['widget_order_id'] = 'closed-a';
      data['widget_order_number'] = 111;
      final readingOrder = Completer<void>();
      final releaseRead = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getWidgetData' &&
                call.arguments['id'] == 'widget_order_id') {
              final value = data['widget_order_id'];
              readingOrder.complete();
              await releaseRead.future;
              return value;
            }
            if (call.method == 'saveWidgetData') {
              data[call.arguments['id']] = call.arguments['data'];
            }
            return true;
          });

      final closing = HomeWidgetSync.updateFromPush({
        'type': 'order',
        'orderId': 'closed-a',
        'orderStatus': 'completed',
      });
      await readingOrder.future;
      final updating = HomeWidgetSync.update(
        customer: Customer.fromJson({'id': 'customer', 'balance': 500}),
        activeOrder: CustomerOrder.fromJson({
          'id': 'active-b',
          'number': 222,
          'paymentStatus': 'paid',
          'orderStatus': 'preparing',
          'fulfillmentType': 'pickup',
        }),
      );
      await Future<void>.delayed(Duration.zero);
      expect(data['widget_order_id'], 'closed-a');
      releaseRead.complete();
      await Future.wait([closing, updating]);

      expect(data['widget_order_id'], 'active-b');
      expect(data['widget_order_number'], 222);
      expect(data['widget_order_status'], 'preparing');
      expect(data['widget_balance'], 500);
    },
  );

  test('a delayed older ready push cannot reopen a completed order', () async {
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'active-b',
      'orderNumber': '222',
      'orderStatus': 'completed',
      'orderUpdatedAt': '2026-10-18T10:01:00.123456Z',
      'balance': '500',
    });
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'active-b',
      'orderNumber': '222',
      'orderStatus': 'ready',
      'orderUpdatedAt': '2026-10-18T15:01:00.123455+05:00',
      'balance': '100',
    });

    expect(data['widget_order_id'], isNull);
    expect(data['widget_balance'], 500);
  });

  test('watermarks are per order and accept newer states', () async {
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'closed-a',
      'orderStatus': 'completed',
      'orderUpdatedAt': '2026-10-18T10:01:00Z',
    });
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'active-b',
      'orderNumber': '222',
      'orderStatus': 'ready',
      'orderUpdatedAt': '2026-10-18T10:00:00Z',
    });
    expect(data['widget_order_status'], 'ready');
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'active-b',
      'orderStatus': 'completed',
      'orderUpdatedAt': '2026-10-18T10:02:00Z',
    });
    expect(data['widget_order_id'], isNull);
  });

  test('duplicate version cannot replace a completed state', () async {
    for (final status in ['completed', 'ready']) {
      await HomeWidgetSync.updateFromPush({
        'type': 'order',
        'orderId': 'active-b',
        'orderNumber': '222',
        'orderStatus': status,
        'orderUpdatedAt': '2026-10-18T10:01:00Z',
      });
    }
    expect(data['widget_order_id'], isNull);
  });

  test('legacy pushes without a valid timestamp remain compatible', () async {
    for (final timestamp in [null, '', 'invalid']) {
      await HomeWidgetSync.updateFromPush({
        'type': 'order',
        'orderId': 'active-b',
        'orderStatus': 'completed',
        'orderUpdatedAt': '2026-10-18T10:01:00Z',
      });
      await HomeWidgetSync.updateFromPush({
        'type': 'order',
        'orderId': 'active-b',
        'orderNumber': '222',
        'orderStatus': 'ready',
        'orderUpdatedAt': timestamp,
      });
      expect(data['widget_order_id'], 'active-b');
      expect(data['widget_order_status'], 'ready');
    }
  });

  test('the watermark cache stays bounded and is cleared on logout', () async {
    data['widget_order_versions_v1'] = jsonEncode({
      for (var i = 0; i < 64; i++) 'older-$i': i,
    });
    await HomeWidgetSync.updateFromPush({
      'type': 'order',
      'orderId': 'active-b',
      'orderNumber': '222',
      'orderStatus': 'ready',
      'orderUpdatedAt': '2026-10-18T10:01:00Z',
    });
    final versions =
        jsonDecode(data['widget_order_versions_v1'] as String) as Map;
    expect(versions.length, 64);
    expect(versions.containsKey('older-0'), false);
    expect(versions.containsKey('active-b'), true);
    await HomeWidgetSync.clear();
    expect(data['widget_order_versions_v1'], isNull);
  });
}
