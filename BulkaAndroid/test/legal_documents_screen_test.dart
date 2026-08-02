import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(() {
    appLanguageNotifier.value = 'ru';
  });

  testWidgets('legal documents are grouped on one compact page', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    tester.view.physicalSize = const Size(375, 667);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(theme: buildBulkaTheme(), home: const LegalDocumentsScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Документы и условия'), findsOneWidget);
    for (final label in const [
      'Политика конфиденциальности',
      'Публичная оферта',
      'Условия использования',
      'Условия оплаты и возврата',
      'Условия доставки',
      'Реквизиты компании',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.byType(ListView), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('legal documents page remains scrollable in landscape', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    tester.view.physicalSize = const Size(667, 375);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(theme: buildBulkaTheme(), home: const LegalDocumentsScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Документы и условия'), findsOneWidget);
    expect(find.byType(ListView), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -220));
    await tester.pumpAndSettle();
    expect(find.text('Реквизиты компании'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
