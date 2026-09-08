import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  testWidgets(
    'first launch waits for language, saves it, and does not repeat',
    (tester) async {
      const child = MaterialApp(home: Scaffold(body: Text('customer-home')));
      await tester.pumpWidget(const BulkaWelcomeGate(child: child));
      await tester.pumpAndSettle();
      expect(find.text('customer-home'), findsNothing);
      expect(find.byKey(const ValueKey('welcome-title')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('welcome-language-kk')));
      await tester.pumpAndSettle();
      expect(find.text('Қолданба тілін таңдаңыз'), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey('welcome-continue')),
      );
      await tester.tap(find.byKey(const ValueKey('welcome-continue')));
      await tester.pumpAndSettle();
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(BulkaWelcomeGate.completedKey), isTrue);
      expect(prefs.getString('app_lang_code'), 'kk');
      expect(
        find.byKey(const ValueKey('permission-welcome-title')),
        findsOneWidget,
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('permissions-continue')),
      );
      await tester.tap(find.byKey(const ValueKey('permissions-continue')));
      await tester.pumpAndSettle();
      expect(find.text('customer-home'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(const BulkaWelcomeGate(child: child));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('welcome-title')), findsNothing);
      expect(find.text('customer-home'), findsOneWidget);
    },
  );

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets('welcome is usable on 320px with 200% text: $language', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      appLanguageNotifier.value = language;
      await tester.pumpWidget(const BulkaWelcomeGate(child: SizedBox()));
      await tester.pumpAndSettle();
      final action = find.byKey(const ValueKey('welcome-continue'));
      await tester.ensureVisible(action);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final rect = tester.getRect(action);
      expect(rect.center.dx, closeTo(160, 1));
      expect(rect.height, greaterThanOrEqualTo(58));
      expect(rect.bottom, lessThanOrEqualTo(568));
    });
  }
}
