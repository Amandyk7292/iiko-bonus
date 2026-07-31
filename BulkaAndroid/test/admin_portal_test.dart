import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
  });

  test('admin portal stays on the configured trusted origin', () {
    final portal = bulkaAdminPortalUri(
      baseUrl: 'https://bulka.com.kz/api/customer',
    );

    expect(portal.scheme, 'https');
    expect(portal.host, 'bulka.com.kz');
    expect(portal.path, '/admin/');
    expect(portal.queryParameters['embedded'], 'app');
    expect(
      isTrustedAdminPortalUri(
        Uri.parse('https://bulka.com.kz/admin/orders?status=new'),
        portal,
      ),
      isTrue,
    );
    expect(
      isTrustedAdminPortalUri(
        Uri.parse('https://bulka.com.kz.attacker.example/admin/'),
        portal,
      ),
      isFalse,
    );
    expect(
      isTrustedAdminPortalUri(Uri.parse('http://bulka.com.kz/admin/'), portal),
      isFalse,
    );
    expect(
      isTrustedAdminPortalUri(
        Uri.parse('https://bulka.com.kz:444/admin/'),
        portal,
      ),
      isFalse,
    );
  });

  testWidgets('customer login exposes a touch-friendly staff entry', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LoginScreen(
          onLogin: (_, _) async => null,
          onStartRegistration: (_, _, _) async => const OtpRequestResult(),
          onVerifyRegistration: (_, _) async => null,
          onStartPasswordReset: (_, _) async => const OtpRequestResult(),
          onResetPassword: (_, _, _) async => null,
        ),
      ),
    );

    final entry = find.byKey(const ValueKey('admin-portal-login-button'));
    await tester.ensureVisible(entry);
    expect(entry, findsOneWidget);
    expect(find.text('Вход для сотрудников'), findsOneWidget);
    expect(tester.getSize(entry).height, greaterThanOrEqualTo(44));
    expect(tester.takeException(), isNull);
  });
}
