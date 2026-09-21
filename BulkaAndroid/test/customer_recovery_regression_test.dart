import 'dart:convert';
import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const product = CatalogProduct(
  id: 'configured',
  title: 'Configured product',
  price: 300,
  category: 'Cake',
  imageUrl: '',
  inStockCount: 1,
  preparationMinutes: 10,
);

Widget details(
  BulkaApiClient api,
  CartProvider cart,
  ValueNotifier<Map<String, CatalogProduct>> live,
  void Function(CatalogProduct, num) change,
) => ChangeNotifierProvider.value(
  value: cart,
  child: MaterialApp(
    theme: buildBulkaTheme(),
    home: ProductDetailsScreen(
      api: api,
      product: product,
      liveProducts: live,
      initialQuantity: 0,
      onQuantityChanged: change,
    ),
  ),
);

class RecoveryLocationApi extends BulkaApiClient {
  var calls = 0;
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    calls++;
    if (calls == 1) throw Exception('temporary outage');
    return [
      BakeryLocation(
        id: 'branch',
        name: 'Recovered bakery',
        city: 'Aktau',
        address: 'Address',
      ),
    ];
  }
}

class OrderPollingApi extends BulkaApiClient {
  var calls = 0;
  final order = CustomerOrder.fromJson({
    'id': 'order',
    'number': 1,
    'paymentStatus': 'paid',
    'orderStatus': 'preparing',
    'fulfillmentType': 'pickup',
    'createdAt': DateTime.now().toIso8601String(),
    'items': [],
  });
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<CustomerOrder> getCustomerOrder(String id) async {
    calls++;
    return order;
  }
}

class BranchRouteApi extends BulkaApiClient {
  BranchRouteApi(http.Client client) : super(client: client);
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    for (final id in ['branch-a', 'branch-b'])
      BakeryLocation(id: id, name: id, city: 'Aktau', address: 'Address'),
  ];
}

