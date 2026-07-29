import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('four-digit OTP stays inside a 320px viewport', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.3)),
          child: child!,
        ),
        home: LoginScreen(
          onLogin: (_, _) async => null,
          onStartRegistration: (_, _, _) async => const OtpRequestResult(),
          onVerifyRegistration: (_, _) async => null,
          onStartPasswordReset: (_, _) async => const OtpRequestResult(),
          onResetPassword: (_, _, _) async => null,
        ),
      ),
    );

    await tester.ensureVisible(
      find.byKey(const ValueKey('create-account-button')),
    );
    await tester.tap(find.byKey(const ValueKey('create-account-button')));
    await tester.pumpAndSettle();
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
    await tester.ensureVisible(find.text('Подтвердить номер'));
    await tester.tap(find.text('Подтвердить номер'));
    await tester.pumpAndSettle();

    final otp = find.byKey(const ValueKey('auth-otp-field'));
    expect(otp, findsOneWidget);
    final rect = tester.getRect(otp);
    expect(rect.left, greaterThanOrEqualTo(0));
    expect(rect.right, lessThanOrEqualTo(320));
    expect(tester.takeException(), isNull);
  });
}
