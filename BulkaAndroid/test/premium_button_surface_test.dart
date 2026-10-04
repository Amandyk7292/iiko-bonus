import 'dart:convert';
import 'dart:io' as io;
import 'dart:ui' as ui;

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _capture = bool.fromEnvironment('BULKA_PREMIUM_UI_CAPTURE');

Future<void> _captureFonts(WidgetTester tester) async {
  if (!_capture) return;
  await tester.runAsync(() async {
    for (final entry in {
      'Montserrat': 'assets/fonts/Montserrat-Regular-subset.ttf',
      'MontserratBold': 'assets/fonts/Montserrat-Bold-subset.ttf',
      'MaterialIcons': 'assets/fonts/BulkaIcons.ttf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load(entry.value))).load();
    }
  });
}

Future<void> _captureFamily(
  WidgetTester tester,
  GlobalKey key,
  String locale,
) async {
  if (!_capture) return;
  await tester.runAsync(() async {
    await precacheImage(
      const AssetImage('assets/brand/loyalty_background.jpg'),
      key.currentContext!,
    );
  });
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 2);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    await io.Directory('outputs/premium-ui').create(recursive: true);
    await io.File(
      'outputs/premium-ui/family-$locale-320-text200.png',
    ).writeAsBytes(png!.buffer.asUint8List());
    image.dispose();
  });
}

Widget _app(Widget child, {double scale = 1}) => MaterialApp(
  theme: buildBulkaTheme(),
  home: Scaffold(body: child),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(scale), disableAnimations: true),
    child: child!,
  ),
);

