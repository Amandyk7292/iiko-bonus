import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('guest analytics uses the public endpoint without starting refresh', () async {
    final paths = <String>[];
    final api = BulkaApiClient(
      client: MockClient((request) async {
        paths.add(request.url.path);
        return http.Response(
          jsonEncode({'success': true, 'accepted': 1}),
          202,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    await api.recordAnalyticsEvents([
      {
        'eventId': '317615f9-b35f-4eb4-9f6d-777f2236bb25',
        'type': 'catalog_view',
      },
    ]);

    expect(paths, ['/api/public/analytics/events']);
    expect(paths, isNot(contains('/api/auth/refresh')));
    api.dispose();
  });

  test('public analytics rejection never attempts an account refresh', () async {
    final paths = <String>[];
    final api = BulkaApiClient(
      client: MockClient((request) async {
        paths.add(request.url.path);
        return http.Response(
          jsonEncode({'success': false, 'error': 'rate limited'}),
          401,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    await expectLater(
      api.recordAnalyticsEvents([
        {
          'eventId': '417615f9-b35f-4eb4-9f6d-777f2236bb25',
          'type': 'product_view',
        },
      ]),
      throwsA(isA<ApiException>()),
    );

    expect(paths, ['/api/public/analytics/events']);
    api.dispose();
  });

  test('authenticated analytics keeps customer attribution and refresh support', () async {
    final paths = <String>[];
    final api = BulkaApiClient(
      client: MockClient((request) async {
        paths.add(request.url.path);
        expect(request.headers['authorization'], 'Bearer access-token');
        return http.Response(
          jsonEncode({'success': true, 'accepted': 1}),
          202,
          headers: {'content-type': 'application/json'},
        );
      }),
    )..setSession(accessToken: 'access-token', refreshToken: 'refresh-token');

    await api.recordAnalyticsEvents([
      {
        'eventId': '517615f9-b35f-4eb4-9f6d-777f2236bb25',
        'type': 'checkout_started',
      },
    ]);

    expect(paths, ['/api/customer/analytics/events']);
    api.dispose();
  });
}
