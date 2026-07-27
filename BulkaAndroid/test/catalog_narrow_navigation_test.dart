import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

void main() {
  testWidgets('bottom navigation labels remain readable at 320 pixels', (
    tester,
  ) async {
    appLanguageNotifier.value = 'kk';
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(() => appLanguageNotifier.value = 'ru');

    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            bottomNavigationBar: FloatingNavBar(
              selectedIndex: 1,
              onChanged: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final labels = ['Басты бет', 'Мәзір', 'Себет', 'Акциялар', 'Профиль'];
    for (var index = 0; index < labels.length; index++) {
      final label = labels[index];
      final text = tester.widget<Text>(find.text(label));
      expect(text.maxLines, 2);
      expect(text.textAlign, TextAlign.center);
      final style = tester.widget<AnimatedDefaultTextStyle>(
        find.descendant(
          of: find.byKey(ValueKey('nav-$index')),
          matching: find.byType(AnimatedDefaultTextStyle),
        ),
      );
      expect(style.style.fontSize, BulkaTypeScale.caption);
    }
    expect(
      find.descendant(
        of: find.byType(FloatingNavBar),
        matching: find.byType(FittedBox),
      ),
      findsNothing,
    );

    final selectedIndicator = tester.widget<AnimatedContainer>(
      find.descendant(
        of: find.byKey(const ValueKey('nav-1')),
        matching: find.byType(AnimatedContainer),
      ),
    );
    final idleCartIndicator = tester.widget<AnimatedContainer>(
      find.descendant(
        of: find.byKey(const ValueKey('nav-2')),
        matching: find.byType(AnimatedContainer),
      ),
    );
    expect(
      (selectedIndicator.decoration! as BoxDecoration).gradient,
      isNotNull,
    );
    expect((idleCartIndicator.decoration! as BoxDecoration).gradient, isNull);
    expect((idleCartIndicator.decoration! as BoxDecoration).border, isNotNull);
    expect(tester.takeException(), isNull);
  });
}
