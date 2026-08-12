import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/staff_push_bridge_contract.dart';
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
    expect(portal.path, '/admin/kitchen');
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

  test('staff push bridge accepts only strict signed native requests', () {
    const nonce = 'trusted-page-nonce';
    final request = StaffPushBridgeRequest.tryParse(
      '{"version":1,"requestId":"request_12345678",'
      '"action":"register","nonce":"trusted-page-nonce",'
      '"userInitiated":true}',
      expectedNonce: nonce,
    );

    expect(request, isNotNull);
    expect(request!.action, StaffPushBridgeAction.register);
    expect(request.userInitiated, isTrue);
    expect(
      StaffPushBridgeRequest.tryParse(
        '{"version":1,"requestId":"request_12345678",'
        '"action":"register","nonce":"attacker",'
        '"userInitiated":true}',
        expectedNonce: nonce,
      ),
      isNull,
    );
    expect(
      StaffPushBridgeRequest.tryParse(
        '{"version":1,"requestId":"request_12345678",'
        '"action":"erase","nonce":"trusted-page-nonce",'
        '"userInitiated":true}',
        expectedNonce: nonce,
      ),
      isNull,
    );
    expect(
      StaffPushBridgeRequest.tryParse(
        '{"version":1,"requestId":"request_12345678",'
        '"action":"register","nonce":"trusted-page-nonce",'
        '"userInitiated":true,"token":"leak"}',
        expectedNonce: nonce,
      ),
      isNull,
    );
  });

  test('staff push bridge route is exact and native mobile only', () {
    expect(isStaffPushBridgePath('/admin/kitchen'), isTrue);
    expect(isStaffPushBridgePath('/admin/kitchen/'), isTrue);
    expect(isStaffPushBridgePath('/admin'), isFalse);
    expect(isStaffPushBridgePath('/admin/kitchen/export'), isFalse);
    expect(isStaffPushCapabilityPath('/admin/orders'), isTrue);
    expect(isStaffPushCapabilityPath('/admin/orders/'), isTrue);
    expect(isStaffPushCapabilityPath('/admin'), isTrue);
    expect(isStaffPushCapabilityPath('/admin2'), isFalse);
    expect(isStaffPushCapabilityPath('/customer/orders'), isFalse);
    expect(
      supportsNativeStaffPushBridge(isWeb: false, platform: 'ios'),
      isTrue,
    );
    expect(
      supportsNativeStaffPushBridge(isWeb: false, platform: 'android'),
      isTrue,
    );
    expect(
      supportsNativeStaffPushBridge(isWeb: true, platform: 'ios'),
      isFalse,
    );
    expect(
      supportsNativeStaffPushBridge(isWeb: false, platform: 'windows'),
      isFalse,
    );
  });

  test(
    'all admin pages announce native capability but only kitchen gets requests',
    () {
      final ordersBootstrap = buildStaffPushBridgeBootstrap(
        platform: 'ios',
        nonce: null,
        exposeRequestBridge: false,
      );
      final kitchenBootstrap = buildStaffPushBridgeBootstrap(
        platform: 'ios',
        nonce: 'trusted-page-nonce',
        exposeRequestBridge: true,
      );

      expect(ordersBootstrap, contains(staffPushBridgeReadyEvent));
      expect(
        RegExp(
          RegExp.escape(staffPushBridgeReadyEvent),
        ).allMatches(ordersBootstrap),
        hasLength(1),
      );
      expect(ordersBootstrap, contains(staffPushCapabilityMarker));
      expect(ordersBootstrap, contains('configurable: false'));
      expect(ordersBootstrap, contains('writable: false'));
      expect(ordersBootstrap, contains("delete window.BulkaStaffPushBridge"));
      expect(ordersBootstrap, isNot(contains(staffPushNativeChannel)));
      expect(kitchenBootstrap, contains(staffPushBridgeReadyEvent));
      expect(kitchenBootstrap, contains(staffPushNativeChannel));
      expect(kitchenBootstrap, contains('trusted-page-nonce'));
      expect(kitchenBootstrap, contains("'BulkaStaffPushBridge'"));
    },
  );

  test('staff push bridge activation follows SPA route transitions', () {
    final spaPaths = [
      '/admin',
      '/admin/kitchen', // history.pushState after employee login
      '/admin/orders',
      '/admin/kitchen', // popstate/back to the kitchen
    ];

    expect(spaPaths.map(isStaffPushBridgePath), [false, true, false, true]);
  });

  test('staff order payload wins over a generic customer order id', () {
    final target = resolveNotificationPayload({
      'type': 'staff.order.new',
      'orderId': 'customer-order-must-not-open',
      'url': 'https://attacker.example/admin',
    });

    expect(target.kind, NotificationTargetKind.staffKitchen);
    expect(target.resourceId, isNull);
    expect(target.uri, isNull);
    expect(notificationTargetRequiresCustomerAuth(target.kind), isFalse);
    expect(
      notificationTargetRequiresCustomerAuth(NotificationTargetKind.order),
      isTrue,
    );
    expect(bulkaAdminKitchenUri().path, '/admin/kitchen');
    expect(bulkaAdminKitchenUri().queryParameters['embedded'], 'app');
  });

  test('staff test push opens only the hardcoded kitchen target', () {
    final target = resolveNotificationPayload({
      'type': 'staff.order.test',
      'orderId': 'customer-order-must-not-open',
      'url': 'https://attacker.example/admin',
      'deepLink': '/admin/users',
    });

    expect(target.kind, NotificationTargetKind.staffKitchen);
    expect(target.resourceId, isNull);
    expect(target.uri, isNull);
    expect(notificationTargetRequiresCustomerAuth(target.kind), isFalse);
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
