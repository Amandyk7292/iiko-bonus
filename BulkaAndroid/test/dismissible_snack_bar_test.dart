import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget snackBarHost() => MaterialApp(
  home: Scaffold(
    body: Builder(
      builder: (context) => FilledButton(
        onPressed: () => ScaffoldMessenger.of(
          context,
        ).showSnackBar(bulkaSnackBar(content: const Text('Сообщение'))),
        child: const Text('Показать'),
      ),
    ),
  ),
);

void main() {
  testWidgets('application snack bars close when their content is tapped', (
    tester,
  ) async {
    await tester.pumpWidget(snackBarHost());
    await tester.tap(find.text('Показать'));
    await tester.pumpAndSettle();
    expect(find.text('Сообщение'), findsOneWidget);

    await tester.tap(find.text('Сообщение'));
    await tester.pumpAndSettle();
    expect(find.text('Сообщение'), findsNothing);
  });

  testWidgets('application snack bars close on an upward swipe', (
    tester,
  ) async {
    await tester.pumpWidget(snackBarHost());
    await tester.tap(find.text('Показать'));
    await tester.pumpAndSettle();

    await tester.fling(find.text('Сообщение'), const Offset(0, -180), 900);
    await tester.pumpAndSettle();
    expect(find.text('Сообщение'), findsNothing);
  });
}
