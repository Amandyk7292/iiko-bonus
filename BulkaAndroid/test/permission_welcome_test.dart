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
    'permissions only requested by explicit taps; denial does not block ordering',
    (tester) async {
      var notifications = 0, location = 0;
      final gate = BulkaPermissionGate(
        requestNotifications: () async {
          notifications++;
          return false;
        },
        requestLocation: () async {
          location++;
          return true;
        },
        child: const MaterialApp(home: Text('shop')),
      );
      await tester.pumpWidget(gate);
      await tester.pumpAndSettle();
      expect(notifications, 0);
      expect(location, 0);
      await tester.ensureVisible(
        find.byKey(const ValueKey('permission-notifications')),
      );
      await tester.tap(find.byKey(const ValueKey('permission-notifications')));
      await tester.pumpAndSettle();
      expect(notifications, 1);
      expect(location, 0);
      await tester.ensureVisible(
        find.byKey(const ValueKey('permission-location')),
      );
      await tester.tap(find.byKey(const ValueKey('permission-location')));
      await tester.pumpAndSettle();
      expect(location, 1);
      await tester.ensureVisible(
        find.byKey(const ValueKey('permissions-continue')),
      );
      await tester.tap(find.byKey(const ValueKey('permissions-continue')));
      await tester.pumpAndSettle();
      expect(find.text('shop'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(gate);
      await tester.pumpAndSettle();
      expect(find.text('shop'), findsOneWidget);
      expect(notifications, 1);
      expect(location, 1);
    },
  );
  for (final lang in ['ru', 'kk', 'en']) {
    testWidgets(
      'permission explanations remain readable at 320px and 200% in $lang',
      (tester) async {
        tester.view.physicalSize = const Size(320, 568);
        tester.view.devicePixelRatio = 1;
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        appLanguageNotifier.value = lang;
        var prompts = 0;
        await tester.pumpWidget(
          BulkaPermissionGate(
            requestNotifications: () async {
              prompts++;
              return true;
            },
            requestLocation: () async {
              prompts++;
              return true;
            },
            child: const MaterialApp(home: Text('shop')),
          ),
        );
        await tester.pumpAndSettle();
        for (final key in [
          'permission-notifications',
          'permission-location',
          'permissions-continue',
        ]) {
          final button = find.byKey(ValueKey(key));
          await tester.ensureVisible(button);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(tester.getSize(button).height, greaterThanOrEqualTo(44));
        }
        await tester.tap(find.byKey(const ValueKey('permissions-continue')));
        await tester.pumpAndSettle();
        expect(prompts, 0);
        expect(find.text('shop'), findsOneWidget);
      },
    );
  }

  testWidgets('grant fades and collapses card while next card moves up', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 1000);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      BulkaPermissionGate(
        requestNotifications: () async => true,
        requestLocation: () async => false,
        child: const MaterialApp(home: Text('shop')),
      ),
    );
    await tester.pumpAndSettle();
    final next = find.byKey(const ValueKey('location-card'));
    final header = find.byKey(const ValueKey('permission-welcome-title'));
    final startY = tester.getTopLeft(next).dy;
    final headerY = tester.getTopLeft(header).dy;
    await tester.tap(find.byKey(const ValueKey('permission-notifications')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    final middleY = tester.getTopLeft(next).dy;
    expect(middleY, lessThan(startY));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(next).dy, lessThan(middleY));
    expect(tester.getTopLeft(header).dy, headerY);
    expect(find.text('Всё о вашем заказе'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('permission-location')));
    await tester.pumpAndSettle();
    expect(next, findsOneWidget);
    expect(find.text('Открыть настройки'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
