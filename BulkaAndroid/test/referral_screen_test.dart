import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ReferralApi extends BulkaApiClient {
  @override
  Future<Map<String, dynamic>> getReferralHistory({int offset = 0}) async => {
    'registered': 1,
    'purchased': 1,
    'earned': 1000,
    'reversed': 0,
    'debt': 0,
    'items': [
      {
        'id': 'invite',
        'number': 1,
        'purchased': true,
        'status': 'rewarded',
        'reward': 1000,
      },
    ],
  };
  bool offline = false;
  String? deviceReason;
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async => {'balance': 0};
  @override
  Future<Map<String, dynamic>> getReferral() async {
    if (offline) throw ApiException('offline');
    return {
      'code': 'BULKA-1234ABCD',
      'url': 'https://bulka.com.kz/catalog?ref=BULKA-1234ABCD',
      'enabled': deviceReason == null,
      'deviceReason': deviceReason,
      'reward_referrer': 1000,
      'reward_friend': 500,
      'min_first_order': 0,
    };
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  testWidgets('profile opens invitations and copies the real referral link', (
    tester,
  ) async {
    final api = ReferralApi();
    addTearDown(api.dispose);
    String? clipboard;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          clipboard = (call.arguments as Map)['text'] as String;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ProfileScreen(
          api: api,
          customer: const Customer(
            id: 'friend',
            name: 'Друг',
            phone: '+77010000000',
            balance: 0,
            totalSpent: 0,
            createdAt: '2026-09-27',
            isVip: false,
            cashbackPercent: 3,
            vipThreshold: 100000,
            tier: null,
          ),
          transactions: const [],
          onBack: () {},
          onLogout: () async {},
          onRefreshProfile: () async {},
          onOpenOrders: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    final invitation = find.text('Пригласите друга');
    await tester.ensureVisible(invitation);
    await tester.tap(invitation);
    await tester.pumpAndSettle();
    expect(find.byType(ReferralScreen), findsOneWidget);
    expect(find.textContaining('1000 ₸'), findsWidgets);
    await tester.tap(find.text('Скопировать'));
    await tester.pumpAndSettle();
    expect(clipboard, 'https://bulka.com.kz/catalog?ref=BULKA-1234ABCD');
    await tester.ensureVisible(find.text('Друг №1'));
    expect(find.text('Награда начислена'), findsOneWidget);
    expect(find.textContaining('Зарегистрировались: 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'offline invitation load can be retried without reopening the screen',
    (tester) async {
      final api = ReferralApi()..offline = true;
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: ReferralScreen(api: api),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Не удалось загрузить'), findsOneWidget);
      api.offline = false;
      await tester.tap(find.text('Повторить'));
      await tester.pumpAndSettle();
      expect(find.text('BULKA-1234ABCD'), findsOneWidget);
      expect(find.text('Пригласить по ссылке'), findsOneWidget);
    },
  );
  testWidgets(
    'second account sees the restriction and cannot copy or share an invitation',
    (tester) async {
      final api = ReferralApi()..deviceReason = 'shared_device';
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: ReferralScreen(api: api),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('только первому аккаунту'), findsOneWidget);
      final copy = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Скопировать'),
      );
      expect(copy.onPressed, isNull);
      expect(tester.takeException(), isNull);
    },
  );
}
