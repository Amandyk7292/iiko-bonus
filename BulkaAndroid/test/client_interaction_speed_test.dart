import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:provider/provider.dart';

import 'order_history_refresh_test.dart' show orderFixture;
import 'cashier_workspace_test.dart' show BadgeFixtureApi;
import 'cashier_reports_test.dart' show ReportApi;

class _PendingHistoryApi extends BulkaApiClient {
  final active = Completer<List<CustomerOrder>>();
  final completed = Completer<List<CustomerOrder>>();
  final detail = Completer<CustomerOrder>();
  Completer<List<CustomerOrder>>? nextActive, nextCompleted;
  final changes = StreamController<Map<String, dynamic>>.broadcast();
  int listReads = 0, detailReads = 0;

  @override
  Stream<Map<String, dynamic>> get customerEvents => changes.stream;

  @override
  Future<List<CustomerOrder>> getCustomerOrders({bool completed = false}) {
    listReads++;
    return completed
        ? (nextCompleted ?? this.completed).future
        : (nextActive ?? active).future;
  }

  @override
  Future<CustomerOrder> getCustomerOrder(String id) {
    detailReads++;
    return detail.future;
  }
}

class _AddressReadApi extends _PendingHistoryApi {
  int addressReads = 0;
  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async {
    addressReads++;
    return [];
  }
}

