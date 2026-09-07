import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('tier cache preserves custom artwork and tier code', () {
    final tier = Tier.fromJson({
      'name': 'Платина',
      'code': 'platinum',
      'percent': 5,
      'backgroundImageUrl': 'https://images.example.test/custom.webp',
    });
    final restored = Tier.fromJson(tier.toJson());
    expect(restored.code, 'platinum');
    expect(
      restored.backgroundImageUrl,
      'https://images.example.test/custom.webp',
    );
    expect(Tier.fromJson({'name': 'Бронза'}).backgroundImageUrl, isNull);
  });

  for (final code in ['bronze', 'silver', 'platinum']) {
    testWidgets(
      '$code remains readable at narrow width with large text and unavailable image',
      (tester) async {
        appLanguageNotifier.value = 'ru';
        tester.view.physicalSize = const Size(320, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final tier = Tier.fromJson({
          'name': 'Очень длинное название уровня',
          'code': code,
          'percent': 5,
          'level': 3,
          'allTiers': [
            {'name': 'Бронза', 'percent': 3},
            {'name': 'Серебро', 'percent': 4},
            {'name': 'Очень длинное название уровня', 'percent': 5},
          ],
        });
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
                child: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: LoyaltyTierCard(tier: tier),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pump(const Duration(seconds: 1));
        expect(tester.takeException(), isNull);
        expect(find.textContaining('5%'), findsWidgets);
        final title = tester.widget<Text>(find.textContaining('Статус:'));
        expect(title.style?.color, Colors.white);
      },
    );
  }
}
