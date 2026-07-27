import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  test('recognizes a genuine cancelled Forte return URL', () {
    final notice = paymentReturnNoticeFromUri(
      Uri.parse(
        'https://bulka.com.kz/orders'
        '?payment=forte'
        '&order=31f0d793-0102-4d2f-a5a1-744d12cffe7c'
        '&ID=1000001917869'
        '&STATUS=Cancelled',
      ),
    );

    expect(notice, PaymentReturnNotice.cancelled);
    expect(
      paymentReturnNoticeFromUri(
        Uri.parse(
          'https://bulka.com.kz/orders'
          '?payment=forte'
          '&order=not-an-order'
          '&STATUS=Cancelled',
        ),
      ),
      isNull,
    );
  });

  testWidgets(
    'cancelled payment is explained separately from previous order statuses',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CustomerOrdersScreen(
            api: _PaymentReturnApiClient(),
            paymentReturnNotice: PaymentReturnNotice.cancelled,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Оплата отменена'), findsOneWidget);
      expect(find.textContaining('Деньги не списаны'), findsOneWidget);
      expect(find.text('Оплата: Оплачено'), findsOneWidget);
      expect(find.text('Заказ: Новый'), findsOneWidget);
      expect(find.text('Заказ № 100029'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(
        find.byKey(const ValueKey('payment-cancel-notice-dismiss')),
      );
      await tester.pump();
      expect(find.text('Оплата отменена'), findsNothing);
    },
  );
}

class _PaymentReturnApiClient extends BulkaApiClient {
  @override
  Future<List<CustomerOrder>> getCustomerOrders({
    bool completed = false,
  }) async {
    if (completed) return const [];
    return [
      CustomerOrder(
        id: 'previous-paid-order',
        number: 100029,
        paymentStatus: 'paid',
        orderStatus: 'new',
        amount: 10,
        subtotal: 10,
        discount: 0,
        branch: 'ЖК Дукат, 17-й микрорайон, 1',
        items: const [
          {
            'id': 'moscow-bun',
            'name': 'Плюшка Московская',
            'quantity': 1,
            'price': 10,
          },
        ],
        earnedBonus: 1,
        createdAt: DateTime.utc(2026, 7, 20),
        fulfillmentType: 'pickup',
        deliveryStatus: 'unassigned',
      ),
    ];
  }
}