double _contrast(Color a, Color b) {
  final values = [a.computeLuminance(), b.computeLuminance()]..sort();
  return (values.last + 0.05) / (values.first + 0.05);
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  test(
    'premium finishes keep readable brand labels across their full gradient',
    () {
      const brown = Color(0xFF532814);
      for (final color in [
        ...BulkaButtonSurface.goldGradient.colors,
        ...BulkaButtonSurface.ivoryGradient.colors,
      ]) {
        expect(_contrast(brown, color), greaterThanOrEqualTo(4.5));
      }
      for (final color in BulkaButtonSurface.chocolateGradient.colors) {
        expect(_contrast(Colors.white, color), greaterThanOrEqualTo(4.5));
      }
    },
  );

  testWidgets('action theme adds finishes while legal text links stay light', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        Column(
          children: [
            FilledButton(onPressed: () {}, child: const Text('Primary')),
            ElevatedButton(onPressed: () {}, child: const Text('Secondary')),
            OutlinedButton(onPressed: () {}, child: const Text('Outline')),
            TextButton(onPressed: () {}, child: const Text('Terms')),
          ],
        ),
      ),
    );
    expect(find.byType(BulkaButtonSurface), findsNWidgets(3));
    for (final type in [FilledButton, ElevatedButton, OutlinedButton]) {
      final finder = find.byType(type);
      expect(tester.getSize(finder).height, greaterThanOrEqualTo(48));
      expect(
        find.descendant(of: finder, matching: find.byType(BulkaButtonSurface)),
        findsOneWidget,
      );
    }
    expect(
      find.descendant(
        of: find.byType(TextButton),
        matching: find.byType(BulkaButtonSurface),
      ),
      findsNothing,
    );
    expect(
      buildBulkaTheme().filledButtonTheme.style!.textStyle!
          .resolve({})!
          .fontFamily,
      'MontserratBold',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'local danger and transparent composite backgrounds are preserved',
    (tester) async {
      const danger = Color(0xFFB83232);
      await tester.pumpWidget(
        _app(
          Column(
            children: [
              FilledButton(
                key: const ValueKey('danger'),
                onPressed: () {},
                style: FilledButton.styleFrom(
                  backgroundColor: danger,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Remove'),
              ),
              FilledButton(
                key: const ValueKey('transparent'),
                onPressed: () {},
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.transparent,
                ),
                child: const Text('Own finish'),
              ),
            ],
          ),
        ),
      );
      final surface = tester.widget<BulkaButtonSurface>(
        find.byType(BulkaButtonSurface),
      );
      expect(surface.baseColor, danger);
      final ink = tester.widget<Ink>(
        find.descendant(
          of: find.byKey(const ValueKey('danger')),
          matching: find.byType(Ink),
        ),
      );
      final finish =
          (ink.decoration! as BoxDecoration).gradient! as LinearGradient;
      expect(finish.colors[1], danger);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('transparent')),
          matching: find.byType(BulkaButtonSurface),
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'cashier actions preserve inherited white labels and semantic contrast',
    (tester) async {
      const danger = Color(0xFFD14343);
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme(),
          home: Scaffold(
            body: Column(
              children: [
                FilledButton(onPressed: () {}, child: const Text('Primary')),
                FilledButton(
                  onPressed: () {},
                  style: FilledButton.styleFrom(backgroundColor: danger),
                  child: const Text('Remove'),
                ),
                OutlinedButton(
                  onPressed: () {},
                  child: const Text('Secondary'),
                ),
              ],
            ),
          ),
        ),
      );
      final surfaces = tester
          .widgetList<BulkaButtonSurface>(find.byType(BulkaButtonSurface))
          .toList();
      expect(surfaces, hasLength(3));
      expect(surfaces[0].foregroundColor, Colors.white);
      expect(surfaces[1].foregroundColor, Colors.white);
      expect(surfaces[1].baseColor, danger);
      final finishes = tester.widgetList<Ink>(find.byType(Ink)).toList();
      for (var index = 0; index < surfaces.length; index++) {
        final material = tester
            .element(find.byType(BulkaButtonSurface).at(index))
            .findAncestorWidgetOfExactType<Material>()!;
        final shape = material.shape! as RoundedRectangleBorder;
        expect(
          surfaces[index].radius,
          shape.borderRadius.resolve(TextDirection.ltr).topLeft.x,
          reason:
              'The finish and Material outline must share the same corners.',
        );
        final finish =
            (finishes[index].decoration! as BoxDecoration).gradient!
                as LinearGradient;
        for (final color in finish.colors) {
          expect(
            _contrast(surfaces[index].foregroundColor!, color),
            greaterThanOrEqualTo(4.5),
          );
        }
      }
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('keyboard focus is visible and disabled actions cannot fire', (
    tester,
  ) async {
    final states = WidgetStatesController();
    addTearDown(states.dispose);
    var taps = 0;
    await tester.pumpWidget(
      _app(
        FilledButton(
          onPressed: () => taps++,
          statesController: states,
          child: const Text('Continue'),
        ),
      ),
    );
    states.update(WidgetState.focused, true);
    await tester.pump();
    final ink = tester.widget<Ink>(find.byType(Ink));
    expect((ink.decoration! as BoxDecoration).border!.top.width, 1.6);
    await tester.tap(find.byType(FilledButton));
    expect(taps, 1);
    await tester.pumpWidget(
      _app(const FilledButton(onPressed: null, child: Text('Continue'))),
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<BulkaButtonSurface>(find.byType(BulkaButtonSurface))
          .disabled,
      isTrue,
    );
    await tester.tap(find.byType(FilledButton));
    expect(taps, 1);
  });

  testWidgets(
    'loading composite uses one finish and keeps its spinner readable',
    (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        _app(
          GradientButton(
            onPressed: () => taps++,
            loading: true,
            foregroundColor: Colors.white,
            gradient: BulkaButtonSurface.chocolateGradient,
            child: const Text('Save'),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(BulkaButtonSurface), findsOneWidget);
      expect(
        tester
            .widget<BulkaButtonSurface>(find.byType(BulkaButtonSurface))
            .disabled,
        isTrue,
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(
        tester
            .widget<CircularProgressIndicator>(
              find.byType(CircularProgressIndicator),
            )
            .color,
        const Color(0xFF532814).withValues(alpha: 0.65),
      );
      await tester.tap(find.byType(FilledButton));
      expect(taps, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'family choices wrap on 320 px with large Russian and Kazakh text',
    (tester) async {
      await _captureFonts(tester);
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 850);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'success': true,
              'groupId': 'family-proof',
              'isOwner': true,
              'sharedBalance': 8500,
              'members': [
                {
                  'id': 'adult-proof',
                  'name': 'Мария',
                  'relation': 'wife',
                  'isChild': false,
                },
                {
                  'id': 'child-proof',
                  'name': 'Алина',
                  'relation': 'child',
                  'isChild': true,
                },
              ],
              'invitations': [],
              'sentInvitations': [],
            }),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );
      addTearDown(api.dispose);
      for (final locale in ['ru', 'kk']) {
        final boundary = GlobalKey();
        appLanguageNotifier.value = locale;
        await tester.pumpWidget(
          _app(
            RepaintBoundary(
              key: boundary,
              child: FamilyScreen(
                key: ValueKey(locale),
                api: api,
                onRefreshProfile: () async {},
              ),
            ),
            scale: 2,
          ),
        );
        await tester.pumpAndSettle();
        for (final key in ['family-invite', 'family-add-child']) {
          final button = find.byKey(ValueKey(key));
          expect(tester.getSize(button).height, greaterThanOrEqualTo(56));
          expect(
            find.descendant(
              of: button,
              matching: find.byType(BulkaButtonSurface),
            ),
            findsOneWidget,
          );
        }
        expect(tester.takeException(), isNull);
        await _captureFamily(tester, boundary, locale);
        await tester.tap(find.byKey(const ValueKey('family-invite')));
        await tester.pumpAndSettle();
        expect(find.byType(FamilyFormScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
    },
  );
}
