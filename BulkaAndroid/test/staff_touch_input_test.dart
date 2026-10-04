import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'cashier_catalog_test.dart' show StockApi;
import 'cashier_workspace_test.dart' show CashierFixtureApi;

Finder key(String value) => find.byKey(ValueKey('staff-touch-key-$value'));

void main() {
  setUpAll(() async {
    await (FontLoader('Montserrat')..addFont(
          rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'),
        ))
        .load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('assets/fonts/BulkaIcons.ttf'))).load();
  });
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
  });

  test('desktop input only opts in through an exact query flag', () {
    for (final path in ['/?desktop=1', '/?kiosk=1']) {
      final uri = Uri.parse(path);
      expect(isStaffDesktopUri(uri), isTrue);
      expect(
        shouldProbeStaffSession(
          isWeb: true,
          isAuthenticated: false,
          currentUri: uri,
        ),
        isTrue,
      );
    }
    for (final path in ['/', '/profile', '/?desktop=0', '/?desktop=true']) {
      expect(isStaffDesktopUri(Uri.parse(path)), isFalse);
    }
  });

  testWidgets(
    'numeric touch edits replace selection and enforce kilogram precision',
    (tester) async {
      final controller = TextEditingController(text: '0')
        ..selection = const TextSelection(baseOffset: 0, extentOffset: 1);
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme(),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: StaffTouchKeyboard(
                controller: controller,
                numeric: true,
                decimal: true,
                inputFormatters: [LengthLimitingTextInputFormatter(10)],
              ),
            ),
          ),
        ),
      );
      await tester.tap(key('2'));
      expect(controller.text, '2');
      await tester.tap(key('.'));
      for (final digit in ['1', '2', '5', '6']) {
        await tester.tap(key(digit));
      }
      expect(controller.text, '2.125');
      await tester.tap(key('.'));
      expect(controller.text, '2.125');
      controller.selection = const TextSelection(
        baseOffset: 2,
        extentOffset: 5,
      );
      await tester.tap(key('3'));
      expect(controller.text, '2.3');
      await tester.tap(key('backspace'));
      expect(controller.text, '2.');
      await tester.tap(key('clear'));
      expect(controller.text, isEmpty);
      expect(tester.getSize(key('7')).height, greaterThanOrEqualTo(48));
      expect(tester.takeException(), isNull);
    },
  );

  for (final size in [const Size(390, 844), const Size(1024, 600)]) {
    testWidgets('cashier saves kilogram stock with touch only at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = StockApi()..unit = 'кг';
      addTearDown(api.eventsFeed.close);
      addTearDown(api.close);
      await tester.pumpWidget(
        StaffDesktopScope(
          enabled: true,
          child: MaterialApp(
            theme: staffTheme(),
            home: Scaffold(body: CashierCatalog(api: api)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, '5'));
      await tester.pumpAndSettle();
      expect(find.text('Единица измерения'), findsNothing);
      await tester.tap(find.text('Исправили'));
      await tester.pumpAndSettle();
      final input = find.byType(TextField).last;
      expect(tester.widget<TextField>(input).readOnly, isTrue);
      for (final digit in ['1', '.', '2', '5']) {
        await tester.ensureVisible(key(digit));
        await tester.tap(key(digit));
        await tester.pump();
      }
      expect(tester.widget<TextField>(input).controller!.text, '1.25');
      final save = find.widgetWithText(FilledButton, 'Сохранить');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(api.changes, isEmpty);
      await tester.tap(
        find.descendant(of: find.byType(AlertDialog), matching: save),
      );
      await tester.pumpAndSettle();
      expect(api.changes.single, {
        'expectedRevision': 1,
        'sourceQuantity': 1.25,
        'stockReason': 'correction',
        'unit': 'кг',
        'operationId': isA<String>(),
      });
      expect(find.widgetWithText(OutlinedButton, '1.25'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets(
    'text keyboard supports Kazakh, spaces and password symbols; cancel discards',
    (tester) async {
      final controller = TextEditingController(text: 'before');
      addTearDown(controller.dispose);
      final changes = <String>[];
      await tester.pumpWidget(
        StaffDesktopScope(
          enabled: true,
          child: MaterialApp(
            theme: staffTheme(),
            home: Scaffold(
              body: StaffTouchField(
                controller: controller,
                onChanged: changes.add,
                decoration: const InputDecoration(labelText: 'Поиск'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();
      await tester.tap(key('а'));
      await tester.tap(find.byKey(const ValueKey('staff-touch-cancel')));
      await tester.pumpAndSettle();
      expect(controller.text, 'before');
      expect(changes, isEmpty);
      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('staff-touch-layout-KK')));
      await tester.pump();
      await tester.tap(key('ә'));
      await tester.ensureVisible(key(' '));
      await tester.tap(key(' '));
      await tester.ensureVisible(
        find.byKey(const ValueKey('staff-touch-layout-123')),
      );
      await tester.tap(find.byKey(const ValueKey('staff-touch-layout-123')));
      await tester.pump();
      await tester.tap(key('_'));
      await tester.tap(find.byKey(const ValueKey('staff-touch-done')));
      await tester.pumpAndSettle();
      expect(controller.text, 'ә _');
      expect(changes, ['ә _']);
      expect(tester.takeException(), isNull);
    },
  );

  for (final lang in ['ru', 'kk']) {
    for (final size in [const Size(320, 568), const Size(640, 360)]) {
      testWidgets(
        'touch keyboard keeps input and actions visible at $size $lang 200%',
        (tester) async {
          appLanguageNotifier.value = lang;
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await tester.pumpWidget(
            StaffDesktopScope(
              enabled: true,
              child: MaterialApp(
                theme: staffTheme(),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: const TextScaler.linear(2)),
                  child: child!,
                ),
                home: Scaffold(
                  body: StaffTouchField(
                    decoration: InputDecoration(
                      labelText: lang == 'kk'
                          ? 'Тауар атауы'
                          : 'Название товара',
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.tap(find.byType(TextField));
          await tester.pumpAndSettle();
          final done = tester.getRect(
            find.byKey(const ValueKey('staff-touch-done')),
          );
          final draft = tester.getRect(
            find.byKey(const ValueKey('staff-touch-draft')),
          );
          expect(draft.bottom, lessThan(done.top));
          expect(done.bottom, lessThanOrEqualTo(size.height));
          expect(tester.takeException(), isNull);
          await tester.tap(find.byKey(const ValueKey('staff-touch-cancel')));
          await tester.pumpAndSettle();
        },
      );
    }
  }

  testWidgets('normal website keeps platform editing and no touch keyboard', (
    tester,
  ) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: StaffTouchField(controller: controller)),
      ),
    );
    expect(tester.widget<TextField>(find.byType(TextField)).readOnly, isFalse);
    await tester.enterText(find.byType(TextField), 'обычный ввод');
    expect(controller.text, 'обычный ввод');
    expect(find.byType(StaffTouchKeyboard), findsNothing);
  });

  testWidgets(
    'desktop login works entirely by touch and enters assigned cashier',
    (tester) async {
      tester.view.physicalSize = const Size(1366, 768);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      FlutterSecureStorage.setMockInitialValues({});
      final session = StaffAccountSession(
        api: CashierFixtureApi(),
        readPortalCookie: () async => null,
        clearPortalCookie: () async {},
        loginClient: AdminPortalLoginClient(
          installCookie: (_, _) async {},
          client: MockClient((request) async {
            final body = jsonDecode(request.body);
            expect(body['username'], 'cashier');
            expect(body['password'], 'p_7');
            return http.Response(
              '{"user":{"username":"cashier","role":"cashier"}}',
              200,
              headers: {
                'set-cookie':
                    'bulka_admin=cashier-fixture; Path=/admin; HttpOnly; Secure; SameSite=Strict',
              },
            );
          }),
        ),
      );
      final cart = CartProvider();
      addTearDown(session.dispose);
      addTearDown(cart.dispose);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: BulkaBonusApp(
            appReleaseChecksEnabled: false,
            nativeCashierPushEnabled: false,
            staffSession: session,
            staffDesktopModeOverride: true,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.byType(StaffDesktopLogin), findsOneWidget);
      expect(find.byType(MainShell), findsNothing);
      await tester.tap(find.byKey(const ValueKey('auth-admin-username')));
      await tester.pumpAndSettle();
      for (final letter in 'cashier'.split('')) {
        await tester.tap(key(letter));
      }
      await tester.tap(find.byKey(const ValueKey('staff-touch-done')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('auth-admin-password')));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('staff-touch-draft')))
            .obscureText,
        isTrue,
      );
      await tester.tap(key('p'));
      await tester.tap(find.byKey(const ValueKey('staff-touch-layout-123')));
      await tester.pump();
      await tester.tap(key('_'));
      await tester.tap(key('7'));
      await tester.tap(find.byKey(const ValueKey('staff-touch-done')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('auth-admin-submit')));
      await tester.pumpAndSettle();
      expect(find.byType(CashierWorkspace), findsOneWidget);
      expect(session.isCashier, isTrue);
      expect(find.byType(MainShell), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'staff full window keeps actual resolution instead of phone frame',
    (tester) async {
      tester.view.physicalSize = const Size(1366, 768);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Size? size;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => BulkaDesktopPhoneViewport(
            desktopModeOverride: true,
            staffDesktopMode: true,
            child: child!,
          ),
          home: Builder(
            builder: (context) {
              size = MediaQuery.sizeOf(context);
              return const Scaffold();
            },
          ),
        ),
      );
      expect(size, const Size(1366, 768));
      expect(
        find.byKey(const ValueKey('bulka-desktop-phone-frame')),
        findsNothing,
      );
    },
  );
}
