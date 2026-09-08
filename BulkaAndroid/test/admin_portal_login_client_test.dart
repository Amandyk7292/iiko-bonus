import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  const cookie =
      'bulka_admin=fixture-session; Max-Age=43200; Path=/admin; '
      'Expires=Tue, 08 Sep 2026 23:00:00 GMT; HttpOnly; Secure; SameSite=Strict';

  test(
    'native login preserves the server cookie without customer credentials',
    () async {
      final installed = <String>[];
      final client = AdminPortalLoginClient(
        browserTransport: false,
        client: MockClient((request) async {
          expect(
            request.url.toString(),
            'https://bulka.com.kz/admin/api/login',
          );
          expect(request.method, 'POST');
          expect(request.followRedirects, false);
          expect(request.headers['Origin'], 'https://bulka.com.kz');
          expect(request.headers['Authorization'], isNull);
          expect(jsonDecode(request.body), {
            'username': 'admin',
            'password': 'secret',
            'code': '123456',
          });
          return http.Response(
            '{"user":{"username":"admin","role":"owner"}}',
            200,
            headers: {'set-cookie': cookie},
          );
        }),
        installCookie: (uri, value) async {
          expect(uri.toString(), 'https://bulka.com.kz/admin');
          installed.add(value);
        },
      );
      addTearDown(client.dispose);
      await client.login(' admin ', 'secret', '123456');
      expect(installed, [cookie]);
    },
  );

  test(
    'browser login succeeds with an unreadable HttpOnly response cookie',
    () async {
      final client = AdminPortalLoginClient(
        browserTransport: true,
        baseUrl: 'https://bulka.com.kz',
        client: MockClient((request) async {
          expect(jsonDecode(request.body), {
            'username': 'admin',
            'password': 'secret',
          });
          return http.Response('{"user":{"username":"admin"}}', 200);
        }),
        installCookie: (_, _) async =>
            fail('Browser cookies must not pass through Dart storage'),
      );
      addTearDown(client.dispose);
      await client.login('admin', 'secret', '');
    },
  );

  test('MFA challenge is distinguished from an invalid password', () async {
    for (final mfa in [false, true]) {
      final client = AdminPortalLoginClient(
        browserTransport: false,
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'error': mfa
                  ? 'Invalid credentials or verification code'
                  : 'Invalid credentials',
            }),
            401,
          ),
        ),
        installCookie: (_, _) async =>
            fail('Failed login cannot install a session'),
      );
      addTearDown(client.dispose);
      await expectLater(
        client.login('admin', 'secret', ''),
        throwsA(
          isA<AdminPortalLoginException>().having(
            (e) => e.needsCode,
            'MFA requested',
            mfa,
          ),
        ),
      );
    }
  });

  test('native login rejects missing or weakened cookie attributes', () async {
    for (final header in [
      '',
      cookie.replaceAll('; HttpOnly', ''),
      cookie.replaceAll('; Secure', ''),
      cookie.replaceAll('Path=/admin;', 'Path=/;'),
    ]) {
      final client = AdminPortalLoginClient(
        browserTransport: false,
        client: MockClient(
          (_) async => http.Response(
            '{"user":{}}',
            200,
            headers: {'set-cookie': header},
          ),
        ),
        installCookie: (_, _) async =>
            fail('Invalid session must not reach the cookie store'),
      );
      addTearDown(client.dispose);
      await expectLater(
        client.login('admin', 'secret', ''),
        throwsA(isA<AdminPortalLoginException>()),
      );
    }
  });

  test('native login never sends credentials to a different origin', () async {
    final client = AdminPortalLoginClient(
      browserTransport: false,
      baseUrl: 'https://bulka.com.kz.attacker.example',
      client: MockClient((_) async {
        fail('Credentials must not leave Bulka');
      }),
    );
    addTearDown(client.dispose);
    await expectLater(
      client.login('admin', 'secret', ''),
      throwsA(isA<AdminPortalLoginException>()),
    );
  });

  test('redirect and malformed success never open an admin session', () async {
    for (final response in [
      http.Response('', 302, headers: {'location': 'https://attacker.example'}),
      http.Response('{"success":true}', 200),
    ]) {
      final client = AdminPortalLoginClient(
        browserTransport: false,
        client: MockClient((_) async => response),
        installCookie: (_, _) async => fail('No verified session'),
      );
      addTearDown(client.dispose);
      await expectLater(
        client.login('admin', 'secret', ''),
        throwsA(isA<AdminPortalLoginException>()),
      );
    }
  });
}
