import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

String _cacheKey(String account) =>
    customerPreferenceKey('notification_preferences_cache_v2', account);

class _PreferencesApi extends BulkaApiClient {
  _PreferencesApi(this.scope);

  String? scope;
  int loadCount = 0;
  NotificationPreferences remote = const NotificationPreferences();
  Completer<NotificationPreferences>? pendingLoad;
  Completer<NotificationPreferences>? pendingSave;

  @override
  bool get isAuthenticated => true;
  @override
  String? get sessionCacheScope => scope;
  @override
  Future<NotificationPreferences> getNotificationPreferences() async {
    loadCount++;
    return pendingLoad == null ? remote : await pendingLoad!.future;
  }

  @override
  Future<NotificationPreferences> updateNotificationPreferences(
    NotificationPreferences preferences,
  ) async => pendingSave == null ? preferences : await pendingSave!.future;
  @override
  Future<void> deactivateLiveActivity({
    String? activityId,
    String? orderId,
  }) async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.bulka.bonus/order_status');
  final calls = <MethodCall>[];

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return true;
        });
    await OrderLiveStatus.clear();
    calls.clear();
  });

  tearDown(() async {
    await OrderLiveStatus.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  CustomerOrder order() => CustomerOrder.fromJson({
    'id': 'paid-order',
    'number': 100000,
    'paymentStatus': 'paid',
    'orderStatus': 'preparing',
    'fulfillmentType': 'pickup',
  });

  test(
    'another account and legacy preferences cannot suppress live orders',
    () async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'notification_preferences_cache_v1',
        jsonEncode({'ordersEnabled': false}),
      );
      await prefs.setString(
        _cacheKey('customer-a'),
        jsonEncode({'ordersEnabled': false}),
      );
      final api = _PreferencesApi('customer-b');
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);

      await OrderLiveStatus.sync(order());

      expect(calls.single.method, 'updateOrderStatus');
    },
  );

  test('the current account disabled preference is still respected', () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _cacheKey('customer-a'),
      jsonEncode({'ordersEnabled': false}),
    );
    final api = _PreferencesApi('customer-a');
    addTearDown(api.dispose);
    OrderLiveStatus.attach(api);

    await OrderLiveStatus.sync(order());

    expect(calls.single.method, 'clearOrderStatus');
  });

  test(
    'relogin hydrates the current account opt-out before live status',
    () async {
      final prefs = await SharedPreferences.getInstance();
      final api = _PreferencesApi('customer-a')
        ..remote = const NotificationPreferences(ordersEnabled: false);
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);

      await OrderLiveStatus.sync(order());
      await OrderLiveStatus.sync(order());

      expect(api.loadCount, 1);
      expect(calls.every((call) => call.method == 'clearOrderStatus'), true);
      expect(
        jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
        false,
      );
    },
  );

  test('concurrent cache misses share one preference request', () async {
    final api = _PreferencesApi('customer-a')
      ..pendingLoad = Completer<NotificationPreferences>();
    addTearDown(api.dispose);
    OrderLiveStatus.attach(api);
    final first = OrderLiveStatus.sync(order());
    final second = OrderLiveStatus.sync(order());
    await Future<void>.delayed(Duration.zero);
    expect(api.loadCount, 1);
    api.pendingLoad!.complete(const NotificationPreferences());
    await Future.wait([first, second]);
    expect(calls.any((call) => call.method == 'updateOrderStatus'), true);
  });

  for (final ending in ['completed', 'no active order', 'direct clear']) {
    test(
      'delayed preference load cannot reopen activity after $ending',
      () async {
        final api = _PreferencesApi('customer-a')
          ..pendingLoad = Completer<NotificationPreferences>();
        addTearDown(api.dispose);
        OrderLiveStatus.attach(api);
        final syncing = OrderLiveStatus.sync(order());
        await Future<void>.delayed(Duration.zero);
        expect(api.loadCount, 1);
        if (ending == 'direct clear') {
          await OrderLiveStatus.clear();
        } else {
          await OrderLiveStatus.sync(
            ending == 'completed'
                ? CustomerOrder.fromJson({
                    ...order().toJson(),
                    'orderStatus': 'completed',
                  })
                : null,
          );
        }
        expect(calls.single.method, 'clearOrderStatus');
        api.pendingLoad!.complete(const NotificationPreferences());
        await syncing;

        expect(calls, hasLength(1));
        expect(
          calls.where((call) => call.method == 'updateOrderStatus'),
          isEmpty,
        );
      },
    );
  }

  test(
    'logout during hydration cannot restore cache or update live status',
    () async {
      final prefs = await SharedPreferences.getInstance();
      final api = _PreferencesApi('customer-a')
        ..pendingLoad = Completer<NotificationPreferences>();
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);
      final syncing = OrderLiveStatus.sync(order());
      await Future<void>.delayed(Duration.zero);
      expect(api.loadCount, 1);
      api.scope = null;
      await SessionStore.clearCustomerData(prefs);
      api.pendingLoad!.complete(const NotificationPreferences());
      await syncing;

      expect(calls, isEmpty);
      expect(prefs.containsKey(_cacheKey('customer-a')), false);
    },
  );

  test(
    'failed hydration hides live status and retries without caching opt-out',
    () async {
      final prefs = await SharedPreferences.getInstance();
      final api = _PreferencesApi('customer-a')
        ..pendingLoad = Completer<NotificationPreferences>();
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);
      final syncing = OrderLiveStatus.sync(order());
      await Future<void>.delayed(Duration.zero);
      api.pendingLoad!.completeError(ApiException('offline'));
      await syncing;
      expect(calls.single.method, 'clearOrderStatus');
      expect(prefs.containsKey(_cacheKey('customer-a')), false);

      api.pendingLoad = null;
      await OrderLiveStatus.sync(order());
      expect(api.loadCount, 2);
      expect(calls.last.method, 'updateOrderStatus');
      expect(
        jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
        true,
      );
    },
  );

  test('logout removes legacy and all customer notification caches', () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('notification_preferences_cache_v1', '{}');
    await prefs.setString(_cacheKey('customer-a'), '{}');
    await prefs.setString(_cacheKey('customer-b'), '{}');
    await prefs.setString('app_language', 'kk');

    await SessionStore.clearCustomerData(prefs);

    expect(prefs.containsKey('notification_preferences_cache_v1'), isFalse);
    expect(prefs.containsKey(_cacheKey('customer-a')), isFalse);
    expect(prefs.containsKey(_cacheKey('customer-b')), isFalse);
    expect(prefs.getString('app_language'), 'kk');
  });

  testWidgets('settings save only into their customer cache', (tester) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _cacheKey('customer-a'),
      jsonEncode({'ordersEnabled': true}),
    );
    final api = _PreferencesApi('customer-b');
    addTearDown(api.dispose);
    OrderLiveStatus.attach(api);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: NotificationSettingsScreen(api: api),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(SwitchListTile).first);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Сохранить'), 300);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Сохранить'));
    await tester.pump();
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();

    expect(
      jsonDecode(prefs.getString(_cacheKey('customer-b'))!)['ordersEnabled'],
      false,
    );
    expect(
      jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
      true,
    );
    expect(prefs.containsKey('notification_preferences_cache_v1'), false);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'late initial GET cannot overwrite preferences already edited and saved',
    (tester) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _cacheKey('customer-a'),
        jsonEncode({'ordersEnabled': true}),
      );
      final api = _PreferencesApi('customer-a')
        ..pendingLoad = Completer<NotificationPreferences>();
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: NotificationSettingsScreen(api: api),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(SwitchListTile).first);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Сохранить'), 300);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Сохранить'));
      await tester.pump();
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      api.pendingLoad!.complete(const NotificationPreferences());
      await tester.pumpAndSettle();

      expect(
        jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
        false,
      );
      await tester.scrollUntilVisible(find.byType(SwitchListTile).first, -300);
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile).first).value,
        false,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'live status hydration cannot overwrite a completed settings save',
    (tester) async {
      final prefs = await SharedPreferences.getInstance();
      final api = _PreferencesApi('customer-a')
        ..pendingLoad = Completer<NotificationPreferences>();
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);
      final syncing = OrderLiveStatus.sync(order());
      await tester.runAsync(() async {
        await Future<void>.delayed(Duration.zero);
      });
      expect(api.loadCount, 1);
      await prefs.setString(
        _cacheKey('customer-a'),
        jsonEncode(const NotificationPreferences().toJson()),
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: NotificationSettingsScreen(api: api),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(SwitchListTile).first);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Сохранить'), 300);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Сохранить'));
      await tester.pump();
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      expect(
        jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
        false,
      );
      api.pendingLoad!.complete(const NotificationPreferences());
      await tester.pumpAndSettle();
      await syncing;

      expect(
        jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
        false,
      );
      expect(
        calls.where((call) => call.method == 'updateOrderStatus'),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a save finishing after an account switch cannot cache old preferences',
    (tester) async {
      final prefs = await SharedPreferences.getInstance();
      final api = _PreferencesApi('customer-a')
        ..pendingSave = Completer<NotificationPreferences>();
      addTearDown(api.dispose);
      OrderLiveStatus.attach(api);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: NotificationSettingsScreen(api: api),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(SwitchListTile).first);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Сохранить'), 300);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Сохранить'));
      await tester.pump();
      api.scope = 'customer-b';
      api.pendingSave!.complete(
        const NotificationPreferences(ordersEnabled: false),
      );
      await tester.pump();

      expect(
        jsonDecode(prefs.getString(_cacheKey('customer-a'))!)['ordersEnabled'],
        true,
      );
      expect(prefs.containsKey(_cacheKey('customer-b')), false);
      expect(calls.where((call) => call.method == 'clearOrderStatus'), isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}
