import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'cashier_workspace_test.dart' show BadgeFixtureApi;
import 'helpers/selected_bakery_locations.dart';

class _MotionApi extends BulkaApiClient {
  _MotionApi(http.Client client) : super(client: client);

  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();

  @override
  Future<List<PromoStory>> getStories() async => const [];
}

Finder _slot(int index) =>
    find.byKey(ValueKey('tab-slot-$index'), skipOffstage: false);

double _position(WidgetTester tester, int index) => tester
    .widget<SlideTransition>(
      find.byKey(ValueKey('tab-slide-$index'), skipOffstage: false),
    )
    .position
    .value
    .dx;

Map<int, double> _paintedPositions(WidgetTester tester, int count) => {
  for (var index = 0; index < count; index++)
    if (_slot(index).evaluate().isNotEmpty &&
        !tester.widget<Offstage>(_slot(index)).offstage)
      index: _position(tester, index),
};

void _expectNoGap(WidgetTester tester, int count) {
  // Every tab fills the same viewport. Its painted horizontal interval is
  // [dx, dx + 1]; a union covering [0, 1] proves no empty strip is exposed.
  final positions = _paintedPositions(tester, count).values.toList()..sort();
  expect(positions, isNotEmpty);
  expect(positions.first, lessThanOrEqualTo(0.000001));
  var covered = positions.first + 1;
  for (final position in positions.skip(1)) {
    expect(position, lessThanOrEqualTo(covered + 0.000001));
    if (position + 1 > covered) covered = position + 1;
  }
  expect(covered, greaterThanOrEqualTo(0.999999));
}

void _expectGuards(
  WidgetTester tester, {
  required int active,
  required int count,
  Set<int> alwaysTicking = const {},
}) {
  for (var index = 0; index < count; index++) {
    final slot = _slot(index);
    if (slot.evaluate().isEmpty) continue;
    T guard<T extends Widget>() => tester.widget<T>(
      find
          .descendant(
            of: slot,
            matching: find.byType(T, skipOffstage: false),
            skipOffstage: false,
          )
          .first,
    );
    expect(guard<IgnorePointer>().ignoring, index != active);
    expect(guard<ExcludeSemantics>().excluding, index != active);
    expect(guard<ExcludeFocus>().excluding, index != active);
    expect(guard<HeroMode>().enabled, index == active);
    expect(
      guard<TickerMode>().enabled,
      index == active || alwaysTicking.contains(index),
    );
  }
}

