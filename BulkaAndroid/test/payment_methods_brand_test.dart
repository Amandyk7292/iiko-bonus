import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _PaymentMethodsApi extends BulkaApiClient {
  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => const [
    {
      'id': 'visa-card',
      'brand': 'visa',
      'lastFour': '3803',
      'expMonth': 10,
      'expYear': 2026,
      'isDefault': true,
    },
    {
      'id': 'mastercard-card',
      'brand': 'mastercard',
      'lastFour': '1328',
      'expMonth': 12,
      'expYear': 2028,
      'isDefault': false,
    },
  ];
}

void main() {
  testWidgets('saved cards show the payment network mark', (tester) async {
    appLanguageNotifier.value = 'ru';
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: PaymentMethodsScreen(api: _PaymentMethodsApi()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('payment-brand-visa')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('payment-brand-mastercard')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('payment-brand-generic')), findsNothing);
  });
}
