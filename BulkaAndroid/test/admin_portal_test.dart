import 'dart:async';

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

  test('admin portal wakelock is limited to native tablets', () {
    expect(
      shouldKeepAdminPortalAwake(
        screenSize: const Size(1024, 768),
        platform: TargetPlatform.iOS,
        isWeb: false,
      ),
      isTrue,
    );
    expect(
      shouldKeepAdminPortalAwake(
        screenSize: const Size(800, 1280),
        platform: TargetPlatform.android,
        isWeb: false,
      ),
      isTrue,
    );
    expect(
      shouldKeepAdminPortalAwake(
        screenSize: const Size(430, 932),
        platform: TargetPlatform.iOS,
        isWeb: false,
      ),
      isFalse,
    );
    expect(
      shouldKeepAdminPortalAwake(
        screenSize: const Size(1024, 768),
        platform: TargetPlatform.iOS,
        isWeb: true,
      ),
      isFalse,
    );
    expect(
      shouldKeepAdminPortalAwake(
        screenSize: const Size(1024, 768),
        platform: TargetPlatform.windows,
        isWeb: false,
      ),
      isFalse,
    );
  });

  test('portal preserves a wakelock that was already enabled', () async {
    var enableCalls = 0;
    var disableCalls = 0;
    final controller = AdminPortalWakelockController(
      isEnabled: () async => true,
      enable: () async => enableCalls++,
      disable: () async => disableCalls++,
    );

    await controller.setActive(true);
    await controller.dispose();

    expect(enableCalls, 0);
    expect(disableCalls, 0);
    expect(controller.acquired, isFalse);
  });

  test('portal releases only the wakelock it acquired', () async {
    var enabled = false;
    var enableCalls = 0;
    var disableCalls = 0;
    final controller = AdminPortalWakelockController(
      isEnabled: () async => enabled,
      enable: () async {
        enableCalls++;
        enabled = true;
      },
      disable: () async {
        disableCalls++;
        enabled = false;
      },
    );

    await controller.setActive(true);
    expect(controller.acquired, isTrue);
    await controller.setActive(false);

    expect(enableCalls, 1);
    expect(disableCalls, 1);
    expect(enabled, isFalse);
    expect(controller.acquired, isFalse);
  });

  test('portal disable wins an async dispose race', () async {
    final enableStarted = Completer<void>();
    final finishEnable = Completer<void>();
    var disableCalls = 0;
    final controller = AdminPortalWakelockController(
      isEnabled: () async => false,
      enable: () {
        enableStarted.complete();
        return finishEnable.future;
      },
      disable: () async => disableCalls++,
    );

    final activation = controller.setActive(true);
    await enableStarted.future;
    final disposal = controller.dispose();
    finishEnable.complete();
    await Future.wait([activation, disposal]);

    expect(disableCalls, 1);
    expect(controller.acquired, isFalse);
  });

  test('portal reacquires its wakelock after a foreground resume', () async {
    var enabled = false;
    var enableCalls = 0;
    var disableCalls = 0;
    final controller = AdminPortalWakelockController(
      isEnabled: () async => enabled,
      enable: () async {
        enableCalls++;
        enabled = true;
      },
      disable: () async {
        disableCalls++;
        enabled = false;
      },
    );

    await controller.setActive(true);
    await controller.setActive(false);
    await controller.setActive(true);
    await controller.dispose();

    expect(enableCalls, 2);
    expect(disableCalls, 2);
    expect(controller.acquired, isFalse);
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
