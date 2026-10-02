import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  double width = 320,
  double scale = 2,
}) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: child,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void _expectContained(WidgetTester tester, Finder text, Finder control) {
  final paragraph = tester.renderObject<RenderParagraph>(text);
  expect(paragraph.didExceedMaxLines, isFalse);
  final textRect = tester.getRect(text);
  final controlRect = tester.getRect(control);
  expect(textRect.left, greaterThanOrEqualTo(controlRect.left));
  expect(textRect.right, lessThanOrEqualTo(controlRect.right));
  expect(textRect.top, greaterThanOrEqualTo(controlRect.top + 8));
  expect(textRect.bottom, lessThanOrEqualTo(controlRect.bottom - 8));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await (FontLoader('Montserrat')..addFont(
          rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'),
        ))
        .load();
    await (FontLoader('MontserratBold')
          ..addFont(rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf')))
        .load();
  });
  tearDown(() => appLanguageNotifier.value = 'ru');

  for (final language in ['ru', 'kk']) {
    testWidgets('$language history action grows around large wrapped text', (
      tester,
    ) async {
      appLanguageNotifier.value = language;
      var taps = 0;
      await _pump(
        tester,
        buildLoyaltyHistoryButtonForTest(onPressed: () => taps++),
      );
      final label = find.text('balance_history_btn'.tr);
      final button = find.byType(FilledButton);
      _expectContained(tester, label, button);
      expect(tester.getSize(button).height, greaterThan(58));
      await tester.tap(button);
      expect(taps, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      '$language filter actions keep complete labels at large scale',
      (tester) async {
        appLanguageNotifier.value = language;
        var applied = 0;
        var reset = 0;
        await _pump(
          tester,
          buildCatalogFilterActionsForTest(
            onApply: () => applied++,
            onReset: () => reset++,
          ),
        );
        final apply = find.byKey(const ValueKey('catalog-filter-apply'));
        final resetButton = find.byKey(const ValueKey('catalog-filter-reset'));
        _expectContained(tester, find.text('catalog_apply'.tr), apply);
        _expectContained(tester, find.text('catalog_reset'.tr), resetButton);
        expect(
          tester.getRect(apply).bottom,
          lessThan(tester.getRect(resetButton).top),
        );
        for (final key in ['catalog_apply', 'catalog_reset']) {
          final label = key.tr;
          if (label.contains(' ')) continue;
          final paragraph = tester.renderObject<RenderParagraph>(
            find.text(label),
          );
          final painter = TextPainter(
            text: paragraph.text,
            textDirection: paragraph.textDirection,
            textScaler: paragraph.textScaler,
          )..layout(maxWidth: paragraph.size.width);
          expect(painter.computeLineMetrics(), hasLength(1), reason: label);
          painter.dispose();
        }
        await tester.tap(apply);
        await tester.tap(resetButton);
        expect(applied, 1);
        expect(reset, 1);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '$language checkout total separates large values without clipping',
      (tester) async {
        appLanguageNotifier.value = language;
        final label = 'checkout_total'.tr;
        const value = '999 999 999 ₸';
        await _pump(
          tester,
          buildCheckoutTotalRowForTest(
            label: label,
            value: value,
            emphasized: true,
          ),
        );
        for (final text in [label, value]) {
          final paragraph = tester.renderObject<RenderParagraph>(
            find.text(text),
          );
          expect(paragraph.didExceedMaxLines, isFalse);
          final rect = tester.getRect(find.text(text));
          expect(rect.left, greaterThanOrEqualTo(20));
          expect(rect.right, lessThanOrEqualTo(300));
        }
        expect(
          tester.getRect(find.text(label)).bottom,
          lessThan(tester.getRect(find.text(value)).top),
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'regular filter actions and checkout totals keep their row layout',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      await _pump(
        tester,
        buildCatalogFilterActionsForTest(onApply: () {}, onReset: () {}),
        width: 430,
        scale: 1,
      );
      final apply = tester.getRect(
        find.byKey(const ValueKey('catalog-filter-apply')),
      );
      final reset = tester.getRect(
        find.byKey(const ValueKey('catalog-filter-reset')),
      );
      expect(apply.top, reset.top);
      expect(apply.height, greaterThanOrEqualTo(50));
      expect(reset.height, greaterThanOrEqualTo(50));
      await _pump(
        tester,
        buildCheckoutTotalRowForTest(
          label: 'Итоговая цена',
          value: '1 120 ₸',
          emphasized: true,
        ),
        width: 430,
        scale: 1,
      );
      expect(
        tester.getRect(find.text('Итоговая цена')).center.dy,
        tester.getRect(find.text('1 120 ₸')).center.dy,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
