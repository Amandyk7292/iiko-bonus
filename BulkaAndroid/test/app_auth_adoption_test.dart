import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class GuestStaff extends StaffAccountSession {
  @override
  Future<void> restore() async {}
}

http.Response response(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> profile(String phone, String identity) => {
  'success': true,
  'exists': true,
  'accessToken': 'fixture-access-$identity',
  'refreshToken': 'fixture-refresh-$identity',
  'customer': {
    'id': identity,
    'name': 'Fixture $identity',
    'phone': phone,
    'balance': identity == 'A' ? 123 : 987,
    if (identity == 'childB') 'isFamilyChild': true,
    if (identity == 'B')
      'tier': {
        'name': 'Base',
        'allTiers': [
          {'name': 'Base', 'level': 1},
        ],
      },
  },
  'transactions': [],
};

void main() {
  for (final child in [false, true]) {
    testWidgets(
      'late profile adoption must not replace a newer ${child ? 'child' : 'adult'} account',
      (tester) async {
        SharedPreferences.setMockInitialValues({'lastMainTab': 4});
        FlutterSecureStorage.setMockInitialValues({});
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          const MethodChannel('home_widget'),
          (_) async => true,
        );
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          const MethodChannel('com.bulka.bonus/order_status'),
          (_) async => null,
        );
        appLanguageNotifier.value = 'ru';
        final loyaltyA = Completer<http.Response>();
        var loyaltyReads = 0;
        final authorizedOrders = <String?>[];
        final client = MockClient((request) async {
          final path = request.url.path;
          if (path == '/api/customer/orders') {
            authorizedOrders.add(request.headers['Authorization']);
          }
          if (path == '/api/auth/login') {
            final phone = jsonDecode(request.body)['phone'] as String;
            return response(profile(phone, phone.endsWith('1111') ? 'A' : 'B'));
          }
          if (path == '/api/auth/family-child/login') {
            return response(
              profile('family:bd648ffb-b4a3-4bf4-9c1e-582663f1f171', 'childB'),
            );
          }
          if (path == '/api/customer/loyalty') {
            loyaltyReads++;
            if (request.headers['Authorization'] == 'Bearer fixture-access-A') {
              return loyaltyA.future;
            }
            return response({'success': true});
          }
          if (path.endsWith('/events')) return response({}, 204);
          return response({
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
          });
        });
        final staff = GuestStaff();
        final cart = CartProvider();
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
          final originalShell = tester.widget<MainShell>(
            find.byType(MainShell),
          );
          final routeA = originalShell.onRequireAuth!();
          await tester.pumpAndSettle();
          final screenA = tester.widget<LoginScreen>(find.byType(LoginScreen));
          final loginA = screenA.onLogin('+77011111111', 'fixture-password-A');
          await tester.pump();
          await tester.pump();
          expect(loyaltyReads, 1);
          expect(originalShell.api.sessionPhone, '+77011111111');

          // The visible close control remains enabled during the pending login.
          screenA.onClose!();
          await tester.pumpAndSettle();
          expect(await routeA, isFalse);
          final shellBeforeB = tester.widget<MainShell>(find.byType(MainShell));
          final routeB = shellBeforeB.onRequireAuth!();
          await tester.pumpAndSettle();
          final screenB = tester.widget<LoginScreen>(find.byType(LoginScreen));
          final newPhone = child
              ? 'family:bd648ffb-b4a3-4bf4-9c1e-582663f1f171'
              : '+77022222222';
          final loginB = child
              ? screenB.onChildLogin!('fixture-child-B', 'fixture-password-B')
              : screenB.onLogin(newPhone, 'fixture-password-B');
          var bFinished = false;
          loginB.then((_) => bFinished = true);
          for (var tick = 0; tick < 50 && !bFinished; tick++) {
            await tester.pump(const Duration(milliseconds: 20));
          }
          expect(
            bFinished,
            isTrue,
            reason: 'Fixture login must finish within bounded pumped frames',
          );
          final resultB = await loginB;
          await tester.pumpAndSettle();
          expect(resultB, isNull);
          expect(await routeB, !child);
          if (child) {
            expect(
              tester
                  .widget<FamilyChildScreen>(find.byType(FamilyChildScreen))
                  .customer
                  .id,
              'childB',
            );
          } else {
            expect(
              tester.widget<MainShell>(find.byType(MainShell)).customer?.id,
              'B',
            );
          }

          // Account A's delayed loyalty request completes after account B has
          // finished logging in. It must not adopt A's original profile.
          loyaltyA.complete(response({'success': true}));
          expect(await loginA, isNotNull);
          await tester.pump(const Duration(milliseconds: 500));
          await tester.pump(const Duration(milliseconds: 500));
          final finalCustomer = child
              ? (find.byType(FamilyChildScreen).evaluate().isEmpty
                    ? null
                    : tester
                          .widget<FamilyChildScreen>(
                            find.byType(FamilyChildScreen),
                          )
                          .customer
                          .id)
              : tester.widget<MainShell>(find.byType(MainShell)).customer?.id;
          final preferences = await SharedPreferences.getInstance();
          await tester.pumpWidget(const SizedBox());
          staff.dispose();
          cart.dispose();
          expect(originalShell.api.sessionPhone, newPhone);
          expect(preferences.getString('phone'), newPhone);
          expect(
            jsonDecode(preferences.getString('customer')!)['id'],
            child ? 'childB' : 'B',
          );
          if (!child) {
            expect(authorizedOrders, everyElement('Bearer fixture-access-B'));
          }
          expect(
            finalCustomer,
            child ? 'childB' : 'B',
            reason: 'A completed after B; UI must retain the new account',
          );
        }, () => client);
      },
    );
  }

  for (final pendingStage in ['response', 'loyalty']) {
    testWidgets(
      'closing login invalidates its pending $pendingStage before the next form opens',
      (tester) async {
        SharedPreferences.setMockInitialValues({'lastMainTab': 4});
        FlutterSecureStorage.setMockInitialValues({});
        appLanguageNotifier.value = 'ru';
        final pending = Completer<http.Response>();
        var loginReads = 0;
        var loyaltyReads = 0;
        final client = MockClient((request) async {
          if (request.url.path == '/api/auth/login') {
            loginReads++;
            return pendingStage == 'response'
                ? pending.future
                : response(profile('+77011111111', 'A'));
          }
          if (request.url.path == '/api/customer/loyalty') {
            loyaltyReads++;
            return pending.future;
          }
          if (request.url.path.endsWith('/events')) return response({}, 204);
          return response({
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
          });
        });
        final staff = GuestStaff();
        final cart = CartProvider();
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
          final shell = tester.widget<MainShell>(find.byType(MainShell));
          final firstRoute = shell.onRequireAuth!();
          await tester.pumpAndSettle();
          final firstScreen = tester.widget<LoginScreen>(
            find.byType(LoginScreen),
          );
          final firstLogin = firstScreen.onLogin(
            '+77011111111',
            'fixture-password',
          );
          await tester.pump();
          await tester.pump();
          expect(loginReads, 1);
          expect(loyaltyReads, pendingStage == 'loyalty' ? 1 : 0);
          firstScreen.onClose!();
          await tester.pumpAndSettle();
          expect(await firstRoute, isFalse);
          final secondRoute = tester
              .widget<MainShell>(find.byType(MainShell))
              .onRequireAuth!();
          await tester.pumpAndSettle();
          final secondScreen = tester.widget<LoginScreen>(
            find.byType(LoginScreen),
          );
          pending.complete(
            response(
              pendingStage == 'response'
                  ? profile('+77011111111', 'A')
                  : {'success': true},
            ),
          );
          expect(await firstLogin, isNotNull);
          await tester.pumpAndSettle();
          expect(
            find.byType(LoginScreen),
            findsOneWidget,
            reason: 'An earlier login must not close the newly opened form',
          );
          expect(
            tester
                .widget<MainShell>(find.byType(MainShell, skipOffstage: false))
                .customer,
            isNull,
          );
          final preferences = await SharedPreferences.getInstance();
          expect(preferences.getString('customer'), isNull);
          expect(preferences.getString('phone'), isNull);
          if (pendingStage == 'response') {
            expect(shell.api.isAuthenticated, isFalse);
          }
          secondScreen.onClose!();
          await tester.pumpAndSettle();
          expect(await secondRoute, isFalse);
          await tester.pumpWidget(const SizedBox());
          staff.dispose();
          cart.dispose();
        }, () => client);
      },
    );
  }
}