Future<void> _openCustomer(
  WidgetTester tester, {
  bool reduced = false,
  TargetPlatform platform = TargetPlatform.android,
}) async {
  _usePhoneViewport(tester);
  SharedPreferences.setMockInitialValues({
    'selected_order_type': 'pickup',
    'selected_bakery_location_id_pickup': 'branch-one',
    'selected_bakery_location_pickup': 'Филиал',
  });
  clientRouteNotifier.value = Uri(path: '/');
  final client = MockClient((request) async {
    if (request.url.path == '/api/guest/locations') {
      return selectedBakeryLocationsResponse();
    }
    return http.Response(
      jsonEncode({'success': true, 'categories': [], 'products': []}),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
  final api = _MotionApi(client);
  final cart = CartProvider();
  await cart.restored;
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    clientRouteNotifier.value = Uri(path: '/');
  });
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: cart,
      child: MaterialApp(
        theme: buildBulkaTheme().copyWith(platform: platform),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
          child: child!,
        ),
        home: MainShell(
          api: api,
          customer: null,
          transactions: const [],
          onLogout: () async {},
          onRefreshProfile: () async {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void _usePhoneViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _selectCustomer(WidgetTester tester, int index) async {
  await tester.tap(find.byKey(ValueKey('nav-$index')));
  await tester.pump();
}

Duration _elapsedForProgress(double desired) {
  var lower = 0.0, upper = 1.0;
  for (var iteration = 0; iteration < 40; iteration++) {
    final middle = (lower + upper) / 2;
    if (Curves.easeInOutCubic.transform(middle) < desired) {
      lower = middle;
    } else {
      upper = middle;
    }
  }
  return Duration(microseconds: (420000 * (lower + upper) / 2).round());
}

Future<void> _selectCashier(WidgetTester tester, String label) async {
  await tester.tap(
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label)),
  );
  await tester.pump();
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets(
      'opposite-side painted destination keeps coverage on complex reversal: $platform',
      (tester) async {
        await _openCustomer(tester, platform: platform);
        await _selectCustomer(tester, 2);
        await tester.pump(_elapsedForProgress(0.1));
        _expectNoGap(tester, 5);
        await _selectCustomer(tester, 1);
        await tester.pump(_elapsedForProgress(0.9));
        _expectNoGap(tester, 5);
        final before = _paintedPositions(tester, 5);
        // Logical 1→0 is backwards, but slot 0 is already painted on the right.
        // Index-only direction used to expose >40% of the viewport mid-slide.
        expect(before[0], greaterThan(0.8));
        expect(before[1], lessThan(0));
        await _selectCustomer(tester, 0);
        for (final entry in before.entries) {
          expect(_position(tester, entry.key), closeTo(entry.value, 0.000001));
        }
        _expectGuards(tester, active: 0, count: 5);
        for (var frame = 0; frame < 21; frame++) {
          _expectNoGap(tester, 5);
          await tester.pump(const Duration(milliseconds: 20));
        }
        await tester.pump(const Duration(milliseconds: 1));
        expect(_paintedPositions(tester, 5), {0: 0.0});
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'rapid customer tabs preserve pixels and never expose a gap: $platform',
      (tester) async {
        await _openCustomer(tester, platform: platform);
        final home = tester.state(find.byType(HomeScreen));
        await _selectCustomer(tester, 1);
        final catalog = tester.state(find.byType(CatalogScreen));
        await tester.pump(const Duration(milliseconds: 210));
        final beforeThird = _paintedPositions(tester, 5);
        expect(beforeThird.keys, unorderedEquals([0, 1]));
        expect(beforeThird[0], inExclusiveRange(-0.6, -0.4));

        await _selectCustomer(tester, 2);
        expect(_paintedPositions(tester, 5).keys, unorderedEquals([0, 1, 2]));
        for (final entry in beforeThird.entries) {
          expect(_position(tester, entry.key), closeTo(entry.value, 0.000001));
        }
        _expectNoGap(tester, 5);
        _expectGuards(tester, active: 2, count: 5);
        await tester.pump(const Duration(milliseconds: 105));
        _expectNoGap(tester, 5);

        // Reverse before the third tab has finished entering. All currently
        // painted tabs must again retain their exact positions on the first frame.
        final beforeReversal = _paintedPositions(tester, 5);
        await _selectCustomer(tester, 0);
        for (final entry in beforeReversal.entries) {
          expect(_position(tester, entry.key), closeTo(entry.value, 0.000001));
        }
        _expectGuards(tester, active: 0, count: 5);
        for (var frame = 0; frame < 7; frame++) {
          _expectNoGap(tester, 5);
          await tester.pump(const Duration(milliseconds: 60));
        }
        await tester.pump(const Duration(milliseconds: 1));
        expect(_paintedPositions(tester, 5), {0: 0.0});
        expect(tester.state(find.byType(HomeScreen)), same(home));
        expect(
          tester.state(find.byType(CatalogScreen, skipOffstage: false)),
          same(catalog),
        );
        expect(tester.widget<Offstage>(_slot(1)).offstage, isTrue);
        expect(tester.widget<Offstage>(_slot(2)).offstage, isTrue);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'reduced motion settles immediately during quick navigation: $platform',
      (tester) async {
        await _openCustomer(tester, reduced: true, platform: platform);
        for (final index in [1, 2, 0, 2]) {
          await _selectCustomer(tester, index);
          expect(_paintedPositions(tester, 5), {index: 0.0});
          _expectGuards(tester, active: index, count: 5);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'cashier slides without a blank frame and retains the live kitchen',
    (tester) async {
      _usePhoneViewport(tester);
      SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
      final api = BadgeFixtureApi();
      addTearDown(api.close);
      addTearDown(api.feed.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: CashierWorkspace(
            api: api,
            user: const {'role': 'cashier'},
            nativePushEnabled: false,
            onLogout: () async {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final orders = tester.state(find.byType(StaffOrders));
      final kitchen = tester.state(
        find.byType(StaffKitchen, skipOffstage: false),
      );
      final catalog = tester.state(
        find.byType(CashierCatalog, skipOffstage: false),
      );
      expect(find.byType(CashierReports, skipOffstage: false), findsNothing);
      _expectGuards(tester, active: 0, count: 4, alwaysTicking: {1});

      await _selectCashier(tester, 'Стоп-лист');
      expect(_paintedPositions(tester, 4), {0: 0.0, 2: 1.0});
      // The previous whole-body FadeTransition began at opacity zero here.
      final fades = tester.widgetList<FadeTransition>(
        find.ancestor(
          of: find.byType(CashierCatalog),
          matching: find.byType(FadeTransition),
        ),
      );
      expect(fades.every((fade) => fade.opacity.value == 1), isTrue);
      _expectNoGap(tester, 4);
      _expectGuards(tester, active: 2, count: 4, alwaysTicking: {1});
      await tester.pump(const Duration(milliseconds: 210));
      final beforeReports = _paintedPositions(tester, 4);
      await _selectCashier(tester, 'Отчёты');
      for (final entry in beforeReports.entries) {
        expect(_position(tester, entry.key), closeTo(entry.value, 0.000001));
      }
      _expectNoGap(tester, 4);
      await tester.pumpAndSettle();
      final reports = tester.state(find.byType(CashierReports));
      await _selectCashier(tester, 'Заказы');
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(StaffOrders)), same(orders));
      expect(
        tester.state(find.byType(StaffKitchen, skipOffstage: false)),
        same(kitchen),
      );
      expect(
        tester.state(find.byType(CashierCatalog, skipOffstage: false)),
        same(catalog),
      );
      expect(
        tester.state(find.byType(CashierReports, skipOffstage: false)),
        same(reports),
      );
      expect(_paintedPositions(tester, 4), {0: 0.0});
      _expectGuards(tester, active: 0, count: 4, alwaysTicking: {1});
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
