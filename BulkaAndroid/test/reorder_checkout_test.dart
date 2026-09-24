import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const testBranchId = '11111111-1111-4111-8111-111111111111';

class _ReorderApi extends BulkaApiClient {
  _ReorderApi(this.status);
  final String status;
  String? quotedBranchId;
  bool failQuote = false;
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: testBranchId,
      name: 'Филиал',
      address: '19А',
      city: 'Актау',
    ),
  ];
  @override
  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async => {'paymentStatus': status};
  @override
  Future<List<Map<String, dynamic>>> reorder(
    String orderId, {
    String? branchId,
  }) async {
    quotedBranchId = branchId;
    if (failQuote) throw ApiException('Товар недоступен в выбранной точке');
    return [
      {'id': 'bun', 'name': 'Булочка', 'price': 300, 'quantity': 2},
    ];
  }

  @override
  Future<List<CustomerOrder>> getCustomerOrders({
    bool completed = false,
  }) async => completed
      ? []
      : [
          CustomerOrder.fromJson({
            'id': 'previous-order',
            'number': 100047,
            'paymentStatus': 'paid',
            'orderStatus': 'completed',
            'amount': 600,
            'subtotal': 600,
            'branch': 'Филиал',
            'branchId': testBranchId,
            'fulfillmentType': 'pickup',
            'createdAt': '2026-09-10T18:43:00Z',
            'items': [
              {'id': 'bun', 'name': 'Булочка', 'quantity': 2, 'price': 300},
            ],
          }),
        ];
}

void main() {
  for (final status in ['paid', 'pending']) {
    testWidgets('repeat button separates the new cart from a $status payment', (
      tester,
    ) async {
      appLanguageNotifier.value = 'ru';
      SharedPreferences.setMockInitialValues({
        'selected_order_type': 'pickup',
        'selected_bakery_location_id': testBranchId,
        'selected_bakery_location_id_pickup': testBranchId,
        'selected_bakery_location': 'Филиал, 19А',
      });
      final api = _ReorderApi(status);
      final cart = CartProvider();
      await cart.restored;
      cart.addItem(
        productId: 'old-item',
        name: 'Старая корзина',
        price: 100,
        imageUrl: '',
      );
      final prefs = await SharedPreferences.getInstance();
      final key = customerPreferenceKey('checkout_id', api.sessionCacheScope);
      await prefs.setString(key, 'old-checkout');
      await PendingForteOperationStore.save(
        api,
        operationId: 'previous-payment',
        checkoutId: 'old-checkout',
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => CustomerOrdersScreen(api: api),
                    ),
                  ),
                  child: const Text('Открыть заказы'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Открыть заказы'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Повторить'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(cart.getQuantity('old-item'), 1);
      await tester.tap(find.byKey(const ValueKey('repeat-replace-cart')));
      await tester.pumpAndSettle();
      if (status == 'paid') {
        expect(cart.getQuantity('bun'), 2);
        expect(cart.getQuantity('old-item'), 0);
        expect(api.quotedBranchId, testBranchId);
        expect(prefs.getString('selected_bakery_location_id'), testBranchId);
        expect(prefs.getString(key), isNull);
        expect(await PendingForteOperationStore.load(api), isNull);
        expect(find.text('Открыть заказы'), findsOneWidget);
      } else {
        expect(cart.getQuantity('old-item'), 1);
        expect(cart.getQuantity('bun'), 0);
        expect(prefs.getString(key), 'old-checkout');
        expect(find.byType(CustomerOrdersScreen), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  Future<void> openOrders(
    WidgetTester tester,
    CartProvider cart,
    _ReorderApi api,
  ) async {
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => CustomerOrdersScreen(api: api),
                  ),
                ),
                child: const Text('Открыть заказы'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Открыть заказы'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'repeat can merge with an existing cart and cancel leaves it untouched',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      SharedPreferences.setMockInitialValues({
        'selected_order_type': 'pickup',
        'selected_bakery_location_id': testBranchId,
      });
      final api = _ReorderApi('paid');
      final cart = CartProvider();
      await cart.restored;
      cart.addItem(
        productId: 'old-item',
        name: 'Старая корзина',
        price: 100,
        imageUrl: '',
      );
      cart.addItem(productId: 'bun', name: 'Булочка', price: 200, imageUrl: '');
      await openOrders(tester, cart, api);
      await tester.tap(find.byTooltip('Повторить'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      expect(cart.getQuantity('old-item'), 1);
      expect(cart.getQuantity('bun'), 1);
      expect(api.quotedBranchId, isNull);
      await tester.tap(find.byTooltip('Повторить'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byKey(const ValueKey('repeat-merge-cart')));
      await tester.pumpAndSettle();
      expect(cart.getQuantity('old-item'), 1);
      expect(cart.getQuantity('bun'), 3);
      expect(cart.items['bun']?.price, 300);
      expect(api.quotedBranchId, testBranchId);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('cannot merge a previous pickup into a delivery cart', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({'selected_order_type': 'delivery'});
    final api = _ReorderApi('paid');
    final cart = CartProvider();
    await cart.restored;
    cart.addItem(
      productId: 'old-item',
      name: 'Старая корзина',
      price: 100,
      imageUrl: '',
    );
    await openOrders(tester, cart, api);
    await tester.tap(find.byTooltip('Повторить'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byKey(const ValueKey('repeat-merge-cart')), findsNothing);
    expect(find.byKey(const ValueKey('repeat-replace-cart')), findsOneWidget);
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();
    expect(cart.getQuantity('old-item'), 1);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('failed availability check keeps the previous cart and branch', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'pickup',
      'selected_bakery_location_id': testBranchId,
    });
    final api = _ReorderApi('paid')..failQuote = true;
    final cart = CartProvider();
    await cart.restored;
    cart.addItem(
      productId: 'old-item',
      name: 'Старая корзина',
      price: 100,
      imageUrl: '',
    );
    await openOrders(tester, cart, api);
    await tester.tap(find.byTooltip('Повторить'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byKey(const ValueKey('repeat-replace-cart')));
    await tester.pumpAndSettle();
    expect(cart.getQuantity('old-item'), 1);
    expect(cart.getQuantity('bun'), 0);
    expect(find.byType(CustomerOrdersScreen), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
