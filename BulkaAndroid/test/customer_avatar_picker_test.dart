import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

double _contrastRatio(Color foreground, Color background) {
  final foregroundLuminance = foreground.computeLuminance();
  final backgroundLuminance = background.computeLuminance();
  final lightest = foregroundLuminance > backgroundLuminance
      ? foregroundLuminance
      : backgroundLuminance;
  final darkest = foregroundLuminance > backgroundLuminance
      ? backgroundLuminance
      : foregroundLuminance;
  return (lightest + 0.05) / (darkest + 0.05);
}

void main() {
  testWidgets('avatar picker has a visible close icon and selected check', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final theme = buildBulkaTheme();
    final colors = theme.extension<BulkaThemeColors>()!;
    final selectedAvatar = customerAvatarOptions.firstWhere(
      (option) => option.key == 'kz_male_01',
    );
    String? selection;

    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                key: const ValueKey('open-avatar-picker'),
                onPressed: () async {
                  selection = await showCustomerAvatarPicker(
                    context,
                    selectedKey: selectedAvatar.key,
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('open-avatar-picker')));
    await tester.pumpAndSettle();

    final closeFinder = find.byKey(const ValueKey('customer-avatar-close'));
    expect(closeFinder, findsOneWidget);
    expect(find.byIcon(Icons.close_rounded), findsOneWidget);
    expect(tester.getSize(closeFinder).width, greaterThanOrEqualTo(48));
    expect(tester.getSize(closeFinder).height, greaterThanOrEqualTo(48));

    final closeButton = tester.widget<IconButton>(closeFinder);
    final foreground = closeButton.style!.foregroundColor!.resolve({})!;
    final background = closeButton.style!.backgroundColor!.resolve({})!;
    expect(foreground, theme.colorScheme.onSecondaryContainer);
    expect(background, theme.colorScheme.secondaryContainer);
    expect(_contrastRatio(foreground, background), greaterThanOrEqualTo(3));
    expect(find.byTooltip('Закрыть'), findsOneWidget);

    final themedIconForeground = theme.iconButtonTheme.style!.foregroundColor!
        .resolve({})!;
    final disabledIconForeground = theme.iconButtonTheme.style!.foregroundColor!
        .resolve({WidgetState.disabled})!;
    expect(
      _contrastRatio(
        themedIconForeground,
        theme.colorScheme.secondaryContainer,
      ),
      greaterThanOrEqualTo(3),
    );
    expect(disabledIconForeground, isNot(themedIconForeground));
    expect(disabledIconForeground.a, lessThan(themedIconForeground.a));

    final selectedIndicator = find.byKey(
      ValueKey('avatar-selected-indicator-${selectedAvatar.key}'),
    );
    expect(selectedIndicator, findsOneWidget);
    final selectedHitPassthrough = find.byKey(
      ValueKey('avatar-selected-hit-passthrough-${selectedAvatar.key}'),
    );
    expect(selectedHitPassthrough, findsOneWidget);
    expect(
      tester.widget<IgnorePointer>(selectedHitPassthrough).ignoring,
      isTrue,
    );
    expect(
      find.descendant(of: selectedHitPassthrough, matching: selectedIndicator),
      findsOneWidget,
    );
    final selectedCheck = tester.widget<Icon>(
      find.descendant(
        of: selectedIndicator,
        matching: find.byIcon(Icons.check_rounded),
      ),
    );
    expect(selectedCheck.color, colors.brandBrown);
    expect(
      _contrastRatio(selectedCheck.color!, colors.brandGold),
      greaterThanOrEqualTo(3),
    );
    expect(find.byIcon(Icons.check_rounded), findsOneWidget);

    final selectedSemantics = tester.widget<Semantics>(
      find
          .ancestor(
            of: find.byKey(ValueKey('avatar-option-${selectedAvatar.key}')),
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is Semantics && widget.properties.label == 'Аватар 7',
            ),
          )
          .first,
    );
    expect(selectedSemantics.properties.button, isTrue);
    expect(selectedSemantics.properties.selected, isTrue);
    expect(selectedSemantics.properties.onTap, isNotNull);

    await tester.tap(
      find.byKey(ValueKey('avatar-option-${customerAvatarOptions[7].key}')),
    );
    await tester.pumpAndSettle();
    expect(selection, customerAvatarOptions[7].key);
  });

  testWidgets(
    'avatar picker remains usable on a narrow screen with large text',
    (tester) async {
      tester.view.physicalSize = const Size(375, 667);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async {
                    await showCustomerAvatarPicker(
                      context,
                      selectedKey: customerAvatarOptions.last.key,
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final closeFinder = find.byKey(const ValueKey('customer-avatar-close'));
      final closeRect = tester.getRect(closeFinder);
      final titleRect = tester.getRect(find.text('Выберите аватар'));
      expect(closeRect.left, greaterThanOrEqualTo(0));
      expect(closeRect.right, lessThanOrEqualTo(375));
      expect(titleRect.right, lessThanOrEqualTo(closeRect.left));
      expect(find.text('Выберите аватар'), findsOneWidget);
      await tester.drag(
        find.byKey(const ValueKey('customer-avatar-grid')),
        const Offset(0, -360),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(ValueKey('avatar-option-${customerAvatarOptions.last.key}')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          ValueKey(
            'avatar-selected-indicator-${customerAvatarOptions.last.key}',
          ),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);

      await tester.tap(closeFinder);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('customer-avatar-grid')), findsNothing);
    },
  );
}
