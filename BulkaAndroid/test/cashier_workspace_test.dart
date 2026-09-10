import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CashierFixtureApi extends StaffApiClient {
  bool noBranch = false;
  final requests = <String>[];
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) =>
      const Stream.empty();
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    requests.add('$method $endpoint');
    if (endpoint == '/scope') {
      return {
        'locations': noBranch
            ? []
            : [
                {'id': 'branch-1', 'name': 'ЖК Дукат'},
              ],
        'selectedBranchId': 'branch-1',
      };
    }
    expect(branchId, 'branch-1');
    return {'orders': [], 'total': 0};
  }
}

class BadgeFixtureApi extends CashierFixtureApi {
  final feed = StreamController<Map<String, dynamic>>.broadcast();
  Map<String, int> counters = {'newOrders': 7, 'preparing': 3, 'preorders': 2};
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) => feed.stream;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    final result = await super.request(
      endpoint,
      method: method,
      body: body,
      authenticated: authenticated,
      headers: headers,
      query: query,
    );
    if (endpoint.startsWith('/kitchen')) {
      return {...result as Map, 'counters': counters};
    }
    return result;
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
    FlutterSecureStorage.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  testWidgets('branch counters stay live on stop list and disappear at zero', (
    tester,
  ) async {
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
    final nav = find.byType(NavigationBar);
    await tester.tap(
      find.descendant(of: nav, matching: find.text('Стоп-лист')),
    );
    await tester.pumpAndSettle();
    Finder badge(String id) => find.byKey(ValueKey(id));
    expect(
      find.descendant(
        of: badge('cashier-orders-count'),
        matching: find.text('7'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: badge('cashier-kitchen-count'),
        matching: find.text('3'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: badge('cashier-preorders-count'),
        matching: find.text('2'),
      ),
      findsOneWidget,
    );
    api.counters = {'newOrders': 0, 'preparing': 4, 'preorders': 0};
    api.feed.add({'type': 'order.updated', 'id': 'accepted'});
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: badge('cashier-orders-count'),
        matching: find.byType(Badge),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: badge('cashier-preorders-count'),
        matching: find.byType(Badge),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: badge('cashier-kitchen-count'),
        matching: find.text('4'),
      ),
      findsOneWidget,
    );
    expect(tester.widget<NavigationBar>(nav).selectedIndex, 2);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'cashier has three native tabs, branch scope and no privileged actions',
    (tester) async {
      final api = CashierFixtureApi();
      addTearDown(api.close);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Widget app(int kitchenRequest) => MaterialApp(
        theme: buildBulkaTheme(),
        home: CashierWorkspace(
          api: api,
          user: const {
            'username': 'cashier',
            'role': 'cashier',
            'actions': ['*'],
          },
          onLogout: () async {},
          nativePushEnabled: false,
          kitchenRequest: kitchenRequest,
        ),
      );
      await tester.pumpWidget(app(0));
      await tester.pumpAndSettle();
      final nav = tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(
        nav.destinations.whereType<NavigationDestination>().map((d) => d.label),
        ['Заказы', 'Кухня', 'Стоп-лист'],
      );
      expect(find.byType(MainShell), findsNothing);
      expect(find.byType(AdminPortalScreen), findsNothing);
      expect(find.byType(StaffOrders), findsOneWidget);
      expect(find.text('ЖК Дукат'), findsOneWidget);
      expect(
        api.requests.every(
          (r) => [
            '/scope',
            '/orders',
            '/kitchen',
            '/staff/catalog',
          ].any((p) => r.startsWith('GET $p')),
        ),
        isTrue,
      );
      await tester.pumpWidget(
        app(1),
      ); // The root routes a push tap by this request.
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      final kitchen = tester.widget<StaffKitchen>(find.byType(StaffKitchen));
      expect(kitchen.canEdit, isTrue);
      expect(kitchen.canCancel, isFalse);
      expect(find.byType(AdminPortalScreen), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('missing assigned branch does not fetch unscoped orders', (
    tester,
  ) async {
    final api = CashierFixtureApi()..noBranch = true;
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: CashierWorkspace(
          api: api,
          user: const {'role': 'cashier'},
          onLogout: () async {},
          nativePushEnabled: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(api.requests, ['GET /scope']);
    expect(find.byType(StaffOrders), findsNothing);
    expect(find.byType(StaffKitchen), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'verified staff profile removes guest prompt and places admin entry below language',
    (tester) async {
      final session = StaffAccountSession(readPortalCookie: () async => null)
        ..user = {'username': 'admin', 'role': 'admin'};
      addTearDown(session.dispose);
      var opened = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: AccountProfileScreen(
            staff: session,
            onSignIn: () async =>
                throw StateError('Staff must not see customer login prompt'),
            onOpenStaffPortal: () async => opened++,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('admin'), findsOneWidget);
      expect(find.text('Войдите в Bulka'), findsNothing);
      expect(find.text('Войти по номеру телефона'), findsNothing);
      final languageY = tester.getTopLeft(find.text('Выберите язык')).dy;
      final portalY = tester.getTopLeft(find.text('Админ панель')).dy;
      expect(portalY, greaterThan(languageY));
      expect(portalY - languageY, lessThan(90));
      await tester.tap(find.text('Админ панель'));
      await tester.pump();
      expect(opened, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
