import 'dart:async';
import 'package:bulka_bonus/main.dart';
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