Future<void> _frames(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 16));
  }
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
  });

  testWidgets(
    'saved history renders before the network and detail checks freshness',
    (tester) async {
      final cached = orderFixture(
        id: 'cached-order',
        number: 41,
        createdAt: DateTime.utc(2026),
        status: 'new',
      );
      final api = _PendingHistoryApi();
      api.setSession(accessToken: 'fixture-token', cacheScope: 'test-account');
      addTearDown(api.dispose);
      addTearDown(api.changes.close);
      SharedPreferences.setMockInitialValues({
        'customer_orders_cache_test-account_all': jsonEncode({
          'orders': [cached.toJson()],
        }),
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CustomerOrdersScreen(api: api, cacheScope: 'test-account'),
        ),
      );
      await _frames(tester);

      expect(api.listReads, 2);
      expect(
        find.byKey(const ValueKey('customer-order-cached-order')),
        findsOneWidget,
      );
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.textContaining('Нет соединения'), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('customer-order-number-cached-order')),
      );
      await _frames(tester);
      expect(find.byType(OrderDetailsScreen), findsOneWidget);
      expect(api.detailReads, 1);
      await tester.scrollUntilVisible(
        find.text('Отменить заказ'),
        200,
        scrollable: find
            .descendant(
              of: find.byType(OrderDetailsScreen),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      final cancel = find.ancestor(
        of: find.text('Отменить заказ'),
        matching: find.byWidgetPredicate((widget) => widget is OutlinedButton),
      );
      expect(cancel, findsOneWidget);
      expect(tester.widget<OutlinedButton>(cancel).onPressed, isNull);

      api.detail.complete(cached);
      await _frames(tester);
      expect(tester.widget<OutlinedButton>(cancel).onPressed, isNotNull);
      api.active.complete([cached]);
      api.completed.complete([]);
      await _frames(tester);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('manual refresh keeps current orders visible', (tester) async {
    final api = _PendingHistoryApi();
    addTearDown(api.dispose);
    addTearDown(api.changes.close);
    final order = orderFixture(
      id: 'fresh',
      number: 42,
      createdAt: DateTime.utc(2026),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: CustomerOrdersScreen(api: api),
      ),
    );
    api.active.complete([]);
    api.completed.complete([order]);
    await _frames(tester);
    api.nextActive = Completer<List<CustomerOrder>>();
    api.nextCompleted = Completer<List<CustomerOrder>>();
    final refresh = tester.widget<RefreshIndicator>(
      find.byType(RefreshIndicator),
    );
    final pending = refresh.onRefresh();
    await tester.pump();
    expect(find.byKey(const ValueKey('customer-order-fresh')), findsOneWidget);
    api.nextActive!.complete([]);
    api.nextCompleted!.complete([order]);
    await pending;
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('fresh first pages discard orders known only from cache', (
    tester,
  ) async {
    final api = _PendingHistoryApi()
      ..setSession(accessToken: 'fixture-token', cacheScope: 'page-account');
    addTearDown(api.dispose);
    addTearDown(api.changes.close);
    final cachedOnly = orderFixture(
      id: 'cache-only-order',
      number: 49,
      createdAt: DateTime.utc(2025),
      status: 'new',
    );
    final fresh = orderFixture(
      id: 'first-page-order',
      number: 50,
      createdAt: DateTime.utc(2026),
      status: 'new',
    );
    SharedPreferences.setMockInitialValues({
      'customer_orders_cache_page-account_all': jsonEncode({
        'orders': [cachedOnly.toJson()],
      }),
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: CustomerOrdersScreen(api: api),
      ),
    );
    await _frames(tester);
    expect(
      find.byKey(const ValueKey('customer-order-cache-only-order')),
      findsOneWidget,
    );
    api.active.complete([fresh]);
    api.completed.complete([]);
    await _frames(tester);
    expect(
      find.byKey(const ValueKey('customer-order-cache-only-order')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('customer-order-first-page-order')),
      findsOneWidget,
    );
    final prefs = await SharedPreferences.getInstance();
    final saved =
        jsonDecode(prefs.getString('customer_orders_cache_page-account_all')!)
            as Map<String, dynamic>;
    expect((saved['orders'] as List).map((order) => order['id']), [
      'first-page-order',
    ]);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'cached notification order opens while list requests are pending',
    (tester) async {
      final api = _PendingHistoryApi()
        ..setSession(
          accessToken: 'fixture-token',
          cacheScope: 'notification-account',
        );
      addTearDown(api.dispose);
      addTearDown(api.changes.close);
      final order = orderFixture(
        id: 'notification-order',
        number: 45,
        createdAt: DateTime.utc(2026),
        status: 'new',
      );
      SharedPreferences.setMockInitialValues({
        'customer_orders_cache_notification-account_all': jsonEncode({
          'orders': [order.toJson()],
        }),
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CustomerOrdersScreen(
            api: api,
            initialOrderId: 'notification-order',
          ),
        ),
      );
      await _frames(tester);
      expect(find.byType(OrderDetailsScreen), findsOneWidget);
      expect(api.listReads, 2);
      expect(api.detailReads, 1);
      api.detail.complete(order);
      api.active.complete([order]);
      api.completed.complete([]);
      await _frames(tester);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'cached notification retains freshness guard across the next frame',
    (tester) async {
      final api = _PendingHistoryApi()
        ..setSession(accessToken: 'fixture-token', cacheScope: 'frame-account');
      addTearDown(api.dispose);
      addTearDown(api.changes.close);
      final cached = orderFixture(
        id: 'frame-order',
        number: 51,
        createdAt: DateTime.utc(2026),
        status: 'new',
      );
      final fresh = orderFixture(
        id: cached.id,
        number: cached.number,
        createdAt: cached.createdAt,
        status: 'cancelled',
      );
      SharedPreferences.setMockInitialValues({
        'customer_orders_cache_frame-account_all': jsonEncode({
          'orders': [cached.toJson()],
        }),
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CustomerOrdersScreen(api: api, initialOrderId: cached.id),
        ),
      );
      await tester.idle();
      expect(api.detailReads, 0);
      api.active.complete([]);
      api.completed.complete([fresh]);
      await tester.idle();
      await _frames(tester);
      expect(find.byType(OrderDetailsScreen), findsOneWidget);
      expect(api.detailReads, 1);
      expect(
        tester
            .widget<OrderDetailsScreen>(find.byType(OrderDetailsScreen))
            .refreshOnOpen,
        isTrue,
      );
      api.detail.complete(fresh);
      await _frames(tester);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'cached delivery decision does not consume a resolved order notification',
    (tester) async {
      final api = _PendingHistoryApi()
        ..setSession(
          accessToken: 'fixture-token',
          cacheScope: 'decision-account',
        );
      addTearDown(api.dispose);
      addTearDown(api.changes.close);
      final fresh = orderFixture(
        id: 'resolved-order',
        number: 46,
        createdAt: DateTime.utc(2026),
        status: 'new',
      );
      final cached = CustomerOrder.fromJson({
        ...fresh.toJson(),
        'deliveryResolution': {'status': 'pending'},
      });
      expect(cached.needsDeliveryDecision, isTrue);
      SharedPreferences.setMockInitialValues({
        'customer_orders_cache_decision-account_all': jsonEncode({
          'orders': [cached.toJson()],
        }),
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CustomerOrdersScreen(
            api: api,
            initialOrderId: 'resolved-order',
          ),
        ),
      );
      await _frames(tester);
      expect(find.byType(OrderDetailsScreen), findsNothing);
      api.active.complete([fresh]);
      api.completed.complete([]);
      await _frames(tester);
      expect(find.byType(OrderDetailsScreen), findsOneWidget);
      expect(api.detailReads, 0);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('delivery cart loads its address once per visible visit', (
    tester,
  ) async {
    final api = _AddressReadApi()
      ..setSession(accessToken: 'fixture-token', cacheScope: 'cart-account');
    addTearDown(api.dispose);
    addTearDown(api.changes.close);
    final cart = CartProvider();
    await cart.restored;
    cart.addItem(productId: 'bun', name: 'Булочка', price: 300, imageUrl: '');
    Widget app(bool visible) => ChangeNotifierProvider.value(
      value: cart,
      child: MaterialApp(
        theme: buildBulkaTheme(),
        home: TickerMode(
          enabled: visible,
          child: OrdersScreen(api: api, customer: null, orderType: 'delivery'),
        ),
      ),
    );
    await tester.pumpWidget(app(true));
    await _frames(tester);
    expect(api.addressReads, 1);
    await tester.pumpWidget(app(false));
    await _frames(tester);
    expect(api.addressReads, 1);
    await tester.pumpWidget(app(true));
    await _frames(tester);
    expect(api.addressReads, 2);
    await tester.pumpWidget(const SizedBox());
    await cart.persisted;
    cart.dispose();
  });

  testWidgets(
    'failed freshness check keeps cached order cancellation disabled',
    (tester) async {
      final api = _PendingHistoryApi();
      addTearDown(api.dispose);
      addTearDown(api.changes.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: OrderDetailsScreen(
            api: api,
            initialOrder: orderFixture(
              id: 'stale',
              number: 43,
              createdAt: DateTime.utc(2026),
              status: 'new',
            ),
            refreshOnOpen: true,
            onRepeat: (_) async {},
            onOrderChanged: (_) {},
          ),
        ),
      );
      await _frames(tester);
      api.detail.completeError(ApiException('Network unavailable'));
      await _frames(tester);
      await tester.scrollUntilVisible(find.text('Отменить заказ'), 200);
      final cancel = find.ancestor(
        of: find.text('Отменить заказ'),
        matching: find.byWidgetPredicate((widget) => widget is OutlinedButton),
      );
      expect(tester.widget<OutlinedButton>(cancel).onPressed, isNull);
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'account change clears old cached history and ignores its pending response',
    (tester) async {
      final first = _PendingHistoryApi()
        ..setSession(accessToken: 'fixture-a', cacheScope: 'account-a');
      final second = _PendingHistoryApi()
        ..setSession(accessToken: 'fixture-b', cacheScope: 'account-b');
      addTearDown(first.dispose);
      addTearDown(first.changes.close);
      addTearDown(second.dispose);
      addTearDown(second.changes.close);
      final old = orderFixture(
        id: 'account-a-order',
        number: 44,
        createdAt: DateTime.utc(2026),
      );
      SharedPreferences.setMockInitialValues({
        'customer_orders_cache_account-a_all': jsonEncode({
          'orders': [old.toJson()],
        }),
      });
      Widget app(BulkaApiClient api) => MaterialApp(
        theme: buildBulkaTheme(),
        home: CustomerOrdersScreen(api: api),
      );
      await tester.pumpWidget(app(first));
      await _frames(tester);
      expect(
        find.byKey(const ValueKey('customer-order-account-a-order')),
        findsOneWidget,
      );
      await tester.pumpWidget(app(second));
      await _frames(tester);
      expect(
        find.byKey(const ValueKey('customer-order-account-a-order')),
        findsNothing,
      );
      first.active.complete([]);
      first.completed.complete([old]);
      await _frames(tester);
      expect(
        find.byKey(const ValueKey('customer-order-account-a-order')),
        findsNothing,
      );
      second.active.complete([]);
      second.completed.complete([]);
      await _frames(tester);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getString('customer_orders_cache_account-b_all'),
        isNot(contains('account-a-order')),
      );
      final guest = _PendingHistoryApi();
      addTearDown(guest.dispose);
      addTearDown(guest.changes.close);
      guest.active.complete([]);
      guest.completed.complete([]);
      await tester.pumpWidget(app(guest));
      await _frames(tester);
      expect(
        find.byKey(const ValueKey('customer-order-account-a-order')),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'hidden cashier reports retain selections without background requests',
    (tester) async {
      final api = ReportApi()..branchId = 'assigned';
      addTearDown(api.close);
      Widget app(bool visible) => MaterialApp(
        theme: buildBulkaTheme(),
        home: TickerMode(
          enabled: visible,
          child: CashierReports(api: api),
        ),
      );
      await tester.pumpWidget(app(true));
      await _frames(tester);
      final initialReads = api.requests.length;
      expect(initialReads, 2);
      await tester.pumpWidget(app(false));
      api.changes.add({'type': 'inventory.updated'});
      await tester.pump(const Duration(seconds: 60));
      await _frames(tester);
      expect(api.requests, hasLength(initialReads));
      await tester.pumpWidget(app(true));
      await _frames(tester);
      expect(api.requests, hasLength(initialReads + 2));
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('hidden order history does not poll and refreshes on return', (
    tester,
  ) async {
    final api = _PendingHistoryApi();
    addTearDown(api.dispose);
    addTearDown(api.changes.close);
    api.active.complete([]);
    api.completed.complete([]);
    Widget app(bool visible) => MaterialApp(
      theme: buildBulkaTheme(),
      home: TickerMode(
        enabled: visible,
        child: CustomerOrdersScreen(api: api),
      ),
    );
    await tester.pumpWidget(app(true));
    await _frames(tester);
    expect(api.listReads, 2);
    await tester.pumpWidget(app(false));
    api.changes.add({'type': 'order.updated'});
    await tester.pump(const Duration(seconds: 60));
    await _frames(tester);
    expect(api.listReads, 2);
    await tester.pumpWidget(app(true));
    await _frames(tester);
    expect(api.listReads, 4);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'cashier hidden tabs pause reads while kitchen counters remain live',
    (tester) async {
      final api = BadgeFixtureApi();
      addTearDown(api.close);
      addTearDown(api.feed.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CashierWorkspace(
            api: api,
            user: const {'role': 'cashier'},
            nativePushEnabled: false,
            onLogout: () async {},
          ),
        ),
      );
      await _frames(tester);
      int reads(String endpoint) =>
          api.requests.where((p) => p.startsWith('GET $endpoint')).length;
      final initialCatalog = reads('/staff/catalog');
      final initialOrders = reads('/orders?');
      final initialKitchen = reads('/kitchen');
      api.counters = {'newOrders': 9, 'preparing': 3, 'preorders': 2};
      api.feed.add({'type': 'inventory.updated', 'id': 'inventory'});
      api.feed.add({'type': 'order.updated', 'id': 'new'});
      await tester.pump(const Duration(seconds: 30));
      await _frames(tester);
      expect(reads('/staff/catalog'), initialCatalog);
      expect(reads('/orders?'), greaterThan(initialOrders));
      expect(reads('/kitchen'), greaterThan(initialKitchen));
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('cashier-orders-count')),
          matching: find.text('9'),
        ),
        findsOneWidget,
      );

      final nav = find.byType(NavigationBar);
      await tester.tap(
        find.descendant(of: nav, matching: find.text('Стоп-лист')),
      );
      await _frames(tester);
      expect(reads('/staff/catalog'), greaterThan(initialCatalog));
      final hiddenOrders = reads('/orders?');
      await tester.pump(const Duration(seconds: 30));
      await _frames(tester);
      expect(reads('/orders?'), hiddenOrders);
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    },
  );
}
