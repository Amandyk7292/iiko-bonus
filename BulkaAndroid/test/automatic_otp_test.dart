import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  test(
    'API retains automatic delivery metadata and legacy four-digit defaults',
    () async {
      var automatic = true;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          expect(request.url.path, '/api/auth/register/start');
          final body = jsonDecode(request.body) as Map;
          expect(body['phone'], '+77012345678');
          expect(body['otpDeliveryVersion'], 2);
          return http.Response(
            jsonEncode(
              automatic
                  ? {
                      'success': true,
                      'deliveryMode': 'automatic',
                      'channel': 'whatsapp',
                      'codeLength': 6,
                      'retryAfterSeconds': 60,
                      'whatsappUrl': null,
                    }
                  : {
                      'success': true,
                      'whatsappUrl': 'https://wa.me/77000000000',
                    },
            ),
            200,
          );
        }),
      );
      addTearDown(api.dispose);
      final result = await api.startPasswordRegistration(
        phone: '+77012345678',
        password: 'Register2026',
        token: 'RequestToken23456',
      );
      expect(result.isAutomatic, isTrue);
      expect(result.channel, 'whatsapp');
      expect(result.codeLength, 6);
      expect(result.retryAfterSeconds, 60);
      expect(result.whatsappUrl, isNull);
      automatic = false;
      final legacy = await api.startPasswordRegistration(
        phone: '+77012345678',
        password: 'Register2026',
        token: 'RequestToken23456',
      );
      expect(legacy.isAutomatic, isFalse);
      expect(legacy.codeLength, 4);
    },
  );

  test('failed API replies never report that a code was sent', () async {
    for (final status in [200, 503]) {
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response(
            '{"success":false,"code":"OTP_SEND_FAILED","error":"Cannot send code"}',
            status,
          ),
        ),
      );
      await expectLater(
        api.startPasswordRegistration(
          phone: '+77012345678',
          password: 'Register2026',
          token: 'RequestToken23456',
        ),
        throwsA(isA<ApiException>()),
      );
      api.dispose();
    }
    appLanguageNotifier.value = 'kk';
    expect(
      localizeErrorMessage(ApiException('wait', code: 'OTP_RATE_LIMITED')),
      contains('күтіп'),
    );
  });

  for (final channel in ['whatsapp', 'sms']) {
    testWidgets(
      'automatic $channel registration shows six digits and resends after cooldown',
      (tester) async {
        tester.view.physicalSize = const Size(320, 760);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var sends = 0;
        String? verifiedCode;
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
              onStartRegistration: (_, _, _) async {
                sends += 1;
                return OtpRequestResult(
                  deliveryMode: 'automatic',
                  channel: channel,
                  codeLength: 6,
                  retryAfterSeconds: 60,
                  // Even an unexpected old link must not reintroduce the bot flow.
                  whatsappUrl: 'https://wa.me/77000000000?text=code',
                );
              },
              onVerifyRegistration: (_, code) async {
                verifiedCode = code;
                return null;
              },
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

        expect(sends, 1);
        expect(find.text('Введите код'), findsOneWidget);
        expect(
          find.text(
            channel == 'sms'
                ? 'Код отправлен по SMS.'
                : 'Код отправлен через WhatsApp.',
          ),
          findsOneWidget,
        );
        expect(find.text('Открыть WhatsApp ещё раз'), findsNothing);
        expect(find.text('Введите 6 цифр из сообщения'), findsOneWidget);
        final resend = find.byKey(const ValueKey('otp-resend-button'));
        expect(tester.widget<TextButton>(resend).onPressed, isNull);
        final rect = tester.getRect(
          find.byKey(const ValueKey('auth-otp-field')),
        );
        expect(rect.left, greaterThanOrEqualTo(0));
        expect(rect.right, lessThanOrEqualTo(320));
        expect(tester.takeException(), isNull);

        await tester.pump(const Duration(seconds: 60));
        await tester.ensureVisible(resend);
        await tester.tap(resend);
        await tester.pumpAndSettle();
        expect(sends, 2);
        await tester.enterText(
          find.byKey(const ValueKey('auth-otp-field')),
          '1234',
        );
        // An incomplete focused Pinput keeps its cursor animation running.
        await tester.pump(const Duration(milliseconds: 300));
        expect(verifiedCode, isNull);
        await tester.enterText(
          find.byKey(const ValueKey('auth-otp-field')),
          '123456',
        );
        await tester.pumpAndSettle();
        expect(verifiedCode, '123456');
        expect(find.text('Завершение регистрации'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'automatic SMS recovery accepts a six-digit code and a new password',
    (tester) async {
      String? recoveredCode;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: LoginScreen(
            onLogin: (_, _) async => null,
            onStartRegistration: (_, _, _) async => const OtpRequestResult(),
            onVerifyRegistration: (_, _) async => null,
            onStartPasswordReset: (_, _) async => const OtpRequestResult(
              deliveryMode: 'automatic',
              channel: 'sms',
              codeLength: 6,
              retryAfterSeconds: 60,
            ),
            onResetPassword: (_, code, _) async {
              recoveredCode = code;
              return null;
            },
          ),
        ),
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-phone-field')),
        '7012345678',
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('forgot-password-button')),
      );
      await tester.tap(find.byKey(const ValueKey('forgot-password-button')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Получить код'));
      await tester.tap(find.text('Получить код'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('auth-otp-field')),
        '123456',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'NewPassword2026',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-confirm-password-field')),
        'NewPassword2026',
      );
      await tester.ensureVisible(find.text('Сохранить новый пароль'));
      await tester.tap(find.text('Сохранить новый пароль'));
      await tester.pumpAndSettle();
      expect(recoveredCode, '123456');
      await tester.pumpWidget(const SizedBox());
    },
  );
}
