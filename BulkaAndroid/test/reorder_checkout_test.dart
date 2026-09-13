import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _ReorderApi extends BulkaApiClient {
  _ReorderApi(this.status);
  final String status;
  @override
  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async => {'paymentStatus': status};
  @override
  Future<List<Map<String, dynamic>>> reorder(
    String orderId, {
    String? branchId,
  }) async => [
    {'id': 'bun', 'name': 'Булочка', 'price': 300, 'quantity': 2},
  ];
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
      SharedPreferences.setMockInitialValues({});
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
      await tester.pumpAndSettle();
      if (status == 'paid') {
        expect(cart.getQuantity('bun'), 2);
        expect(cart.getQuantity('old-item'), 0);
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
}
