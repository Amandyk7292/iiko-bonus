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
    'expired pickup cannot restart an activity after app restoration',
    () async {
      final json = order('paid').toJson()
        ..['orderStatus'] = 'ready'
        ..['liveActivityExpiresAt'] = DateTime.now()
            .subtract(const Duration(seconds: 1))
            .toIso8601String();
      final restored = CustomerOrder.fromJson(
        CustomerOrder.fromJson(json).toJson(),
      );
      await OrderLiveStatus.sync(restored);
      expect(calls.single.method, 'clearOrderStatus');
      expect(calls.single.arguments['dismissImmediately'], true);
      calls.clear();
      await OrderLiveStatus.sync(
        CustomerOrder.fromJson({
          ...json,
          'fulfillmentType': 'delivery',
          'effectiveFulfillmentType': 'delivery',
        }),
      );
      expect(calls.single.method, 'updateOrderStatus');
    },
  );
  testWidgets('open app dismisses ready activity when its deadline arrives', (
    tester,
  ) async {
    final ready = CustomerOrder.fromJson(
      order('paid').toJson()
        ..['orderStatus'] = 'ready'
        ..['liveActivityExpiresAt'] = DateTime.now()
            .add(const Duration(seconds: 2))
            .toIso8601String(),
    );
    await OrderLiveStatus.sync(ready);
    expect(calls.single.method, 'updateOrderStatus');
    await tester.pump(const Duration(seconds: 3));
    expect(calls.last.method, 'clearOrderStatus');
    expect(calls.last.arguments['dismissImmediately'], true);
  });
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
  test(
    'retries unchanged content when iOS could not start the activity',
    () async {
      var available = false;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
            return available;
          });
      await OrderLiveStatus.sync(order('paid'));
      available = true;
      await OrderLiveStatus.sync(order('paid'));
      await OrderLiveStatus.sync(order('paid'));
      expect(calls, hasLength(2));
    },
  );

  test(
    'retains activity token through login and temporary network failure',
    () async {
      final api = _ActivityApi();
      OrderLiveStatus.attach(api);
      addTearDown(() async {
        await OrderLiveStatus.clear();
        api.dispose();
        channel.setMethodCallHandler(null);
      });
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(
            channel.name,
            const StandardMethodCodec().encodeMethodCall(
              const MethodCall('liveActivityToken', {
                'activityId': 'activity',
                'orderId': 'order-test',
                'pushToken': 'token',
                'environment': 'sandbox',
              }),
            ),
            null,
          );
      expect(api.attempts, 0);
      api.authenticated = true;
      await OrderLiveStatus.sync(order('paid'));
      await Future<void>.delayed(Duration.zero);
      expect(api.attempts, 1);
      api.offline = false;
      await OrderLiveStatus.sync(order('paid'));
      await Future<void>.delayed(Duration.zero);
      expect(api.attempts, 2);
      expect(api.environment, 'sandbox');
      await OrderLiveStatus.sync(order('paid'));
      await Future<void>.delayed(Duration.zero);
      expect(api.attempts, 2);
    },
  );
}

class _ActivityApi extends BulkaApiClient {
  bool authenticated = false;
  bool offline = true;
  int attempts = 0;
  String? environment;
  @override
  bool get isAuthenticated => authenticated;
  @override
  Future<void> registerLiveActivity({
    required String pushToken,
    required String activityId,
    required String installationId,
    required String orderId,
    required String environment,
  }) async {
    attempts++;
    if (offline) throw ApiException('offline');
    this.environment = environment;
  }

  @override
  Future<void> deactivateLiveActivity({
    String? activityId,
    String? orderId,
  }) async {}
}
