import 'dart:async';
import 'package:bulka_bonus/main.dart';
// Firebase's own Pigeon test harness exercises the real Messaging channel.
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Core extends MockFirebaseApp {
  final ready = Completer<void>();
  @override
  Future<List<CoreInitializeResponse>> initializeCore() async {
    await ready.future;
    return super.initializeCore();
  }
}

class _Api extends BulkaApiClient {
  final tokens = <String>[];
  bool offline = false;
  _Api() : super(client: MockClient((_) async => http.Response('{}', 404))) {
    setSession(accessToken: 'fixture', cacheScope: '77760000000');
  }
  @override
  Future<void> registerFcmToken(
    String token, {
    required String platform,
    required String installationId,
  }) async {
    if (offline) throw StateError('offline');
    tokens.add(token);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'customer registration waits for Firebase, retries late APNs and offline registration without another prompt',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      FlutterSecureStorage.setMockInitialValues({});
      SharedPreferences.setMockInitialValues({});
      final core = _Core();
      TestFirebaseCoreHostApi.setUp(core);
      const channel = MethodChannel('plugins.flutter.io/firebase_messaging');
      var apnsReady = false, permissionRequests = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            switch (call.method) {
              case 'Messaging#getNotificationSettings':
                return {'authorizationStatus': 1};
              case 'Messaging#requestPermission':
                permissionRequests++;
                return {'authorizationStatus': 1};
              case 'Messaging#getAPNSToken':
                return {'token': apnsReady ? 'fixture-apns' : null};
              case 'Messaging#getToken':
                return {'token': 'fresh-installation-token'};
              default:
                return null;
            }
          });
      final api = _Api();
      final registration = PushNotifications.register(api);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(api.tokens, isEmpty);
      core.ready.complete();
      await registration.timeout(const Duration(seconds: 10));
      expect(api.tokens, isEmpty);
      apnsReady = true;
      api.offline = true;
      final retry = PushNotifications.register(api);
      await retry;
      expect(api.tokens, isEmpty);
      api.offline = false;
      final recovery = PushNotifications.register(api);
      await recovery;
      expect(api.tokens, ['fresh-installation-token']);
      expect(permissionRequests, 0);
      api.dispose();
    },
  );
}
