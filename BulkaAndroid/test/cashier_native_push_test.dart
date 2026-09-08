import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/staff_push_bridge_contract.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
  });
  testWidgets(
    'failed enrollment recovers on foreground timer without another permission prompt',
    (tester) async {
      var offline = true, enabled = false;
      var registrationAttempts = 0;
      var permissionPrompts = 0;
      final api = StaffApiClient(
        client: MockClient((request) async {
          if (offline) throw http.ClientException('fixture offline');
          if (request.method == 'POST' &&
              request.url.path.endsWith('/push-token')) {
            registrationAttempts++;
            enabled = true;
          }
          return http.Response(
            jsonEncode({'enabled': enabled, 'active': enabled}),
            200,
          );
        }),
      );
      final push = StaffNativePush(
        api,
        native: (action, user) async {
          if (user) permissionPrompts++;
          return {
            'ok': true,
            'installationId': 'fixture-retry',
            'platform': 'ios',
            'staffEnrollmentIntent': true,
            'fcmToken': 'fixture-recovered-token',
          };
        },
      );
      await tester.pump();
      await push.synchronize();
      expect(push.enabled, isFalse);
      offline = false;
      await tester.pump(const Duration(seconds: 45));
      await tester.pump();
      expect(push.enabled, isTrue, reason: push.error);
      expect(registrationAttempts, 1);
      expect(permissionPrompts, 0);
      push.dispose();
      api.close();
    },
  );
  test(
    'cashier enrolls, rebinds refreshed FCM token, heartbeats and preserves mute',
    () async {
      var enabled = false, intent = false;
      var fcmToken = 'fixture-fcm-1';
      var permissionRequests = 0;
      final posts = <Map<String, dynamic>>[];
      final tokenEvents = StreamController<Map<String, Object?>>.broadcast();
      final api = StaffApiClient(
        client: MockClient((request) async {
          expect(request.headers['Authorization'], 'Bearer staff-fixture');
          if (request.method == 'POST') {
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            posts.add({'path': request.url.path, ...body});
            if (request.url.path.endsWith('/push-token')) enabled = true;
          } else if (request.method == 'DELETE') {
            enabled = false;
          }
          return http.Response(
            jsonEncode({'enabled': enabled, 'active': enabled}),
            200,
          );
        }),
      );
      await api.adoptSessionCookie('bulka_admin=staff-fixture');
      final push = StaffNativePush(
        api,
        tokenEvents: tokenEvents.stream,
        native: (action, user) async {
          if (action == StaffPushBridgeAction.register) {
            if (user) permissionRequests++;
            intent = true;
            return {'ok': true, 'fcmToken': fcmToken};
          }
          if (action == StaffPushBridgeAction.unregister) intent = false;
          return {
            'ok': true,
            'installationId': 'fixture-installation',
            'platform': 'ios',
            'staffEnrollmentIntent': intent,
          };
        },
      );
      addTearDown(() async {
        push.dispose();
        api.close();
        await tokenEvents.close();
      });
      await push.synchronize();
      expect(posts, isEmpty);
      await push.synchronize(user: true);
      expect(push.enabled, isTrue);
      expect(posts.last['fcmToken'], fcmToken);
      expect(permissionRequests, 1);
      fcmToken = 'fixture-fcm-2';
      tokenEvents.add({'tokenChanged': true});
      await Future<void>.delayed(Duration.zero);
      await push.synchronize();
      expect(posts.last['fcmToken'], 'fixture-fcm-2');
      expect(permissionRequests, 1);
      push.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await push.synchronize();
      await Future<void>.delayed(Duration.zero);
      expect(
        posts.any((post) => '${post['path']}'.endsWith('/push-heartbeat')),
        isTrue,
      );
      await push.disable();
      final postCount = posts.length;
      await push.synchronize();
      expect(push.enabled, isFalse);
      expect(posts.length, postCount);
      expect(permissionRequests, 1);
      expect(
        posts.any((post) => '${post['path']}'.endsWith('/push-test')),
        isFalse,
      );
    },
  );
}
