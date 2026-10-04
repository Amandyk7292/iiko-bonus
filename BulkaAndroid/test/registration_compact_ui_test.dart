import 'package:bulka_bonus/core/cashier_invite.dart';
import 'package:bulka_bonus/core/referral_link.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _consentKey = ValueKey('registration-consent');
const _conditionsKey = ValueKey('registration-conditions');
const _documentsKey = ValueKey('registration-legal-documents');
const _referralKey = ValueKey('registration-referral-code');

Future<void> _openProfile(
  WidgetTester tester, {
  double textScale = 1,
  bool dark = false,
  VoidCallback? onRegister,
}) async {
  final theme = buildBulkaTheme();
  await tester.pumpWidget(
    MaterialApp(
      theme: dark
          ? theme.copyWith(
              colorScheme: const ColorScheme.dark(),
              scaffoldBackgroundColor: const Color(0xFF171717),
            )
          : theme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: LoginScreen(
        startRegistration: true,
        onLogin: (_, _) async => null,
        onStartRegistration: (_, _, _) async => const OtpRequestResult(
          deliveryMode: 'automatic',
          channel: 'sms',
          codeLength: 6,
        ),
        onVerifyRegistration: (_, _) async => null,
        onStartPasswordReset: (_, _) async => const OtpRequestResult(),
        onResetPassword: (_, _, _) async => null,
        onRegister:
            ({
              required phone,
              required name,
              surname,
              gender,
              birthdate,
              email,
              cashierInviteToken,
            }) async {
              onRegister?.call();
              return null;
            },
      ),
    ),
  );
  await tester.pumpAndSettle();
  for (final entry in const {
    'auth-phone-field': '7001234567',
    'auth-password-field': 'Register2026',
    'auth-confirm-password-field': 'Register2026',
  }.entries) {
    await tester.enterText(find.byKey(ValueKey(entry.key)), entry.value);
  }
  final confirm = find.text('auth_confirm_whatsapp'.tr);
  await tester.ensureVisible(confirm);
  await tester.tap(confirm);
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('auth-otp-field')),
    '123456',
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    PendingCashierInvite.tokenNotifier.value = null;
    appLanguageNotifier.value = 'ru';
  });
  tearDown(() => appLanguageNotifier.value = 'ru');

  testWidgets('viewing compact legal links never accepts required consent', (
    tester,
  ) async {
    var registrations = 0;
    await _openProfile(tester, onRegister: () => registrations++);
    expect(tester.widget<Checkbox>(find.byKey(_consentKey)).value, isFalse);
    expect(find.byKey(_documentsKey), findsNothing);
    await tester.ensureVisible(find.byKey(_conditionsKey));
    await tester.tap(find.byKey(_conditionsKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_documentsKey), findsOneWidget);
    for (final page in ['public-offer', 'terms', 'privacy']) {
      final link = find.byKey(ValueKey('registration-legal-$page'));
      expect(tester.widget<TextButton>(link).onPressed, isNotNull);
      expect(tester.getSize(link).height, greaterThanOrEqualTo(44));
    }
    await tester.tap(find.byKey(const ValueKey('registration-legal-close')));
    await tester.pumpAndSettle();
    expect(tester.widget<Checkbox>(find.byKey(_consentKey)).value, isFalse);
    final name = find.widgetWithText(TextField, 'reg_name_hint'.tr);
    await tester.ensureVisible(name);
    await tester.enterText(name, 'Покупатель');
    final submit = find.text('reg_next_btn'.tr);
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    expect(registrations, 0);
    expect(find.text('reg_err_terms'.tr), findsOneWidget);
    await tester.ensureVisible(find.byKey(_consentKey));
    await tester.tap(find.byKey(_consentKey));
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    expect(registrations, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('short invitation field retains captured code and removal', (
    tester,
  ) async {
    await PendingReferral.capture(
      Uri.parse('https://bulka.com.kz/profile?ref=BULKA-1234ABCD'),
    );
    await _openProfile(tester);
    final field = find.byKey(_referralKey);
    expect(tester.widget<TextField>(field).controller!.text, 'BULKA-1234ABCD');
    expect(tester.widget<TextField>(field).decoration!.helperText, isNull);
    await tester.ensureVisible(field);
    await tester.enterText(field, 'BULKA-ABCD1234');
    await tester.pumpAndSettle();
    expect(await PendingReferral.read(), 'BULKA-ABCD1234');
    await tester.enterText(field, '');
    await tester.pumpAndSettle();
    expect(await PendingReferral.read(), isNull);
  });

  for (final language in ['ru', 'kk', 'en']) {
    for (final dark in [false, true]) {
      testWidgets(
        'compact registration fits 320px/180% text in $language, dark=$dark',
        (tester) async {
          appLanguageNotifier.value = language;
          tester.view.physicalSize = const Size(320, 760);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await _openProfile(tester, textScale: 1.8, dark: dark);
          for (final key in [_referralKey, _consentKey, _conditionsKey]) {
            await tester.ensureVisible(find.byKey(key));
            await tester.pumpAndSettle();
            final bounds = tester.getRect(find.byKey(key));
            expect(bounds.left, greaterThanOrEqualTo(0));
            expect(bounds.right, lessThanOrEqualTo(320));
          }
          for (final helper in [
            'birthdate_example',
            'reg_email_helper',
            'reg_phone_helper',
            'referral_registration_hint',
          ]) {
            expect(find.text(helper.tr), findsNothing);
          }
          await tester.tap(find.byKey(_conditionsKey));
          await tester.pumpAndSettle();
          final bounds = tester.getRect(find.byKey(_documentsKey));
          expect(bounds.left, greaterThanOrEqualTo(0));
          expect(bounds.right, lessThanOrEqualTo(320));
          final title = tester.widget<Text>(
            find
                .descendant(
                  of: find.byKey(_documentsKey),
                  matching: find.text('reg_legal_documents'.tr),
                )
                .first,
          );
          expect(
            title.style!.color,
            Theme.of(
              tester.element(find.byKey(_documentsKey)),
            ).colorScheme.onSurface,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
