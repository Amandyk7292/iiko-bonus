import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('failed explicit logout stays signed in and offers retry', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    var logoutCalls = 0;
    const customer = Customer(
      id: 'customer-1',
      name: 'Амандык',
      phone: '+7 776 200 33 90',
      balance: 100,
      totalSpent: 1000,
      createdAt: '2026-01-01T00:00:00Z',
      isVip: false,
      cashbackPercent: 5,
      vipThreshold: 100000,
      tier: null,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ProfileScreen(
          api: BulkaApiClient(),
          customer: customer,
          transactions: const [],
          onBack: () {},
          onLogout: () async {
            logoutCalls++;
            throw ApiException('offline', code: 'LOGOUT_RETRY_REQUIRED');
          },
          onRefreshProfile: () async {},
          onOpenOrders: () async {},
        ),
      ),
    );

    await tester.tap(find.byTooltip('Выйти'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Выйти'));
    await tester.pumpAndSettle();

    expect(logoutCalls, 1);
    expect(find.byType(ProfileScreen), findsOneWidget);
    expect(
      find.text(
        'Не удалось безопасно выйти. Проверьте подключение и повторите попытку.',
      ),
      findsOneWidget,
    );
  });
}
