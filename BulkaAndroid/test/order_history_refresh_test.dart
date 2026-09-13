import 'dart:async';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const oldOrderId = '11111111-1111-4111-8111-111111111111';

CustomerOrder orderFixture({
  required String id,
  required int number,
  required DateTime createdAt,
  String status = 'completed',
}) => CustomerOrder.fromJson({
  'id': id,
  'number': number,
  'paymentStatus': 'paid',
  'orderStatus': status,
  'amount': 500,
  'subtotal': 500,
  'discount': 0,
  'branch': 'Bulka тест',
  'items': [
    {'id': 'bun', 'name': 'Булочка', 'quantity': 1, 'price': 500},
  ],
  'earnedBonus': 0,
  'createdAt': createdAt.toIso8601String(),
  'fulfillmentType': 'pickup',
  'deliveryStatus': 'unassigned',
});

class OrderHistoryApi extends BulkaApiClient {
  final changes = StreamController<Map<String, dynamic>>.broadcast();
  int listReads = 0;
  int singleReads = 0;

  late CustomerOrder oldOrder = orderFixture(
    id: oldOrderId,
    number: 1,
    createdAt: DateTime.utc(2025),
  );

  @override
  Stream<Map<String, dynamic>> get customerEvents => changes.stream;

  @override
  Future<List<CustomerOrder>> getCustomerOrders({
    bool completed = false,
  }) async {
    listReads++;
    return List.generate(50, (index) {
      final scope = completed ? 100 : 0;
      return orderFixture(
        id: 'page-${scope + index}',
        number: scope + index + 2,
        createdAt: DateTime.utc(
          2026,
          9,
          12,
        ).subtract(Duration(minutes: scope + index)),
        status: completed ? 'completed' : 'new',
      );
    });
  }

  @override
  Future<CustomerOrder> getCustomerOrder(String orderId) async {
    singleReads++;
    expect(orderId, oldOrderId);
    return oldOrder;
  }
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets(
    'an order older than 100 purchases opens through its owner-scoped endpoint',
    (tester) async {
      final api = OrderHistoryApi();
      addTearDown(api.dispose);
      addTearDown(api.changes.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: ChangeNotifierProvider(
            create: (_) => CartProvider(),
            child: CustomerOrdersScreen(api: api, initialOrderId: oldOrderId),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(api.listReads, 2);
      expect(api.singleReads, 1);
      expect(find.byType(OrderDetailsScreen), findsOneWidget);
      expect(find.textContaining('№1'), findsWidgets);
    },
  );

  testWidgets('one delivery event refreshes only the open order', (
    tester,
  ) async {
    final api = OrderHistoryApi();
    addTearDown(api.dispose);
    addTearDown(api.changes.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: OrderDetailsScreen(
          api: api,
          initialOrder: api.oldOrder,
          onRepeat: (_) async {},
          onOrderChanged: (_) {},
        ),
      ),
    );
    await tester.pump();
    api.changes.add({
      'type': 'delivery.updated',
      'data': {'orderId': oldOrderId},
    });
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();

    expect(api.singleReads, 1);
    expect(api.listReads, 0);
  });
}
