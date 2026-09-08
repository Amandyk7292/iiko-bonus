import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget loginApp({
  Future<String?> Function(String, String)? customerLogin,
  Future<void> Function(String, String, String)? adminLogin,
  Future<void> Function(BuildContext)? openPortal,
  double textScale = 1,
}) => MaterialApp(
  theme: buildBulkaTheme(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: LoginScreen(
    onLogin: customerLogin ?? (_, _) async => null,
    onAdminLogin: adminLogin ?? (_, _, _) async {},
    onOpenAdminPortal: openPortal ?? (_) async {},
    onStartRegistration: (_, _, _) async => const OtpRequestResult(),
    onVerifyRegistration: (_, _) async => null,
    onStartPasswordReset: (_, _) async => const OtpRequestResult(),
    onResetPassword: (_, _, _) async => null,
  ),
);

Future<void> selectMethod(WidgetTester tester, String method) async {
  final target = find.byKey(ValueKey('auth-method-$method'));
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> submitAdmin(WidgetTester tester) async {
  await tester.pumpAndSettle();
  final target = find.byKey(const ValueKey('auth-admin-submit'));
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pump();
}

void main() {
  setUp(() => appLanguageNotifier.value = 'ru');

  testWidgets('login methods fit small screens and keep credentials separate', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(loginApp(textScale: 1.4));
    await tester.enterText(
      find.byKey(const ValueKey('auth-password-field')),
      'customer-secret',
    );
    await selectMethod(tester, 'password');
    expect(find.text('Вход для сотрудников'), findsNothing);
    expect(find.byKey(const ValueKey('auth-phone-field')), findsNothing);
    expect(find.byKey(const ValueKey('auth-admin-code')), findsNothing);
    expect(find.byKey(const ValueKey('forgot-password-button')), findsNothing);
    final username = tester.widget<TextField>(
      find.byKey(const ValueKey('auth-admin-username')),
    );
    expect(username.controller!.text, 'admin');
    for (final key in [
      'auth-method-password',
      'auth-admin-username',
      'auth-admin-password',
    ]) {
      final rect = tester.getRect(find.byKey(ValueKey(key)));
      expect(rect.left, greaterThanOrEqualTo(0));
      expect(rect.right, lessThanOrEqualTo(320));
    }
    await tester.enterText(
      find.byKey(const ValueKey('auth-admin-password')),
      'admin-secret',
    );
    await selectMethod(tester, 'phone');
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('auth-password-field')))
          .controller!
          .text,
      isEmpty,
    );
    await selectMethod(tester, 'password');
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('auth-admin-password')))
          .controller!
          .text,
      isEmpty,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'admin MFA challenge stays in the main form and opens portal once',
    (tester) async {
      final calls = <List<String>>[];
      var opens = 0;
      await tester.pumpWidget(
        loginApp(
          customerLogin: (_, _) async {
            fail('Admin login must not use the customer account');
          },
          adminLogin: (name, password, code) async {
            calls.add([name, password, code]);
            if (code.isEmpty) {
              throw const AdminPortalLoginException(
                'auth_admin_code_required',
                needsCode: true,
              );
            }
          },
          openPortal: (_) async {
            opens++;
          },
        ),
      );
      await selectMethod(tester, 'password');
      await tester.enterText(
        find.byKey(const ValueKey('auth-admin-password')),
        'secret',
      );
      await submitAdmin(tester);
      await tester.pumpAndSettle();
      expect(opens, 0);
      expect(find.byKey(const ValueKey('auth-admin-code')), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('auth-admin-code')),
        '123456',
      );
      await submitAdmin(tester);
      await tester.pumpAndSettle();
      expect(calls, [
        ['admin', 'secret', ''],
        ['admin', 'secret', '123456'],
      ]);
      expect(opens, 1);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('auth-admin-password')),
            )
            .controller!
            .text,
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('busy admin login cannot switch methods or submit twice', (
    tester,
  ) async {
    final pending = Completer<void>();
    var calls = 0;
    await tester.pumpWidget(
      loginApp(
        adminLogin: (_, _, _) {
          calls++;
          return pending.future;
        },
      ),
    );
    await selectMethod(tester, 'password');
    await tester.enterText(
      find.byKey(const ValueKey('auth-admin-password')),
      'secret',
    );
    await submitAdmin(tester);
    await tester.pump();
    expect(
      tester
          .widget<InkWell>(find.byKey(const ValueKey('auth-method-phone')))
          .onTap,
      isNull,
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('auth-admin-password')))
          .enabled,
      false,
    );
    expect(calls, 1);
    pending.complete();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'phone method still authenticates the customer with their password',
    (tester) async {
      final calls = <List<String>>[];
      await tester.pumpWidget(
        loginApp(
          customerLogin: (phone, password) async {
            calls.add([phone, password]);
            return null;
          },
          adminLogin: (_, _, _) async {
            fail('Customer login must not authenticate as admin');
          },
        ),
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-phone-field')),
        '7012345678',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'secret',
      );
      await tester.ensureVisible(find.text('Войти'));
      await tester.tap(find.text('Войти'));
      await tester.pumpAndSettle();
      expect(calls, [
        ['+77012345678', 'secret'],
      ]);
    },
  );
}
