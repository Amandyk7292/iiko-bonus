import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'cashier_workspace_test.dart' show CashierFixtureApi;

class _RestoredCashierApi extends CashierFixtureApi {
  @override
  Future<Map<String, dynamic>?> restore() async => {
    'username': 'fixture',
    'role': 'cashier',
  };
}

void main() {
  testWidgets(
    'main password login switches to cashier without a second portal login',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'staffKitchenSound': false,
        'lastMainTab': 4,
      });
      FlutterSecureStorage.setMockInitialValues({});
      final session = StaffAccountSession(
        api: CashierFixtureApi(),
        readPortalCookie: () async => null,
        loginClient: AdminPortalLoginClient(
          installCookie: (_, _) async {},
          client: MockClient((request) async {
            expect(jsonDecode(request.body)['username'], 'cashier.fixture');
            return http.Response(
              '{"user":{"username":"cashier.fixture","role":"cashier"}}',
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
            staffSession: session,
            nativeCashierPushEnabled: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Войти по номеру телефона'));
      await tester.pumpAndSettle();
      final passwordTab = find.byKey(const ValueKey('auth-method-password'));
      await tester.ensureVisible(passwordTab);
      await tester.tap(passwordTab);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('auth-admin-username')),
        'cashier.fixture',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-admin-password')),
        'fixture-password',
      );
      final submit = find.byKey(const ValueKey('auth-admin-submit'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.byType(CashierWorkspace), findsOneWidget);
      expect(find.byType(MainShell), findsNothing);
      expect(find.byType(LoginScreen), findsNothing);
      expect(find.byType(AdminPortalScreen), findsNothing);
      expect(session.isCashier, isTrue);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'app restores cashier shell, routes push into native kitchen and removes it on revocation',
    (tester) async {
      SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
      FlutterSecureStorage.setMockInitialValues({});
      final api = _RestoredCashierApi();
      final session = StaffAccountSession(
        api: api,
        readPortalCookie: () async => null,
      );
      final cart = CartProvider();
      addTearDown(session.dispose);
      addTearDown(cart.dispose);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: BulkaBonusApp(
            appReleaseChecksEnabled: false,
            staffSession: session,
            nativeCashierPushEnabled: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.byType(CashierWorkspace), findsOneWidget);
      expect(find.byType(MainShell), findsNothing);
      expect(find.byType(AdminPortalScreen), findsNothing);
      PushNotifications.publishOpenedTargetForTesting({
        'type': 'staff.order.new',
        'url': '/admin/kitchen',
      });
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      expect(find.byType(AdminPortalScreen), findsNothing);
      api.onUnauthorized!();
      await tester.pumpAndSettle();
      expect(find.byType(CashierWorkspace), findsNothing);
      expect(find.byType(MainShell), findsOneWidget);
      expect(find.byType(AdminPortalScreen), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
