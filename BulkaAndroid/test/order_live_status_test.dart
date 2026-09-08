import 'package:bulka_bonus/main.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.bulka.bonus/order_status');
  final calls = <MethodCall>[];
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return null;
        });
    await OrderLiveStatus.clear();
    calls.clear();
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );
  CustomerOrder order(String payment) => CustomerOrder.fromJson({
    'id': 'order-test',
    'number': 100012,
    'paymentStatus': payment,
    'orderStatus': 'new',
    'fulfillmentType': 'pickup',
    'deliveryStatus': 'unassigned',
  });
  for (final payment in ['pending', 'failed', 'cancelled', 'refunded']) {
    test('no Live Activity before confirmed payment: $payment', () async {
      await OrderLiveStatus.sync(order(payment));
      expect(
        calls.where((call) => call.method == 'updateOrderStatus'),
        isEmpty,
      );
      expect(calls.single.method, 'clearOrderStatus');
      expect(calls.single.arguments['dismissImmediately'], true);
    });
  }
  test(
    'paid order starts once and payment reversal immediately clears it',
    () async {
      await OrderLiveStatus.sync(order('paid'));
      await OrderLiveStatus.sync(order('paid'));
      expect(calls, hasLength(1));
      expect(calls.single.method, 'updateOrderStatus');
      expect(calls.single.arguments['paymentStatus'], 'paid');
      expect(calls.single.arguments['orderStatus'], 'new');
      await OrderLiveStatus.sync(order('refunded'));
      expect(calls.last.method, 'clearOrderStatus');
      expect(calls.last.arguments['dismissImmediately'], true);
    },
  );
}
