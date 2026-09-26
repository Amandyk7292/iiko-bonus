import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bulka_bonus/main.dart';

void main() {
  testWidgets('product badges display configured text and colors', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ProductBadgeChips(
            badges: [
              {
                'label': 'Хит',
                'background': '#ff0000',
                'foreground': '#ffffff',
              },
            ],
          ),
        ),
      ),
    );
    expect(find.text('Хит'), findsOneWidget);
    final text = tester.widget<Text>(find.text('Хит'));
    expect(text.style?.color, Colors.white);
    final container = tester.widget<Container>(
      find
          .ancestor(of: find.text('Хит'), matching: find.byType(Container))
          .first,
    );
    expect(
      (container.decoration as BoxDecoration).color,
      const Color(0xffff0000),
    );
  });
}
