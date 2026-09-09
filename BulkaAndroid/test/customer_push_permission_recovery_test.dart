import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/staff_push_bridge_contract.dart';
// Exercise Firebase's real platform-channel adapter.
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Api extends BulkaApiClient {
  final tokens = <String>[];
  _Api() : super(client: MockClient((_) async => http.Response('{}', 404))) {
    setSession(accessToken: 'fixture', cacheScope: '77760000000');
  }
  @override
  Future<void> registerFcmToken(
    String token, {
    required String platform,
    required String installationId,
  }) async => tokens.add(token);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'Android cashier asks on first opt-in and preserves a later denial',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      FlutterSecureStorage.setMockInitialValues({});
      SharedPreferences.setMockInitialValues({});
      TestFirebaseCoreHostApi.setUp(MockFirebaseApp());
      var authorization = 0, requests = 0;
      const channel = MethodChannel('plugins.flutter.io/firebase_messaging');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'Messaging#getNotificationSettings') {
              return {'authorizationStatus': authorization};
            }
            if (call.method == 'Messaging#requestPermission') {
              requests++;
              authorization = 1;
              return {'authorizationStatus': authorization};
            }
            if (call.method == 'Messaging#getToken') {
              return {'token': 'cashier-fixture-token'};
            }
            return null;
          });
      Future<Map<String, Object?>> register(bool user) =>
          PushNotifications.handleStaffPushBridgeRequest(
            StaffPushBridgeRequest(
              requestId: 'android-cashier-fixture',
              action: StaffPushBridgeAction.register,
              userInitiated: user,
            ),
          );
      expect((await register(false))['error'], 'permission_required');
      expect(requests, 0);
      final granted = await register(true);
      expect(granted['ok'], true);
      expect(granted['platform'], 'android');
      expect(granted['fcmToken'], 'cashier-fixture-token');
      expect(requests, 1);
      authorization = 0;
      expect((await register(true))['error'], 'permission_denied');
      expect(requests, 1);
    },
  );
  test(
    'skipped onboarding requests once after sign-in, respects denial and logout',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      FlutterSecureStorage.setMockInitialValues({});
      SharedPreferences.setMockInitialValues({
        BulkaPermissionGate.completedKey: true,
        // iOS is authoritative even after a restored preference says prompted.
        'pushPermissionPromptedV1': true,
      });
      TestFirebaseCoreHostApi.setUp(MockFirebaseApp());
      const channel = MethodChannel('plugins.flutter.io/firebase_messaging');
      var authorization = -1, requests = 0;
      final promptOpened = Completer<void>(), answer = Completer<void>();
      Completer<void>? settingsWait, settingsOpened;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            switch (call.method) {
              case 'Messaging#getNotificationSettings':
                settingsOpened?.complete();
                await settingsWait?.future;
                return {'authorizationStatus': authorization};
              case 'Messaging#requestPermission':
                requests++;
                if (!promptOpened.isCompleted) promptOpened.complete();
                await answer.future;
                authorization = 1;
                return {'authorizationStatus': authorization};
              case 'Messaging#getAPNSToken':
                return {'token': 'fixture-apns'};
              case 'Messaging#getToken':
                return {'token': 'recovered-token'};
              default:
                return null;
            }
          });
      final api = _Api();
      addTearDown(api.dispose);
      final first = PushNotifications.requestCustomerPermissionAfterSignIn(api);
      final concurrent = PushNotifications.requestCustomerPermissionAfterSignIn(
        api,
      );
      expect(identical(first, concurrent), isTrue);
      await promptOpened.future;
      expect(requests, 1);
      expect(api.tokens, isEmpty);
      answer.complete();
      await Future.wait([first, concurrent]);
      expect(api.tokens, ['recovered-token']);

      await PushNotifications.requestCustomerPermissionAfterSignIn(api);
      expect(requests, 1);
      final registered = api.tokens.length;
      authorization = 0;
      await PushNotifications.requestCustomerPermissionAfterSignIn(api);
      expect(requests, 1);
      expect(api.tokens.length, registered);

      // A session revoked while iOS settings are being read must not prompt.
      authorization = -1;
      settingsWait = Completer<void>();
      settingsOpened = Completer<void>();
      final interrupted =
          PushNotifications.requestCustomerPermissionAfterSignIn(api);
      await settingsOpened.future;
      api.setSession();
      settingsWait.complete();
      await interrupted;
      await PushNotifications.requestCustomerPermissionAfterSignIn(api);
      expect(requests, 1);
      expect(api.tokens.length, registered);

      // Android reports denied before its first runtime prompt. Ask once,
      // then preserve the user's denial on later sign-ins.
      settingsWait = null;
      settingsOpened = null;
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      api.setSession(accessToken: 'fixture', cacheScope: '77760000000');
      authorization = 0;
      await (await SharedPreferences.getInstance()).remove(
        'pushPermissionPromptedV1',
      );
      await PushNotifications.requestCustomerPermissionAfterSignIn(api);
      expect(requests, 2);
      authorization = 0;
      await PushNotifications.requestCustomerPermissionAfterSignIn(api);
      expect(requests, 2);
    },
  );
}
