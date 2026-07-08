import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
          transactions: _testTransactions,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Image), findsWidgets);
    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(find.text('Тут много интересного'), findsOneWidget);
    expect(find.text('НОВИНКА'), findsOneWidget);
    expect(find.text('Выберите тип заказа'), findsOneWidget);
    expect(find.text('Накопительная'), findsOneWidget);
    expect(find.text('Осталось покупок: 4'), findsOneWidget);
    expect(find.text('Осталось покупок: 10'), findsOneWidget);

    await tester.tap(find.text('НОВИНКА'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byType(StoryViewer), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('История баланса'));
    await tester.tap(find.text('История баланса'));
    await tester.pumpAndSettle();
    expect(find.text('Начисление кэшбэка'), findsWidgets);

    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
    expect(find.text('Мой профиль'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();

    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(find.text('Накопительная'), findsOneWidget);
  });

  testWidgets('delivery address flow saves selected address', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: MainShell(
          api: _FakeBulkaApiClient(),
          customer: _testCustomer,
          transactions: _testTransactions,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Доставка'));
    await tester.pumpAndSettle();
    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(find.text('Адреса пока не добавлены'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Локации'), findsOneWidget);

    await tester.tap(find.text('Подтвердить'));
    await tester.pumpAndSettle();
    expect(find.text('Название адреса'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Введите').first,
      'тест',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Введите').at(1),
      '9',
    );
    await tester.ensureVisible(find.text('Продолжить'));
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();

    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(find.text('тест'), findsOneWidget);
    expect(find.byIcon(Icons.check_rounded), findsWidgets);
  });
}

class _FakeBulkaApiClient extends BulkaApiClient {
  @override
  Future<List<PromoStory>> getStories() async => const [
    PromoStory(
      id: 1,
      title: 'НОВИНКА',
      imageUrl: '',
      contentUrl: '',
      groupId: 'new',
      groupTitle: 'НОВИНКА',
      groupCoverUrl: '',
    ),
  ];

  @override
  Future<List<NewsItem>> getNews() async => const [];

  @override
  Future<String> getQrToken(String phone) async => 'test-live-token';
}

final _testTransactions = [
  BonusTransaction(
    id: 'tx1',
    customerId: '1',
    type: 'deposit',
    amount: 50,
    orderTotal: 1000,
    timestamp: DateTime.now()
        .subtract(const Duration(days: 2))
        .toIso8601String(),
  ),
  BonusTransaction(
    id: 'tx2',
    customerId: '1',
    type: 'deposit',
    amount: 75,
    orderTotal: 1500,
    timestamp: DateTime.now()
        .subtract(const Duration(days: 8))
        .toIso8601String(),
  ),
];

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
