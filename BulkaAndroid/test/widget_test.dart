import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows login screen', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LoginScreen(
          onRequestOtp: (_, _) async => null,
          onVerifyOtp: (_, _) async => null,
        ),
      ),
    );

    expect(find.text('Bulka Bonus'), findsOneWidget);
    expect(find.text('Получить код в WhatsApp'), findsOneWidget);
  });

  testWidgets('profile back returns to populated home', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: MainShell(
          api: _FakeBulkaApiClient(),
          customer: _testCustomer,
          transactions: const [],
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Добро пожаловать,'), findsOneWidget);
    expect(find.text('КАРТА ГОСТЯ'), findsOneWidget);

    await tester.tap(find.text('Алия'));
    await tester.pumpAndSettle();
    expect(find.text('Мой профиль'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Добро пожаловать,'), findsOneWidget);
    expect(find.text('КАРТА ГОСТЯ'), findsOneWidget);
  });
}

class _FakeBulkaApiClient extends BulkaApiClient {
  @override
  Future<List<PromoStory>> getStories() async => const [];

  @override
  Future<List<NewsItem>> getNews() async => const [];
}

const _testCustomer = Customer(
  id: '1',
  name: 'Алия',
  phone: '77000000000',
  balance: 1200,
  totalSpent: 24000,
  createdAt: '2026-01-01T00:00:00Z',
  isVip: false,
  cashbackPercent: 5,
  vipThreshold: 300000,
  tier: Tier(name: 'Бронза', percent: 5, remaining: 10000, progress: 0.2),
);
