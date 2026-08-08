import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
    'web refresh aborts an account A retry after the cookie switches to B',
    () async {
      var staleRequestCalls = 0;
      var identityHydrated = false;
      late final BulkaApiClient api;
      api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.url.path == '/api/auth/refresh') {
            return http.Response(
              jsonEncode({
                'success': true,
                'accessToken': 'account-b-access',
                'sessionIdentity': {'id': 'account-b', 'phone': '77000000002'},
              }),
              200,
            );
          }
          if (request.url.path == '/api/customer/loyalty') {
            staleRequestCalls++;
            return http.Response('{"error":"expired"}', 401);
          }
          return http.Response('{"success":true}', 200);
        }),
        onSessionChanged: (access, refresh) async {
          if (access == null) return;
          expect(api.sessionPhone, '77000000002');
          await Future<void>.delayed(const Duration(milliseconds: 1));
          api.setSession(accessToken: access, cacheScope: api.sessionPhone);
          identityHydrated = true;
        },
        useCookieSessionTransport: true,
      )..setSession(accessToken: 'account-a-access', cacheScope: '77000000001');

      await expectLater(
        api.getCustomerLoyalty(),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'SESSION_IDENTITY_CHANGED',
          ),
        ),
      );

      expect(identityHydrated, isTrue);
      expect(staleRequestCalls, 1);
      expect(api.accessToken, 'account-b-access');
      expect(api.sessionPhone, '77000000002');
      api.dispose();
    },
  );

  test('web force restore refreshes an existing tab access token', () async {
    var refreshCalls = 0;
    final api = BulkaApiClient(
      client: MockClient((request) async {
        expect(request.url.path, '/api/auth/refresh');
        refreshCalls++;
        return http.Response(
          jsonEncode({
            'success': true,
            'accessToken': 'cookie-verified-access',
            'sessionIdentity': {'id': 'account-a', 'phone': '77000000001'},
          }),
          200,
        );
      }),
      useCookieSessionTransport: true,
    )..setSession(accessToken: 'tab-cached-access', cacheScope: '77000000001');

    expect(await api.restoreSession(force: true), isTrue);
    expect(refreshCalls, 1);
    expect(api.accessToken, 'cookie-verified-access');
    api.dispose();
  });
}
