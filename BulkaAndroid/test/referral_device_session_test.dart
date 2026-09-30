import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/referral_device_identity.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> waitFor(bool Function() ready) async {
  for (var i = 0; i < 200 && !ready(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(ready(), isTrue);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(ReferralDeviceIdentity.channel, null);
  });
  for (final switchingAccount in [false, true]) {
    test(
      switchingAccount
          ? 'login switching discards previous account proof and registers the current one'
          : 'token refresh during verification keeps the same account enrollment without repeat proof',
      () async {
        final gate = Completer<String>();
        var proofs = 0;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(ReferralDeviceIdentity.channel, (
              call,
            ) async {
              if (call.method == 'androidId') return 'abcdef0123456789';
              proofs++;
              if (proofs == 1) return gate.future;
              return 'native-device-proof-second';
            });
        final enrollmentHeaders = <String?>[];
        final challengeHeaders = <String?>[];
        final api = BulkaApiClient(
          client: MockClient((request) async {
            if (request.url.path.endsWith('/device/challenge')) {
              challengeHeaders.add(request.headers['Authorization']);
              return http.Response(
                jsonEncode({
                  'success': true,
                  'nonce': 'challenge-nonce',
                  'challenge': 'server-signed-challenge',
                }),
                200,
              );
            }
            if (request.url.path.endsWith('/device')) {
              enrollmentHeaders.add(request.headers['Authorization']);
              return http.Response(
                jsonEncode({
                  'success': true,
                  'eligibility': {'eligible': true, 'reason': null},
                }),
                200,
              );
            }
            return http.Response(
              jsonEncode({
                'success': true,
                'referral': {'enabled': true},
              }),
              200,
            );
          }),
        );
        addTearDown(api.dispose);
        api.setSession(accessToken: 'account-a-token', cacheScope: 'account-a');
        await waitFor(() => proofs == 1);
        api.setSession(
          accessToken: switchingAccount
              ? 'account-b-token'
              : 'account-a-refreshed',
          cacheScope: switchingAccount ? 'account-b' : 'account-a',
        );
        gate.complete('native-device-proof-first');
        await api.getReferral();
        expect(enrollmentHeaders, [
          switchingAccount
              ? 'Bearer account-b-token'
              : 'Bearer account-a-refreshed',
        ]);
        expect(challengeHeaders.length, switchingAccount ? 2 : 1);
        await api.getReferral();
        expect(
          proofs,
          switchingAccount ? 2 : 1,
          reason:
              'opening referrals again must not repeatedly request attestation',
        );
      },
    );
  }
}
