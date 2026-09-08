import 'dart:ui' as ui;
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _LocationsApi extends BulkaApiClient {
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(id: 'one', name: 'Bakery one', city: 'Актау', address: '17'),
    BakeryLocation(
      id: 'two',
      name: 'Bakery two',
      city: 'Астана',
      address: '18',
    ),
  ];
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  tearDown(() {
    appLanguageNotifier.value = 'ru';
  });

  testWidgets(
    'touch outside dismisses keyboard; field controls and switching still work',
    (tester) async {
      final first = FocusNode(), second = FocusNode();
      addTearDown(first.dispose);
      addTearDown(second.dispose);
      var pressed = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme().copyWith(platform: TargetPlatform.iOS),
          builder: (context, child) => BulkaInputDismissal(child: child!),
          home: Scaffold(
            body: Column(
              children: [
                TextField(
                  focusNode: first,
                  decoration: InputDecoration(
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.visibility),
                      onPressed: () => pressed = true,
                    ),
                  ),
                ),
                TextFormField(focusNode: second),
                const Expanded(child: SizedBox.expand(key: ValueKey('blank'))),
              ],
            ),
          ),
        ),
      );
      await tester.tap(find.byType(TextField).first);
      await tester.pump();
      expect(first.hasFocus, isTrue);
      await tester.tap(find.byIcon(Icons.visibility));
      await tester.pump();
      expect(pressed, isTrue);
      expect(first.hasFocus, isTrue);
      await tester.tap(find.byType(TextFormField));
      await tester.pump();
      expect(second.hasFocus, isTrue);
      await tester.tap(
        find.byKey(const ValueKey('blank')),
        warnIfMissed: false,
      );
      await tester.pump();
      expect(second.hasFocus, isFalse);
      expect(tester.testTextInput.isVisible, isFalse);
    },
  );

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets(
      'language sheet fills the home indicator area white in $language',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        tester.view.viewPadding = const FakeViewPadding(bottom: 34);
        tester.view.padding = const FakeViewPadding(bottom: 34);
        addTearDown(tester.view.reset);
        appLanguageNotifier.value = language;
        final boundary = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            builder: (context, child) =>
                RepaintBoundary(key: boundary, child: child),
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => showLanguageBottomSheet(context),
                    child: const Text('Open'),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        final render =
            boundary.currentContext!.findRenderObject()
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await render.toImage();
          final bytes = (await image.toByteData(
            format: ui.ImageByteFormat.rawRgba,
          ))!;
          final offset = ((image.height - 8) * image.width + 10) * 4;
          expect(bytes.buffer.asUint8List(offset, 4), [255, 255, 255, 255]);
          image.dispose();
        });
        expect(find.text('apply_btn'.tr), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'outer locations arrow closes; inner arrow opens cities and clears search',
    (tester) async {
      final api = _LocationsApi();
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                child: const Text('Open'),
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => LocationsScreen(api: api)),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Актау'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'missing');
      await tester.tap(find.text('all_locations'.tr));
      await tester.pumpAndSettle();
      expect(find.text('Астана'), findsOneWidget);
      await tester.tap(find.text('Актау'));
      await tester.pumpAndSettle();
      expect(find.text('Bakery one'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      await tester.tap(find.byTooltip('back_tooltip'.tr));
      await tester.pumpAndSettle();
      expect(find.byType(LocationsScreen), findsNothing);
      expect(find.text('Open'), findsOneWidget);
    },
  );
}
