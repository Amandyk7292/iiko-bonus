import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class FixtureStaffApi extends StaffApiClient {
  FixtureStaffApi({this.role = 'owner'});
  final String role;
  final requests = <String>[];
  @override
  Future<Map<String, dynamic>?> restore() async => {
    'username': 'Fixture',
    'role': role,
    'actions': ['*'],
  };
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
    if (method != 'GET') {
      throw StateError('Unexpected mutation: $method $endpoint');
    }
    return {
      'locations': <Map<String, dynamic>>[],
      'cities': [],
      'profiles': [],
      'configuredUsers': [],
      'customers': [],
      'orders': [],
      'couriers': [],
      'transactions': [],
      'operations': [],
      'items': [],
      'products': [],
      'reviews': [],
      'requests': [],
      'conversations': [],
      'servers': [],
      'stories': [],
      'news': [],
      'cards': [],
      'tiers': [],
      'promotions': [],
      'giftCards': [],
      'automations': [],
      'logs': [],
      'total': 0,
      'rawMenu': {},
      'overrides': {},
      'services': [],
      'queue': [],
      'queues': {},
      'capabilities': {},
      'stats': {},
      'counts': {},
      'config': {},
      'selectedBranchId': null,
      'page': {
        'draft': {
          'profile': {},
          'theme': {},
          'seo': {},
          'blocks': [],
          'defaultLocale': 'ru',
        },
        'draftRevision': 1,
        'publishedRevision': 0,
      },
    };
  }
}

