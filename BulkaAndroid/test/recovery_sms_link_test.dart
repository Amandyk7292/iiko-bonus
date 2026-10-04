import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _link = OtpRequestResult(
  deliveryMode: 'sms_link',
  channel: 'sms',
  retryAfterSeconds: 60,
);

Future<void> _tap(
  WidgetTester tester,
  Finder target, {
  bool settle = true,
}) async {
  await tester.pump();
  await tester.ensureVisible(target);
  await tester.tap(target);
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

Future<void> _show(
  WidgetTester tester, {
  Future<OtpRequestResult> Function(String, String)? request,
  VoidCallback? close,
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: LoginScreen(
        onLogin: (_, _) async => null,
        onStartRegistration: (_, _, _) async => const OtpRequestResult(),
        onVerifyRegistration: (_, _) async => null,
        onStartPasswordReset: request ?? (_, _) async => _link,
        onResetPassword: (_, _, _) async =>
            throw StateError('No in-app credential reset'),
        onClose: close,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _recovery(WidgetTester tester) async {
  await _tap(tester, find.byKey(const ValueKey('forgot-password-button')));
  await tester.enterText(
    find.byKey(const ValueKey('auth-phone-field')),
    '7012345678',
  );
}

void _noLegacy() {
  expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
  expect(find.byKey(const ValueKey('auth-password-field')), findsNothing);
  expect(
    find.byKey(const ValueKey('auth-confirm-password-field')),
    findsNothing,
  );
  expect(find.textContaining('WhatsApp'), findsNothing);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  tearDown(() => appLanguageNotifier.value = 'ru');

  test(
    'recovery API retains SMS-link metadata without a completion request',
    () async {
      final paths = <String>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          paths.add(request.url.path);
          expect(jsonDecode(request.body), {
            'phone': '+77012345678',
            'token': 'RequestToken23456',
            'otpDeliveryVersion': 2,
          });
          return http.Response(
            jsonEncode({
              'success': true,
              'deliveryMode': 'sms_link',
              'channel': 'sms',
              'retryAfterSeconds': 60,
              'expiresInSeconds': 900,
            }),
            200,
          );
        }),
      );
      addTearDown(api.dispose);
      final result = await api.startPasswordReset(
        phone: '+77012345678',
        token: 'RequestToken23456',
      );
      expect(result.isSmsLink, true);
      expect(result.isAutomatic, false);
      expect(result.retryAfterSeconds, 60);
      expect(paths, ['/api/auth/password-reset/start']);
    },
  );

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets('$language login subtitles and their gap are absent', (
      tester,
    ) async {
      appLanguageNotifier.value = language;
      await _show(tester);
      expect(find.text('auth_login_subtitle'.tr), findsNothing);
      final title = tester.getRect(find.text('auth_login_title'.tr));
      final phone = tester.getRect(
        find.byKey(const ValueKey('auth-phone-field')),
      );
      expect(phone.top - title.bottom, closeTo(22, 0.1));
      await _tap(tester, find.byKey(const ValueKey('auth-method-password')));
      expect(find.text('auth_admin_subtitle'.tr), findsNothing);
      final adminTitle = tester.getRect(find.text('auth_login_title'.tr));
      final username = tester.getRect(
        find.byKey(const ValueKey('auth-admin-username')),
      );
      expect(username.top - adminTitle.bottom, closeTo(22, 0.1));
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      '$language SMS link waiting fits 320px at 200% text and resends',
      (tester) async {
        appLanguageNotifier.value = language;
        tester.view.physicalSize = const Size(320, 760);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var calls = 0;
        await _show(
          tester,
          scale: 2,
          request: (phone, token) async {
            expect(phone, '+77012345678');
            expect(token.length, 16);
            calls++;
            return _link;
          },
        );
        await _recovery(tester);
        _noLegacy();
        await _tap(tester, find.text('auth_recovery_button'.tr));
        expect(calls, 1);
        expect(find.text('auth_recovery_link_sent'.tr), findsOneWidget);
        _noLegacy();
        final resend = find.byKey(
          const ValueKey('recovery-link-resend-button'),
        );
        expect(tester.widget<TextButton>(resend).onPressed, isNull);
        await tester.pump(const Duration(seconds: 60));
        await _tap(tester, resend);
        expect(calls, 2);
        expect(tester.widget<TextButton>(resend).onPressed, isNull);
        final change = find.byKey(const ValueKey('recovery-link-change-phone'));
        await tester.ensureVisible(change);
        final rect = tester.getRect(change);
        expect(rect.left, greaterThanOrEqualTo(0));
        expect(rect.right, lessThanOrEqualTo(320));
        expect(tester.takeException(), isNull);
        await _tap(tester, change);
        expect(find.byKey(const ValueKey('auth-phone-field')), findsOneWidget);
        expect(find.text('auth_recovery_link_sent'.tr), findsNothing);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  final unsupported = <String, OtpRequestResult>{
    'legacy WhatsApp': const OtpRequestResult(
      whatsappUrl: 'https://wa.me/77000000000',
    ),
    'SMS OTP': const OtpRequestResult(
      deliveryMode: 'automatic',
      channel: 'sms',
      codeLength: 6,
    ),
    'WhatsApp link': const OtpRequestResult(
      deliveryMode: 'sms_link',
      channel: 'whatsapp',
    ),
    'missing channel': const OtpRequestResult(deliveryMode: 'sms_link'),
    'failed link': const OtpRequestResult(
      error: 'offline',
      deliveryMode: 'sms_link',
      channel: 'sms',
    ),
  };
  for (final entry in unsupported.entries) {
    testWidgets('${entry.key} never claims a recovery link or starts OTP', (
      tester,
    ) async {
      await _show(tester, request: (_, _) async => entry.value);
      await _recovery(tester);
      await _tap(tester, find.text('auth_recovery_button'.tr));
      expect(find.text('auth_recovery_link_sent'.tr), findsNothing);
      expect(find.byKey(const ValueKey('auth-phone-field')), findsOneWidget);
      _noLegacy();
      expect(
        find.text(entry.value.error ?? 'error_recovery_link'.tr),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('cancelled recovery cannot replace a newer pending request', (
    tester,
  ) async {
    final old = Completer<OtpRequestResult>(),
        current = Completer<OtpRequestResult>();
    var calls = 0;
    await _show(
      tester,
      request: (_, _) => ++calls == 1 ? old.future : current.future,
    );
    await _recovery(tester);
    await _tap(tester, find.text('auth_recovery_button'.tr), settle: false);
    await _tap(tester, find.text('auth_back_to_login'.tr));
    await _recovery(tester);
    await _tap(tester, find.text('auth_recovery_button'.tr), settle: false);
    old.complete(_link);
    await tester.pump();
    expect(find.text('auth_recovery_link_sent'.tr), findsNothing);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('auth-phone-field')))
          .enabled,
      false,
    );
    current.complete(const OtpRequestResult(error: 'new failure'));
    await tester.pumpAndSettle();
    expect(find.text('new failure'), findsOneWidget);
    expect(find.text('auth_recovery_link_sent'.tr), findsNothing);
    _noLegacy();
    expect(tester.takeException(), isNull);
  });

  testWidgets('change phone discards a delayed resend and old timer', (
    tester,
  ) async {
    final pending = Completer<OtpRequestResult>();
    var calls = 0;
    await _show(
      tester,
      request: (_, _) => ++calls == 1 ? Future.value(_link) : pending.future,
    );
    await _recovery(tester);
    await _tap(tester, find.text('auth_recovery_button'.tr));
    await tester.pump(const Duration(seconds: 60));
    await _tap(
      tester,
      find.byKey(const ValueKey('recovery-link-resend-button')),
      settle: false,
    );
    await _tap(
      tester,
      find.byKey(const ValueKey('recovery-link-change-phone')),
    );
    await tester.enterText(
      find.byKey(const ValueKey('auth-phone-field')),
      '7010000000',
    );
    pending.complete(_link);
    await tester.pumpAndSettle();
    expect(find.text('auth_recovery_link_sent'.tr), findsNothing);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('auth-phone-field')))
          .controller!
          .text,
      '7010000000',
    );
    _noLegacy();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'failed resend stays retryable without resetting cooldown or completing password reset',
    (tester) async {
      var calls = 0;
      await _show(
        tester,
        request: (_, _) async =>
            ++calls == 2 ? const OtpRequestResult(error: 'offline') : _link,
      );
      await _recovery(tester);
      await _tap(tester, find.text('auth_recovery_button'.tr));
      await tester.pump(const Duration(seconds: 60));
      final resend = find.byKey(const ValueKey('recovery-link-resend-button'));
      await _tap(tester, resend);
      expect(find.text('offline'), findsOneWidget);
      expect(tester.widget<TextButton>(resend).onPressed, isNotNull);
      await _tap(tester, resend);
      expect(calls, 3);
      expect(find.text('offline'), findsNothing);
      expect(tester.widget<TextButton>(resend).onPressed, isNull);
      _noLegacy();
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'disposing pending recovery ignores completion and disposes active countdown',
    (tester) async {
      final pending = Completer<OtpRequestResult>();
      await _show(tester, request: (_, _) => pending.future);
      await _recovery(tester);
      await _tap(tester, find.text('auth_recovery_button'.tr), settle: false);
      await tester.pumpWidget(const SizedBox());
      pending.complete(_link);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _show(tester);
      await _recovery(tester);
      await _tap(tester, find.text('auth_recovery_button'.tr));
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 61));
      expect(tester.takeException(), isNull);
    },
  );
}