void main() {
  testWidgets('options outage must not permit an incomplete item', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    var failOptions = true;
    final client = MockClient(
      (request) async =>
          request.url.path == '/api/public/product-options' && failOptions
          ? http.Response('{}', 503)
          : http.Response(
              '{"ready":true,"productIds":[],"products":{"configured":{"configuration":null,"modifierGroups":[]}}}',
              200,
            ),
    );
    final api = BulkaApiClient(client: client);
    final cart = CartProvider();
    final live = ValueNotifier<Map<String, CatalogProduct>>({
      product.id: product,
    });
    num added = 0;
    await tester.pumpWidget(details(api, cart, live, (_, qty) => added = qty));
    await tester.pumpAndSettle();
    final button = tester.widget<FilledButton>(
      find.byKey(const ValueKey('catalog-image-add')),
    );
    expect(button.onPressed, isNull);
    expect(added, 0);
    failOptions = false;
    final retry = find.byKey(const ValueKey('product-options-retry'));
    await tester.ensureVisible(retry);
    await tester.tap(retry);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('catalog-image-add')));
    await tester.pumpAndSettle();
    expect(
      added,
      1,
      reason: 'A successful retry re-enables the standard product',
    );
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    live.dispose();
  });
  testWidgets('configured item cannot exceed a stock count of one', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode(
          request.url.path == '/api/public/product-options'
              ? {
                  'products': {
                    'configured': {
                      'configuration': {
                        'enabled': true,
                        'productKind': 'variant',
                        'weightOptions': [
                          {'code': 'small', 'title': 'Small', 'priceDelta': 0},
                        ],
                      },
                      'modifierGroups': [],
                    },
                  },
                }
              : {'ready': true, 'productIds': []},
        ),
        200,
      ),
    );
    final api = BulkaApiClient(client: client);
    final cart = CartProvider();
    final live = ValueNotifier<Map<String, CatalogProduct>>({
      product.id: product,
    });
    await tester.pumpWidget(details(api, cart, live, (_, _) {}));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('catalog-image-add')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('catalog-image-add')));
    await tester.pumpAndSettle();
    final added = cart.getQuantity(product.id);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    live.dispose();
    expect(
      added,
      lessThanOrEqualTo(1),
      reason: 'Only one configured product is available',
    );
  });
  testWidgets('empty-cart suggestions recover after one failed load', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    var reads = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/api/guest/menu') {
        reads++;
        if (reads == 1) return http.Response('{}', 503);
        return http.Response(
          '{"products":[{"id":"cake","name":"Recovered","price":300,"onlineOrderable":true}]}',
          200,
        );
      }
      return http.Response('{}', 200);
    });
    final api = BulkaApiClient(client: client);
    final cart = CartProvider();
    await cart.restored;
    bool visible = true;
    late StateSetter update;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return TickerMode(
                enabled: visible,
                child: OrdersScreen(api: api, customer: null),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    update(() => visible = false);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(minutes: 3));
    update(() => visible = true);
    await tester.pump();
    await tester.pumpAndSettle();
    final present = find
        .byKey(const ValueKey('cart-popular-product-cake'))
        .evaluate()
        .isNotEmpty;
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    expect(
      present,
      isTrue,
      reason:
          'Network has recovered and user has revisited the empty cart; reads=$reads',
    );
  });
  testWidgets('empty-cart suggestions follow a branch change', (tester) async {
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'pickup',
      'selected_bakery_location_id_pickup': 'branch-a',
    });
    final branches = <String>[];
    final client = MockClient((request) async {
      if (request.url.path == '/api/guest/menu') {
        final branch = request.url.queryParameters['branchId']!;
        branches.add(branch);
        return http.Response(
          jsonEncode({
            'products': [
              {
                'id': branch,
                'name': branch,
                'price': 300,
                'onlineOrderable': true,
              },
            ],
          }),
          200,
        );
      }
      return http.Response('{}', 200);
    });
    final api = BulkaApiClient(client: client);
    final cart = CartProvider();
    await cart.restored;
    bool visible = true;
    late StateSetter update;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return TickerMode(
                enabled: visible,
                child: OrdersScreen(api: api, customer: null),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    update(() => visible = false);
    await tester.pumpAndSettle();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_bakery_location_id_pickup', 'branch-b');
    update(() => visible = true);
    await tester.pump();
    await tester.pumpAndSettle();
    final present = find
        .byKey(const ValueKey('cart-popular-product-branch-b'))
        .evaluate()
        .isNotEmpty;
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    expect(
      present,
      isTrue,
      reason: 'Old branch recommendation must be reloaded, requests=$branches',
    );
  });
  testWidgets('bakery chooser clears initial error on background recovery', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final api = RecoveryLocationApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LocationsScreen(api: api),
      ),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 60));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    final cityVisible = find
        .text(localizeCityName('Aktau'))
        .evaluate()
        .isNotEmpty;
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    expect(
      cityVisible,
      isTrue,
      reason:
          'Second response succeeds, calls=${api.calls}, but error should disappear',
    );
  });
  testWidgets('paused order details stop polling', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = OrderPollingApi();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: OrderDetailsScreen(
          api: api,
          initialOrder: api.order,
          onRepeat: (_) async {},
          onOrderChanged: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    final baseline = api.calls;
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
    }
    final actual = api.calls;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pumpAndSettle();
    expect(
      api.calls,
      greaterThan(actual),
      reason: 'Resume refreshes immediately',
    );
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    expect(
      actual,
      baseline,
      reason: 'Order details made ${actual - baseline} requests while paused',
    );
  });
  testWidgets('address map retries locations after initial outage', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final api = RecoveryLocationApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: AddressMapScreen(
          api: api,
          initialLatitude: 43.65,
          initialLongitude: 51.16,
          initialCity: 'Aktau',
        ),
      ),
    );
    await tester.pumpAndSettle();
    for (var i = 0; i < 3; i++) {
      await tester.pump(const Duration(seconds: 60));
      await tester.pump(const Duration(milliseconds: 300));
    }
    final calls = api.calls;
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    expect(
      calls,
      greaterThan(1),
      reason: 'The live refresh should still exist after the first frame',
    );
  });
  testWidgets('stock notification opens its own branch', (tester) async {
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'pickup',
      'selected_bakery_location_id_pickup': 'branch-a',
      'selected_bakery_location_pickup': 'branch-a',
    });
    final requestedBranches = <String?>[];
    final client = MockClient((request) async {
      if (request.url.path == '/api/guest/menu') {
        requestedBranches.add(request.url.queryParameters['branchId']);
        return http.Response(
          jsonEncode({
            'categories': [
              {'id': 'cake', 'name': 'Cake'},
            ],
            'products': [
              {
                'id': 'configured',
                'name': 'Configured product',
                'categoryId': 'cake',
                'price': 300,
                'availableQuantity': 1,
                'onlineOrderable': true,
              },
            ],
          }),
          200,
        );
      }
      return http.Response('{"ready":true,"productIds":[]}', 200);
    });
    final api = BranchRouteApi(client);
    final cart = CartProvider();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: CatalogScreen(
            api: api,
            hasSelectedOrderType: true,
            initialClientUri: Uri.parse(
              '/catalog/product/configured?branch=branch-b',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final branch = tester
        .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
        .branchId;
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    expect(
      branch,
      'branch-b',
      reason:
          'Notification branch-b must not open branch-a, menu requested=$requestedBranches',
    );
  });
}