void main() {
  testWidgets('dashboard uses the chosen period in each report section', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({'staff_dashboard_auto': false});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = DashboardFixtureApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: staffTheme(),
        home: Scaffold(body: StaffDashboard(api: api)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.calendar_month_outlined));
    await tester.pumpAndSettle();
    final dialogContext = tester.element(find.byType(DateRangePickerDialog));
    final today = DateTime.now().toUtc().add(const Duration(hours: 5));
    final range = DateTimeRange(
      start: DateTime(today.year, today.month, 1),
      end: DateTime(today.year, today.month, 2),
    );
    // Deliver the native calendar result; subsequent assertions cover each tab's API contract.
    Navigator.of(dialogContext).pop(range);
    await tester.pumpAndSettle();
    for (final tab in [
      'overview',
      'rankings',
      'writeoffs',
      'operations',
      'assortment',
      'balances',
    ]) {
      final picker = tester.widget<StaffPicker>(
        find.byWidgetPredicate(
          (w) => w is StaffPicker && w.options.containsKey('assortment'),
        ),
      );
      picker.onChanged(tab);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: tab);
      if (tab == 'balances') {
        expect(
          api.requests.lastWhere((r) => r.contains('/balances')),
          contains('date=${staffDay(range.end)}'),
        );
      } else {
        final query = api.reports.lastWhere(
          (q) => q['from'] == staffDay(range.start),
        );
        expect(query['to'], staffDay(range.end), reason: tab);
      }
    }
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('successful password login opens the web administration portal', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LoginScreen(
          onLogin: (_, _) async => 'Customer login must not be called',
          onStartRegistration: (_, _, _) async => const OtpRequestResult(),
          onVerifyRegistration: (_, _) async => null,
          onStartPasswordReset: (_, _) async => const OtpRequestResult(),
          onResetPassword: (_, _, _) async => null,
          onAdminLogin: (_, _, _) async {},
        ),
      ),
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey('auth-method-password')),
    );
    await tester.tap(find.byKey(const ValueKey('auth-method-password')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('auth-admin-password')),
      'fixture-password',
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('auth-admin-submit')));
    await tester.tap(find.byKey(const ValueKey('auth-admin-submit')));
    await tester.pumpAndSettle();
    expect(find.byType(NativeStaffApp), findsNothing);
    expect(find.byType(AdminPortalScreen), findsOneWidget);
    expect(find.byKey(const ValueKey('admin-portal-close')), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  setUp(
    () => SharedPreferences.setMockInitialValues({'staffKitchenSound': false}),
  );
  for (final size in [
    const Size(320, 640),
    const Size(390, 844),
    const Size(768, 1024),
  ]) {
    testWidgets('all native staff sections render at $size with large text', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = FixtureStaffApi();
      addTearDown(api.close);
      for (final section in [
        'operations',
        'analytics',
        'orders',
        'transactions',
        'iiko',
        'menu',
        'dispatch',
        'whatsapp',
        'marketing',
        'tiers',
        'contacts',
        'broadcast',
        'taplink',
        'integrations',
        'security',
        'site-access',
        'couriers',
        'inventory',
        'support',
        'reviews',
        'stories',
        'news',
        'bonus',
        'settings',
        'access',
        'locations',
        'kitchen',
        'dashboard',
        'customers',
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: size,
                textScaler: TextScaler.linear(1.5),
              ),
              child: StaffWorkspace(
                key: ValueKey(section),
                api: api,
                user: {
                  'username': 'Fixture',
                  'role': 'owner',
                  'actions': ['*'],
                },
                initialSection: section,
                onLogout: () async {},
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        expect(tester.takeException(), isNull, reason: section);
        expect(find.textContaining('TypeError'), findsNothing, reason: section);
        expect(
          find.textContaining('NoSuchMethod'),
          findsNothing,
          reason: section,
        );
        expect(
          find.textContaining('is not a subtype'),
          findsNothing,
          reason: section,
        );
        await tester.pumpWidget(const SizedBox());
        await tester.pump();
      }
      expect(api.requests.where((r) => !r.startsWith('GET')), isEmpty);
    });
  }
  test('staff deep links use native destinations', () {
    expect(
      staffSectionFromUri(
        Uri.parse('https://bulka.com.kz/admin/iiko-dashboard'),
      ),
      'dashboard',
    );
    expect(
      staffSectionFromUri(
        Uri.parse('https://bulka.com.kz/admin/kitchen?order=123'),
      ),
      'kitchen',
    );
    expect(
      staffSectionFromUri(
        Uri.parse('https://bulka.com.kz/admin/whatsapp-access#token'),
      ),
      'whatsapp',
    );
  });
  test('message delivery state is independent of order payment state', () {
    expect(staffMessageStatus('pending'), isNot(staffStatus('pending')));
  });
  test('dispatch requires valid price, kitchen acceptance and permission', () {
    final now = DateTime.utc(2026, 9, 8);
    final config = {
      'canCreate': true,
      'apiMode': 'business_v2',
      'restaurantDeliveryConfirmed': true,
      'dispatchReady': true,
    };
    final order = {'kitchenStatus': 'preparing'};
    final quote = {
      'id': 'q',
      'apiFamily': 'business_v2',
      'fixedPrice': true,
      'quotedPrice': 1000,
      'quoteFingerprint': 'abc',
      'quoteExpiresAt': now.add(const Duration(minutes: 5)).toIso8601String(),
      'status': 'quoted',
    };
    expect(
      staffYandexRequestBlockReason(order, quote, config, now: now),
      isNull,
    );
    for (final delta in [
      {'quotedPrice': 0},
      {'quoteExpiresAt': now.toIso8601String()},
      {'itemsResolutionRequired': true},
      {'status': 'creating_exhausted'},
      {'active': true, 'status': 'performing'},
    ]) {
      expect(
        staffYandexRequestBlockReason(
          order,
          {...quote, ...delta},
          config,
          now: now,
        ),
        isNotNull,
      );
    }
    expect(
      staffYandexRequestBlockReason({}, quote, config, now: now),
      isNotNull,
    );
    expect(
      staffYandexRequestBlockReason(order, quote, {
        ...config,
        'canCreate': false,
        'canManage': true,
      }, now: now),
      isNotNull,
    );
  });
  test('real-time refresh coalesces events during a request', () async {
    final api = EventStaffApi();
    var calls = 0;
    final first = Completer<void>();
    final live = StaffLiveRefresh(api, () async {
      calls++;
      if (calls == 1) await first.future;
    });
    api.controller.add({'type': 'order.updated', 'id': '1'});
    await Future<void>.delayed(const Duration(milliseconds: 150));
    expect(calls, 1);
    api.controller.add({'type': 'order.updated', 'id': '2'});
    api.controller.add({'type': 'order.updated', 'id': '3'});
    await Future<void>.delayed(const Duration(milliseconds: 10));
    first.complete();
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(calls, 2);
    live.dispose();
    await api.controller.close();
    api.close();
  });
}

class EventStaffApi extends FixtureStaffApi {
  final controller = StreamController<Map<String, dynamic>>();
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) =>
      controller.stream;
}

class DashboardFixtureApi extends FixtureStaffApi {
  final reports = <Map<String, dynamic>>[];
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (endpoint == '/iiko-dashboard/servers') {
      return {
        'servers': [
          {
            'id': 'aktau-chain',
            'name': 'Актау',
            'active': true,
            'configured': true,
          },
        ],
      };
    }
    return super.request(
      endpoint,
      method: method,
      body: body,
      authenticated: authenticated,
      headers: headers,
      query: query,
    );
  }

  @override
  Future<Map<String, dynamic>> report(
    String endpoint,
    Map<String, dynamic> query, {
    bool Function()? isCancelled,
  }) async {
    reports.add(Map.of(query));
    return {
      'period': {'from': query['from'], 'to': query['to']},
      'columns': {
        'Department': {'name': 'Филиал'},
        'DishDiscountSumInt': {'name': 'Выручка'},
      },
      'rows': [
        {
          'Department': 'ЖК Гаухартас — пекарня с длинным названием',
          'DishDiscountSumInt': 12345678,
          'UniqOrderId': 1234,
          'DiscountSum': 32100,
          'DishAmountInt': 2345,
          'GuestNum': 1400,
          'ProductCostBase.ProductCost': 1000000,
        },
      ],
    };
  }
}
