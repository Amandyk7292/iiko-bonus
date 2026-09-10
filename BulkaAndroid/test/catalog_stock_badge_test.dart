import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('remaining stock uses pieces, fractional weight and wraps at large text size', (tester) async {
    appLanguageNotifier.value = 'ru';
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.8)),
      child: const SizedBox(width: 155, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        CatalogStockBadge(quantity: 5), SizedBox(height: 8),
        CatalogStockBadge(quantity: 2), SizedBox(height: 8),
        CatalogStockBadge(quantity: 0.75, unit: 'кг'),
      ])),
    ))));
    expect(find.text('Осталось 5 шт.'), findsOneWidget);
    expect(find.text('Осталось 0.75 кг'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
