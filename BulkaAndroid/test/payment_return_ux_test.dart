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

  test('embedded checkout closes only for a trusted Forte return', () {
    const orderId = '31f0d793-0102-4d2f-a5a1-744d12cffe7c';

    expect(
      forteCheckoutReturnFromUri(
        Uri.parse(
          'https://bulka.com.kz/orders'
          '?payment=forte&order=$orderId&STATUS=Cancelled',
        ),
      ),
      ForteCheckoutReturn.cancelled,
    );
    expect(
      forteCheckoutReturnFromUri(
        Uri.parse(
          'https://bulka.com.kz/orders'
          '?payment=forte&order=$orderId&STATUS=Approved',
        ),
      ),
      ForteCheckoutReturn.completed,
    );
    expect(
      forteCheckoutReturnFromUri(
        Uri.parse(
          'https://bulka.com.kz.attacker.example/orders'
          '?payment=forte&order=$orderId&STATUS=Approved',
        ),
      ),
      isNull,
    );
    expect(
      forteCheckoutReturnFromUri(
        Uri.parse(
          'http://bulka.com.kz/orders'
          '?payment=forte&order=$orderId&STATUS=Approved',
        ),
      ),
      isNull,
    );
  });

  test('recognizes a returned card setup for profile reconciliation', () {
    const operationId = '3ebcf588-1d59-4231-8806-3c805fd6db7c';
    final result = forteCardSetupReturnFromUri(
      Uri.parse(
        'https://bulka.com.kz/profile'
        '?payment=forte&setup=$operationId&status=returned',
      ),
    );

    expect(result?.operationId, operationId);
    expect(result?.outcome, ForteCheckoutReturn.completed);
    expect(
      forteCardSetupReturnFromUri(
        Uri.parse(
          'https://bulka.com.kz.attacker.example/profile'
          '?payment=forte&setup=$operationId&status=returned',
        ),
      ),
      isNull,
    );
  });

  test('embedded checkout is limited to Android and iOS apps', () {
    expect(
      supportsEmbeddedForteCheckout(
        isWeb: false,
        platform: TargetPlatform.android,
      ),
      isTrue,
    );
    expect(
      supportsEmbeddedForteCheckout(isWeb: false, platform: TargetPlatform.iOS),
      isTrue,
    );
    expect(
      supportsEmbeddedForteCheckout(
        isWeb: true,
        platform: TargetPlatform.android,
      ),
      isFalse,
    );
    expect(
      supportsEmbeddedForteCheckout(
        isWeb: false,
        platform: TargetPlatform.windows,
      ),
      isFalse,
    );
  });

  test('embedded checkout mode hides only the in-page duplicate chrome', () {
    final uri = forteEmbeddedCheckoutUri(
      Uri.parse(
        'https://bulka.com.kz/payments/forte-widget'
        '#token=abc1234567890123&order=117615f9-b35f-4eb4-9f6d-777f2236bb25',
      ),
    );

    expect(uri.queryParameters, {'embedded': 'app'});
    expect(uri.fragment, contains('token=abc1234567890123'));
    expect(uri.query, isNot(contains('token')));
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
