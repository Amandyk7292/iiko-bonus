import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pinput/pinput.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _cashierToken =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

http.Response _response(Object value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json'},
);

const _empty = <String, Object>{
  'success': true,
  'cities': [],
  'locations': [],
  'orders': [],
  'products': [],
  'items': [],
  'promotions': [],
  'banners': [],
  'stories': [],
  'categories': [],
  'notifications': [],
  'unreadCount': 0,
};

class _GuestStaff extends StaffAccountSession {
  @override
  Future<void> restore() async {}
}

class _ShellApi extends BulkaApiClient {
  _ShellApi({this.authenticated = false})
    : super(client: MockClient((_) async => _response(_empty)));
  final bool authenticated;

  @override
  bool get isAuthenticated => authenticated;

  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

Future<void> _shell(
  WidgetTester tester, {
  required _ShellApi api,
  required Future<bool> Function() authenticate,
  StaffAccountSession? staff,
}) async {
  final cart = CartProvider();
  await cart.restored;
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    api.dispose();
    cart.dispose();
  });
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: cart,
      child: MaterialApp(
        theme: buildBulkaTheme(),
        home: MainShell(
          initialTab: 4,
          api: api,
          customer: null,
          staff: staff,
          transactions: const [],
          onLogout: () async {},
          onRefreshProfile: () async {},
          onRequireAuth: authenticate,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'lastMainTab': 4});
    FlutterSecureStorage.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
    clientRouteNotifier.value = Uri(path: '/');
  });
  tearDown(() => clientRouteNotifier.value = Uri(path: '/'));

  test(
    'normalization preserves duplicates without changing path and fragment',
    () {
      final uri = Uri.parse(
        'https://bulka.com.kz/profile?register=1&register=1&extra=keep#section',
      );
      final normalized = normalizedClientUri(uri);
      expect(normalized.scheme, isEmpty);
      expect(normalized.host, isEmpty);
      expect(normalized.path, '/profile');
      expect(normalized.fragment, 'section');
      expect(normalized.queryParametersAll['register'], ['1', '1']);
      expect(normalized.queryParameters['extra'], 'keep');
      expect(isRegistrationClientUri(normalized), false);
      expect(isRegistrationClientUri(Uri.parse('/profile?register=1')), true);
    },
  );

  for (final route in [
    '/profile',
    '/profile?register=0',
    '/profile?register=01',
    '/profile?register=',
    '/profile?register=1&register=1',
    '/profile/?register=1',
    '/cart?register=1',
  ]) {
    testWidgets('$route does not automatically open registration', (
      tester,
    ) async {
      clientRouteNotifier.value = Uri.parse(route);
      var opens = 0;
      await _shell(
        tester,
        api: _ShellApi(),
        authenticate: () async {
          opens++;
          return false;
        },
      );
      expect(opens, 0);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('external duplicate hints and cashier tokens remain rejected', (
    tester,
  ) async {
    var opens = 0;
    await _shell(
      tester,
      api: _ShellApi(),
      authenticate: () async {
        opens++;
        return false;
      },
    );
    applyExternalClientRoute(Uri.parse('/profile?register=1&register=1'));
    await tester.pumpAndSettle();
    expect(clientRouteNotifier.value.queryParametersAll['register'], [
      '1',
      '1',
    ]);
    expect(opens, 0);
    applyExternalClientRoute(
      Uri.parse(
        '/cashier-register?cashier=$_cashierToken&cashier=$_cashierToken',
      ),
    );
    await tester.pumpAndSettle();
    expect(opens, 0);
    applyExternalClientRoute(
      Uri.parse('/cashier-register?cashier=$_cashierToken'),
    );
    await tester.pumpAndSettle();
    expect(opens, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'registration hint is ignored for authenticated customer transport',
    (tester) async {
      clientRouteNotifier.value = Uri.parse('/profile?register=1');
      var opens = 0;
      await _shell(
        tester,
        api: _ShellApi(authenticated: true),
        authenticate: () async {
          opens++;
          return false;
        },
      );
      expect(opens, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('registration hint is ignored for authenticated staff', (
    tester,
  ) async {
    clientRouteNotifier.value = Uri.parse('/profile?register=1');
    final staff = _GuestStaff()
      ..user = {'username': 'fixture', 'role': 'admin'};
    addTearDown(staff.dispose);
    var opens = 0;
    await _shell(
      tester,
      api: _ShellApi(),
      staff: staff,
      authenticate: () async {
        opens++;
        return false;
      },
    );
    expect(opens, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('repeated registration routes request only one authentication', (
    tester,
  ) async {
    clientRouteNotifier.value = Uri.parse('/profile?register=1');
    final pending = Completer<bool>();
    var opens = 0;
    await _shell(
      tester,
      api: _ShellApi(),
      authenticate: () {
        opens++;
        return pending.future;
      },
    );
    expect(opens, 1);
    applyExternalClientRoute(Uri.parse('/profile?register=1&extra=repeat'));
    await tester.pumpAndSettle();
    expect(opens, 1);
    expect(
      find.byKey(const PageStorageKey('guest-profile-tab')).hitTestable(),
      findsOneWidget,
    );
    pending.complete(false);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'direct link opens current SMS registration once; profile uses login',
    (tester) async {
      clientRouteNotifier.value = Uri.parse('/profile?register=1');
      for (final channel in [
        const MethodChannel('home_widget'),
        const MethodChannel('com.bulka.bonus/order_status'),
      ]) {
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (_) async => null,
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
      }
      var registrations = 0;
      final client = MockClient((request) async {
        if (request.url.path == '/api/auth/register/start') {
          registrations++;
          return _response({
            'success': true,
            'deliveryMode': 'automatic',
            'channel': 'sms',
            'codeLength': 6,
            'retryAfterSeconds': 60,
          });
        }
        if (request.url.path.endsWith('/events')) return _response({}, 204);
        return _response(_empty);
      });
      final staff = _GuestStaff(), cart = CartProvider();
      await http.runWithClient(() async {
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: BulkaBonusApp(
              appReleaseChecksEnabled: false,
              staffSession: staff,
              nativeCashierPushEnabled: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen, skipOffstage: false), findsOneWidget);
        expect(
          tester
              .widget<LoginScreen>(find.byType(LoginScreen))
              .startRegistration,
          true,
        );
        expect(
          find.byKey(const ValueKey('auth-confirm-password-field')),
          findsOneWidget,
        );
        expect(find.textContaining('WhatsApp'), findsNothing);
        applyExternalClientRoute(Uri.parse('/profile?register=1&extra=repeat'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen, skipOffstage: false), findsOneWidget);
        await tester.enterText(
          find.byKey(const ValueKey('auth-phone-field')),
          '7012345678',
        );
        await tester.enterText(
          find.byKey(const ValueKey('auth-password-field')),
          'Register2026',
        );
        await tester.enterText(
          find.byKey(const ValueKey('auth-confirm-password-field')),
          'Register2026',
        );
        await tester.pump();
        await tester.ensureVisible(find.byType(GradientButton));
        await tester.tap(find.byType(GradientButton));
        await tester.pumpAndSettle();
        expect(registrations, 1);
        expect(find.text('Код отправлен по SMS.'), findsOneWidget);
        expect(
          tester
              .widget<Pinput>(find.byKey(const ValueKey('auth-otp-field')))
              .length,
          6,
        );
        tester.widget<LoginScreen>(find.byType(LoginScreen)).onClose!();
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen, skipOffstage: false), findsNothing);
        applyExternalClientRoute(Uri(path: '/profile'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsNothing);
        final authentication = tester
            .widget<MainShell>(find.byType(MainShell))
            .onRequireAuth!();
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen, skipOffstage: false), findsOneWidget);
        final normal = tester.widget<LoginScreen>(find.byType(LoginScreen));
        expect(normal.startRegistration, false);
        expect(
          find.byKey(const ValueKey('auth-confirm-password-field')),
          findsNothing,
        );
        normal.onClose!();
        await tester.pumpAndSettle();
        expect(await authentication, false);
        expect(registrations, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      }, () => client);
      staff.dispose();
      cart.dispose();
    },
  );
}
