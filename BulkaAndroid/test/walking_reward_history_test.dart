import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const reward = BonusTransaction(
    id: 'walking-transaction',
    customerId: 'customer-private-id',
    orderId: 'WALKING-2026-10-06-customer-private-id',
    type: 'deposit',
    amount: 1000,
    timestamp: '2026-10-07T07:00:00',
  );

  tearDown(() => appLanguageNotifier.value = 'ru');

  test(
    'walking ledger entries retain their earned day and avoid cashback labels',
    () {
      appLanguageNotifier.value = 'ru';
      expect(reward.isWalkingReward, isTrue);
      expect(reward.walkingDate, '2026-10-06');
      expect(reward.label, 'Бонус за 10 000 шагов');
      expect(
        BonusTransaction.fromJson(reward.toJson()).walkingDate,
        '2026-10-06',
      );
      expect(
        const BonusTransaction(
          id: 'receipt',
          customerId: 'customer',
          orderId: '12345',
          type: 'deposit',
          amount: 20,
          timestamp: '2026-10-07T07:00:00',
        ).isWalkingReward,
        isFalse,
      );
    },
  );

  testWidgets(
    'bonus history shows the daily step reward, amount and earned day in each language',
    (tester) async {
      for (final entry in const {
        'ru': 'Бонус за 10 000 шагов · 2026-10-06',
        'kk': '10 000 қадам үшін бонус · 2026-10-06',
        'en': 'Reward for 10,000 steps · 2026-10-06',
      }.entries) {
        appLanguageNotifier.value = entry.key;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: const BalanceHistoryScreen(transactions: [reward]),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text(entry.value), findsOneWidget);
        expect(find.textContaining('+1000'), findsOneWidget);
        expect(find.byIcon(Icons.directions_walk), findsOneWidget);
        expect(find.textContaining('customer-private-id'), findsNothing);
        expect(find.textContaining('за покупку'), findsNothing);
        expect(tester.takeException(), isNull);
      }
    },
  );
}
