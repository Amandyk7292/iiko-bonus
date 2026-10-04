import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pinput/pinput.dart';

const _sms = OtpRequestResult(
  deliveryMode: 'automatic',
  channel: 'sms',
  codeLength: 6,
  retryAfterSeconds: 2,
  whatsappUrl: 'https://wa.me/77000000000?text=legacy',
  whatsappPhone: '+77000000000',
);

Future<void> _openRegistration(
  WidgetTester tester, {
  required OtpRequestResult response,
  required Future<String?> Function(String, String) verify,
  VoidCallback? sent,
  OtpRequestResult Function()? nextResponse,
}) async {
  tester.view.physicalSize = const Size(320, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: const TextScaler.linear(2)),
        child: child!,
      ),
      home: LoginScreen(
        startRegistration: true,
        onLogin: (_, _) async => null,
        onStartRegistration: (_, _, _) async {
          sent?.call();
          return nextResponse?.call() ?? response;
        },
        onVerifyRegistration: verify,
        onStartPasswordReset: (_, _) async => const OtpRequestResult(),
        onResetPassword: (_, _, _) async => null,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _requestCode(WidgetTester tester) async {
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
  final button = find.byType(GradientButton);
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

void _expectNoWhatsApp() {
  expect(find.textContaining('WhatsApp'), findsNothing);
  expect(find.byIcon(Icons.open_in_new_rounded), findsNothing);
}

void main() {
  setUp(() => appLanguageNotifier.value = 'ru');

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets('registration uses SMS only in $language at 320px/200% text', (
      tester,
    ) async {
      appLanguageNotifier.value = language;
      var sends = 0;
      final codes = <String>[];
      await _openRegistration(
        tester,
        response: _sms,
        sent: () => sends++,
        verify: (_, code) async {
          codes.add(code);
          return 'Invalid fixture code';
        },
      );
      _expectNoWhatsApp();
      expect(find.textContaining('SMS'), findsOneWidget);
      await _requestCode(tester);
      _expectNoWhatsApp();
      expect(find.text('code_sent_sms'.tr), findsOneWidget);
      final otp = find.byKey(const ValueKey('auth-otp-field'));
      expect(tester.widget<Pinput>(otp).length, 6);
      final rect = tester.getRect(otp);
      expect(rect.left, greaterThanOrEqualTo(0));
      expect(rect.right, lessThanOrEqualTo(320));
      final resend = find.byKey(const ValueKey('otp-resend-button'));
      expect(tester.widget<TextButton>(resend).onPressed, isNull);
      await tester.pump(const Duration(seconds: 2));
      await tester.ensureVisible(resend);
      await tester.tap(resend);
      await tester.pumpAndSettle();
      expect(sends, 2);
      await tester.ensureVisible(otp);
      await tester.enterText(otp, '1234');
      await tester.pump(const Duration(milliseconds: 300));
      expect(codes, isEmpty);
      await tester.enterText(otp, '123456');
      await tester.pumpAndSettle();
      expect(codes, ['123456']);
      _expectNoWhatsApp();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }

  const unsupported = <String, OtpRequestResult>{
    'legacy manual WhatsApp': OtpRequestResult(
      whatsappUrl: 'https://wa.me/77000000000?text=legacy',
      whatsappPhone: '+77000000000',
    ),
    'automatic SMS four-digit': OtpRequestResult(
      deliveryMode: 'automatic',
      channel: 'sms',
      codeLength: 4,
    ),
    'manual SMS': OtpRequestResult(
      deliveryMode: 'manual',
      channel: 'sms',
      codeLength: 6,
    ),
    'missing channel': OtpRequestResult(
      deliveryMode: 'automatic',
      codeLength: 6,
    ),
    'failed SMS': OtpRequestResult(
      error: 'Cannot send fixture SMS',
      deliveryMode: 'automatic',
      channel: 'sms',
      codeLength: 6,
    ),
  };
  for (final entry in unsupported.entries) {
    testWidgets('${entry.key} never claims SMS was sent or opens WhatsApp', (
      tester,
    ) async {
      var verifications = 0;
      await _openRegistration(
        tester,
        response: entry.value,
        verify: (_, _) async {
          verifications++;
          return null;
        },
      );
      await _requestCode(tester);
      _expectNoWhatsApp();
      expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
      expect(find.text('code_sent_sms'.tr), findsNothing);
      expect(find.text('auth_registration_verify_title'.tr), findsNothing);
      expect(
        find.text(entry.value.error ?? 'error_send_code'.tr),
        findsOneWidget,
      );
      expect(verifications, 0);
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('auth-phone-field')))
            .enabled,
        true,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }

  testWidgets(
    'a legacy resend clears the old SMS step and allows a safe retry',
    (tester) async {
      var sends = 0;
      await _openRegistration(
        tester,
        response: _sms,
        sent: () => sends++,
        nextResponse: () =>
            sends == 2 ? unsupported['legacy manual WhatsApp']! : _sms,
        verify: (_, _) async => null,
      );
      await _requestCode(tester);
      expect(find.text('code_sent_sms'.tr), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      final resend = find.byKey(const ValueKey('otp-resend-button'));
      await tester.ensureVisible(resend);
      await tester.tap(resend);
      await tester.pumpAndSettle();
      expect(sends, 2);
      expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
      expect(find.text('code_sent_sms'.tr), findsNothing);
      expect(find.text('error_send_code'.tr), findsOneWidget);
      _expectNoWhatsApp();
      final button = find.byType(GradientButton);
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(sends, 3);
      expect(find.text('code_sent_sms'.tr), findsOneWidget);
      _expectNoWhatsApp();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
