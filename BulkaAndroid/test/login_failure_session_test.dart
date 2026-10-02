import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _existingIdentity = 'family:bd648ffb-b4a3-4bf4-9c1e-582663f1f171';
const _newIdentity = 'family:bd648ffb-b4a3-4bf4-9c1e-582663f1f172';

http.Response _response(Object body, int status) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

http.Response _invalidCredentials() => _response({
  'success': false,
  'code': 'INVALID_CREDENTIALS',
  'error': 'Неверный логин или пароль.',
}, 401);

http.Response _successfulLogin() => _response({
  'success': true,
  'accessToken': 'authenticated-access',
  'refreshToken': 'authenticated-refresh',
  'customer': {
    'id': 'child-demo',
    'name': 'Ребёнок',
    'phone': _newIdentity,
    'isFamilyChild': true,
  },
}, 200);

final _loginCases = [
  (
    name: 'child',
    path: '/api/auth/family-child/login',
    login: (BulkaApiClient api) =>
        api.loginFamilyChild(login: 'child_demo', password: 'WrongPassword123'),
  ),
  (
    name: 'customer',
    path: '/api/auth/login',
    login: (BulkaApiClient api) => api.loginWithPassword(
      phone: '+77012345678',
      password: 'WrongPassword123',
    ),
  ),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  for (final loginCase in _loginCases) {
    for (final mode in ['guest-cookie', 'existing-cookie', 'existing-native']) {
      test('${loginCase.name} $mode preserves invalid credentials', () async {
        final authPaths = <String>[];
        var sessionChanges = 0;
        final api = BulkaApiClient(
          client: MockClient((request) async {
            final path = request.url.path;
            if (path.startsWith('/api/auth/')) authPaths.add(path);
            if (path == loginCase.path) return _invalidCredentials();
            if (path == '/api/auth/refresh') {
              return _response({'error': 'No current session'}, 401);
            }
            return _response({'success': true}, 200);
          }),
          onSessionChanged: (_, _) async => sessionChanges++,
          useCookieSessionTransport: mode != 'existing-native',
        );
        addTearDown(api.dispose);
        if (mode != 'guest-cookie') {
          api.setSession(
            accessToken: 'existing-access',
            refreshToken: mode == 'existing-native' ? 'existing-refresh' : null,
            cacheScope: _existingIdentity,
          );
        }

        await expectLater(
          loginCase.login(api),
          throwsA(
            isA<ApiException>()
                .having((error) => error.code, 'code', 'INVALID_CREDENTIALS')
                .having((error) => error.statusCode, 'statusCode', 401),
          ),
        );
        expect(authPaths, [loginCase.path]);
        expect(sessionChanges, 0);
        expect(
          api.accessToken,
          mode == 'guest-cookie' ? null : 'existing-access',
        );
        expect(
          api.refreshToken,
          mode == 'existing-native' ? 'existing-refresh' : null,
        );
        expect(
          api.sessionPhone,
          mode == 'guest-cookie' ? null : _existingIdentity,
        );
      });
    }

    test('${loginCase.name} successful login response is preserved', () async {
      final authPaths = <String>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          authPaths.add(request.url.path);
          return _successfulLogin();
        }),
        useCookieSessionTransport: true,
      );
      addTearDown(api.dispose);
      final profile = await loginCase.login(api);
      expect(profile.success, isTrue);
      expect(profile.customer?.phone, _newIdentity);
      expect(profile.accessToken, 'authenticated-access');
      expect(profile.refreshToken, 'authenticated-refresh');
      expect(authPaths, [loginCase.path]);
      // The app adopts the profile after checking that the login is still current.
      expect(api.isAuthenticated, isFalse);
    });

    test(
      '${loginCase.name} preserves validation, blocked and rate-limit errors',
      () async {
        for (final (status, code) in [
          (400, 'VALIDATION_ERROR'),
          (403, 'FAMILY_MEMBER_BLOCKED'),
          (429, 'FAMILY_RATE_LIMITED'),
        ]) {
          final paths = <String>[];
          final api = BulkaApiClient(
            client: MockClient((request) async {
              paths.add(request.url.path);
              return _response({
                'success': false,
                'code': code,
                'error': code,
              }, status);
            }),
            useCookieSessionTransport: true,
          );
          try {
            await expectLater(
              loginCase.login(api),
              throwsA(
                isA<ApiException>()
                    .having((error) => error.code, 'code', code)
                    .having((error) => error.statusCode, 'statusCode', status),
              ),
            );
            expect(paths, [loginCase.path]);
          } finally {
            api.dispose();
          }
        }
      },
    );

    for (final status in [200, 401]) {
      test(
        '${loginCase.name} rejects late $status after identity changes',
        () async {
          final started = Completer<void>();
          final response = Completer<http.Response>();
          final authPaths = <String>[];
          final api = BulkaApiClient(
            client: MockClient((request) async {
              final path = request.url.path;
              if (path == loginCase.path) {
                authPaths.add(path);
                started.complete();
                return response.future;
              }
              return _response({'success': true}, 200);
            }),
            useCookieSessionTransport: true,
          );
          addTearDown(api.dispose);
          final pending = loginCase.login(api);
          final result = expectLater(
            pending,
            throwsA(
              isA<ApiException>().having(
                (error) => error.code,
                'code',
                'SESSION_IDENTITY_CHANGED',
              ),
            ),
          );
          await started.future;
          api.setSession(accessToken: 'newer-access', cacheScope: _newIdentity);
          response.complete(
            status == 200 ? _successfulLogin() : _invalidCredentials(),
          );
          await result;
          expect(authPaths, [loginCase.path]);
          expect(api.accessToken, 'newer-access');
          expect(api.sessionPhone, _newIdentity);
        },
      );
    }
  }

  for (final (language, submitLabel, errorLabel) in [
    ('ru', 'Войти', 'Неверный логин или пароль.'),
    ('kk', 'Кіру', 'Логин немесе құпиясөз қате.'),
  ]) {
    testWidgets(
      '$language child form shows credential error without refreshing guest cookies',
      (tester) async {
        appLanguageNotifier.value = language;
        final authPaths = <String>[];
        final api = BulkaApiClient(
          client: MockClient((request) async {
            authPaths.add(request.url.path);
            return request.url.path == '/api/auth/family-child/login'
                ? _invalidCredentials()
                : _response({'error': 'No current session'}, 401);
          }),
          useCookieSessionTransport: true,
        );
        addTearDown(api.dispose);
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: FamilyChildLoginScreen(
              onLogin: (login, password) async {
                await api.loginFamilyChild(login: login, password: password);
                return null;
              },
              onBack: () {},
            ),
          ),
        );
        await tester.enterText(find.byType(TextFormField).at(0), 'child_demo');
        await tester.enterText(
          find.byType(TextFormField).at(1),
          'WrongPassword123',
        );
        await tester.ensureVisible(find.text(submitLabel));
        await tester.tap(find.text(submitLabel));
        await tester.pumpAndSettle();
        expect(
          find.text('Аккаунт изменился в другой вкладке. Повторите действие.'),
          findsNothing,
        );
        expect(find.text(errorLabel), findsOneWidget);
        expect(authPaths, ['/api/auth/family-child/login']);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
