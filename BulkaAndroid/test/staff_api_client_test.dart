import 'dart:convert';
import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test(
    '204 mutations succeed and stale 401 does not destroy a new login',
    () async {
      final stale = Completer<http.Response>();
      var unauthorized = 0;
      final api = StaffApiClient(
        baseUrl: 'https://bulka.test',
        client: MockClient((request) async {
          if (request.url.path.endsWith('/login')) {
            final username = jsonDecode(request.body)['username'];
            return http.Response(
              '{"user":{"role":"admin"}}',
              200,
              headers: {
                'set-cookie': 'bulka_admin=$username; Path=/admin; HttpOnly',
              },
            );
          }
          if (request.url.path.endsWith('/slow')) return stale.future;
          return http.Response('', 204);
        }),
      );
      api.onUnauthorized = () => unauthorized++;
      await api.login('old', 'test', '');
      final pending = api.request('/slow');
      final failure = expectLater(pending, throwsA(isA<StaffApiException>()));
      await api.login('new', 'test', '');
      stale.complete(http.Response('{}', 401));
      await failure;
      expect(unauthorized, 0);
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        'new',
      );
      expect(await api.request('/push-token', method: 'DELETE'), isEmpty);
      api.close();
    },
  );
  test(
    'employee token stays separate and every API request uses server scope',
    () async {
      final requests = <http.Request>[];
      final api = StaffApiClient(
        baseUrl: 'https://bulka.test',
        client: MockClient((request) async {
          requests.add(request);
          if (request.url.path.endsWith('/login')) {
            return http.Response(
              jsonEncode({
                'user': {'username': 'test', 'role': 'admin'},
              }),
              200,
              headers: {
                'set-cookie':
                    'bulka_admin=test-staff-token; Path=/admin; HttpOnly; Secure',
              },
            );
          }
          return http.Response(
            jsonEncode({
              'user': {'role': 'admin'},
            }),
            200,
          );
        }),
      );
      final user = await api.login('test', 'test-password', '123456');
      expect(user['role'], 'admin');
      expect(requests.first.headers['Authorization'], isNull);
      expect(jsonDecode(requests.first.body)['code'], '123456');
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        'test-staff-token',
      );
      api.branchId = 'branch-1';
      await api.request('/orders');
      expect(requests.last.headers['Authorization'], 'Bearer test-staff-token');
      expect(requests.last.headers['X-Bulka-Branch-Id'], 'branch-1');
      expect(requests.last.followRedirects, isFalse);
      await api.logout();
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        isNull,
      );
      api.close();
    },
  );
  test('rejects off-origin paths without sending a request', () async {
    var count = 0;
    final api = StaffApiClient(
      baseUrl: 'https://bulka.test',
      client: MockClient((_) async {
        count++;
        return http.Response('{}', 200);
      }),
    );
    for (final endpoint in [
      'https://external.test',
      '//external.test',
      '/../private',
    ]) {
      await expectLater(api.request(endpoint), throwsArgumentError);
    }
    expect(count, 0);
    api.close();
  });
  test(
    'revoked session is cleared but forbidden request is not a logout',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        StaffApiClient.sessionKey: 'test-token',
      });
      var status = 200, unauthorized = 0;
      final api = StaffApiClient(
        baseUrl: 'https://bulka.test',
        client: MockClient(
          (_) async => http.Response(
            jsonEncode(
              status == 200
                  ? {
                      'user': {'role': 'viewer'},
                    }
                  : {'error': 'denied'},
            ),
            status,
          ),
        ),
      );
      api.onUnauthorized = () => unauthorized++;
      await api.restore();
      status = 403;
      await expectLater(
        api.request('/settings'),
        throwsA(isA<StaffApiException>()),
      );
      expect(unauthorized, 0);
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        'test-token',
      );
      status = 401;
      expect(await api.restore(), isNull);
      expect(unauthorized, 1);
      await Future<void>.delayed(Duration.zero);
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        isNull,
      );
      api.close();
    },
  );
  test('async report stops polling after cancellation', () async {
    var cancelled = false, count = 0;
    final api = StaffApiClient(
      baseUrl: 'https://bulka.test',
      client: MockClient((_) async {
        count++;
        cancelled = true;
        return http.Response('{"pending":true}', 202);
      }),
    );
    await expectLater(
      api.report('/iiko-dashboard/controls', {}, isCancelled: () => cancelled),
      throwsA(
        isA<StaffApiException>().having((e) => e.code, 'code', 'CANCELLED'),
      ),
    );
    expect(count, 1);
    api.close();
  });
}
