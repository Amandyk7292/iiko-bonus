import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
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

  test(
    'imports IPA 18 cookie, verifies role and keeps customer tokens separate',
    () async {
      const storage = FlutterSecureStorage();
      await storage.write(key: 'accessToken', value: 'customer-fixture');
      final requests = <http.Request>[];
      final session = StaffAccountSession(
        readPortalCookie: () async => 'bulka_admin=portal-fixture',
        clearPortalCookie: () async {},
        api: StaffApiClient(
          client: MockClient((request) async {
            requests.add(request);
            return http.Response(
              jsonEncode({
                'user': {'username': 'admin', 'role': 'admin'},
              }),
              200,
            );
          }),
        ),
      );
      addTearDown(session.dispose);
      await session.restore();
      expect(session.displayName, 'admin');
      expect(session.canOpenPortal, isTrue);
      expect(session.isCashier, isFalse);
      expect(requests.single.url.path, '/admin/api/session');
      expect(requests.single.headers['Authorization'], 'Bearer portal-fixture');
      expect(
        await storage.read(key: StaffApiClient.sessionKey),
        'portal-fixture',
      );
      expect(await storage.read(key: 'accessToken'), 'customer-fixture');
    },
  );

  test(
    'verified cashier survives restart and network loss, revoked session clears identity',
    () async {
      var responseStatus = 200;
      var networkDown = false;
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          client: MockClient((request) async {
            if (networkDown) throw http.ClientException('offline');
            return http.Response(
              jsonEncode({
                'user': {'username': 'cashier-1', 'role': 'cashier'},
              }),
              responseStatus,
            );
          }),
        ),
      );
      addTearDown(session.dispose);
      await const FlutterSecureStorage().write(
        key: StaffApiClient.sessionKey,
        value: 'saved-staff',
      );
      await session.restore();
      expect(session.isCashier, isTrue);
      expect(session.canOpenPortal, isFalse);
      networkDown = true;
      await session.restore();
      expect(session.isCashier, isTrue);
      networkDown = false;
      responseStatus = 401;
      await session.restore();
      expect(session.isAuthenticated, isFalse);
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        isNull,
      );
    },
  );

  test(
    'fresh login uses returned server role and logout revokes before clearing cookie',
    () async {
      final operations = <String>[];
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        clearPortalCookie: () async => operations.add('clear-cookie'),
        api: StaffApiClient(
          client: MockClient((request) async {
            operations.add(request.url.path);
            expect(request.headers['Authorization'], 'Bearer signed-cashier');
            return http.Response('{}', 200);
          }),
        ),
        loginClient: AdminPortalLoginClient(
          installCookie: (_, _) async => operations.add('install-cookie'),
          client: MockClient(
            (request) async => http.Response(
              jsonEncode({
                'user': {'username': 'admin', 'role': 'cashier'},
              }),
              200,
              headers: {
                'set-cookie':
                    'bulka_admin=signed-cashier; Path=/admin; HttpOnly; Secure; SameSite=Strict',
              },
            ),
          ),
        ),
      );
      addTearDown(session.dispose);
      await session.signIn('admin', 'fixture-password', '');
      expect(
        session.isCashier,
        isTrue,
        reason: 'Username does not confer admin privileges',
      );
      expect(session.canOpenPortal, isFalse);
      await Future.wait([session.logout(), session.logout()]);
      expect(session.isAuthenticated, isFalse);
      expect(operations, [
        'install-cookie',
        '/admin/api/logout',
        'clear-cookie',
      ]);
    },
  );

  test(
    'login waits for old restoration and old cookie cannot replace fresh token',
    () async {
      final oldCookie = Completer<String?>();
      final session = StaffAccountSession(
        readPortalCookie: () => oldCookie.future,
        loginClient: AdminPortalLoginClient(
          installCookie: (_, _) async {},
          client: MockClient(
            (_) async => http.Response(
              '{"user":{"username":"new","role":"admin"}}',
              200,
              headers: {
                'set-cookie':
                    'bulka_admin=new-token; Path=/admin; HttpOnly; Secure; SameSite=Strict',
              },
            ),
          ),
        ),
      );
      addTearDown(session.dispose);
      final restoring = session.restore();
      final signingIn = session.signIn('new', 'fixture-password', '');
      oldCookie.complete('bulka_admin=old-token');
      await Future.wait([restoring, signingIn]);
      expect(session.displayName, 'new');
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        'new-token',
      );
    },
  );

  test(
    'browser restores HttpOnly cookie session without exposing or persisting a bearer token',
    () async {
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient((request) async {
            expect(request.headers['Authorization'], isNull);
            return http.Response(
              '{"user":{"username":"web-admin","role":"admin"}}',
              200,
            );
          }),
        ),
      );
      addTearDown(session.dispose);
      await session.restore();
      expect(session.canOpenPortal, isTrue);
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        isNull,
      );
    },
  );

  test(
    'web login survives a fresh app instance with a non-secret hint only',
    () async {
      final loggedIn = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(browserTransport: true),
        loginClient: AdminPortalLoginClient(
          browserTransport: true,
          client: MockClient(
            (_) async => http.Response(
              '{"user":{"username":"web-cashier","role":"cashier"}}',
              200,
            ),
          ),
        ),
      );
      await loggedIn.signIn('web-cashier', 'fixture-password', '');
      expect(loggedIn.isCashier, isTrue);
      loggedIn.dispose();

      var probes = 0;
      final reloaded = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient((request) async {
            probes++;
            expect(request.url.path, '/admin/api/session');
            expect(request.headers['Authorization'], isNull);
            return http.Response(
              '{"user":{"username":"web-cashier","role":"cashier"}}',
              200,
            );
          }),
        ),
      );
      addTearDown(reloaded.dispose);
      final hint = await reloaded.readPreviousWebSession();
      expect(hint, isTrue);
      expect(
        reloaded.isAuthenticated,
        isFalse,
        reason: 'The hint is never an authenticated identity',
      );
      expect(
        shouldProbeStaffSession(
          isWeb: true,
          isAuthenticated: reloaded.isAuthenticated,
          hasPreviousWebSession: hint,
          currentUri: Uri(path: '/catalog'),
        ),
        isTrue,
      );
      await Future.wait([reloaded.restore(), reloaded.restore()]);
      expect(probes, 1);
      expect(reloaded.isCashier, isTrue);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getKeys(), {StaffAccountSession.previousWebSessionKey});
      expect(prefs.get(StaffAccountSession.previousWebSessionKey), isTrue);
      expect(
        await const FlutterSecureStorage().read(key: StaffApiClient.sessionKey),
        isNull,
      );
    },
  );

  test(
    'web restore migrates old cookie-only sessions and trusts server role',
    () async {
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient(
            (_) async => http.Response(
              '{"user":{"username":"web-user","role":"branch_manager"}}',
              200,
            ),
          ),
        ),
      );
      addTearDown(session.dispose);
      expect(await session.readPreviousWebSession(), isFalse);
      await session.restore();
      expect(session.isCashier, isFalse);
      expect(session.canOpenPortal, isTrue);
      expect(await session.readPreviousWebSession(), isTrue);
    },
  );

  test(
    'a revoked web cookie clears the hint and never authorizes a cashier',
    () async {
      SharedPreferences.setMockInitialValues({
        StaffAccountSession.previousWebSessionKey: true,
      });
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient((_) async => http.Response('{}', 401)),
        ),
      );
      addTearDown(session.dispose);
      expect(await session.readPreviousWebSession(), isTrue);
      expect(session.isAuthenticated, isFalse);
      await session.restore();
      expect(session.isAuthenticated, isFalse);
      expect(await session.readPreviousWebSession(), isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.containsKey(StaffAccountSession.previousWebSessionKey),
        isFalse,
      );
    },
  );

  test(
    'offline or 503 on a web reload retains the hint and can retry',
    () async {
      for (final offline in [true, false]) {
        SharedPreferences.setMockInitialValues({
          StaffAccountSession.previousWebSessionKey: true,
        });
        var unavailable = true;
        final session = StaffAccountSession(
          readPortalCookie: () async => null,
          api: StaffApiClient(
            browserTransport: true,
            client: MockClient((_) async {
              if (unavailable) {
                if (offline) throw http.ClientException('offline');
                return http.Response('{}', 503);
              }
              return http.Response(
                '{"user":{"username":"web-cashier","role":"cashier"}}',
                200,
              );
            }),
          ),
        );
        expect(await session.readPreviousWebSession(), isTrue);
        await session.restore();
        expect(session.error, isNotNull);
        expect(session.isAuthenticated, isFalse);
        expect(await session.readPreviousWebSession(), isTrue);
        unavailable = false;
        await session.restore();
        expect(session.error, isNull);
        expect(session.isCashier, isTrue);
        session.dispose();
      }
    },
  );

  test(
    'web logout keeps the hint on failure and clears it after revocation',
    () async {
      var logoutStatus = 503;
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        clearPortalCookie: () async {},
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient(
            (request) async => request.url.path.endsWith('/logout')
                ? http.Response('{}', logoutStatus)
                : http.Response(
                    '{"user":{"username":"web-cashier","role":"cashier"}}',
                    200,
                  ),
          ),
        ),
      );
      addTearDown(session.dispose);
      await session.restore();
      await expectLater(session.logout(), throwsA(isA<StaffApiException>()));
      expect(session.isCashier, isTrue);
      expect(await session.readPreviousWebSession(), isTrue);
      logoutStatus = 200;
      await session.logout();
      expect(session.isAuthenticated, isFalse);
      expect(await session.readPreviousWebSession(), isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.containsKey(StaffAccountSession.previousWebSessionKey),
        isFalse,
      );
    },
  );

  test('a failed web login cannot save a previous-session hint', () async {
    final session = StaffAccountSession(
      readPortalCookie: () async => null,
      api: StaffApiClient(browserTransport: true),
      loginClient: AdminPortalLoginClient(
        browserTransport: true,
        client: MockClient((_) async => http.Response('{}', 401)),
      ),
    );
    addTearDown(session.dispose);
    await expectLater(
      session.signIn('web-cashier', 'wrong-fixture', ''),
      throwsA(isA<AdminPortalLoginException>()),
    );
    expect(await session.readPreviousWebSession(), isFalse);
  });

  testWidgets(
    'timed-out web restore cannot revoke a successful retry with its late 401',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        StaffAccountSession.previousWebSessionKey: true,
      });
      final oldResponse = Completer<http.Response>();
      var calls = 0;
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient((_) async {
            if (++calls == 1) return oldResponse.future;
            return http.Response(
              '{"user":{"username":"retried-cashier","role":"cashier"}}',
              200,
            );
          }),
        ),
      );
      addTearDown(session.dispose);
      await session.readPreviousWebSession();
      final timedOut = session.restore();
      await tester.pump();
      expect(calls, 1);
      await tester.pump(const Duration(seconds: 8));
      await timedOut;
      expect(session.error, isNotNull);
      expect(session.hasPreviousWebSession, isTrue);

      final retry = session.restore();
      await tester.pump();
      await retry;
      expect(session.isCashier, isTrue);
      expect(session.displayName, 'retried-cashier');
      oldResponse.complete(http.Response('{}', 401));
      await tester.pump();
      expect(session.isCashier, isTrue);
      expect(session.error, isNull);
      expect(await session.readPreviousWebSession(), isTrue);
    },
  );

  test(
    'a late web request 401 cannot revoke a newly verified browser login',
    () async {
      final staleResponse = Completer<http.Response>();
      final api = StaffApiClient(
        browserTransport: true,
        client: MockClient((_) => staleResponse.future),
      );
      final session = StaffAccountSession(
        api: api,
        readPortalCookie: () async => null,
        loginClient: AdminPortalLoginClient(
          browserTransport: true,
          client: MockClient(
            (_) async => http.Response(
              '{"user":{"username":"new-cashier","role":"cashier"}}',
              200,
            ),
          ),
        ),
      );
      addTearDown(session.dispose);
      final pending = api.request('/orders');
      final failure = expectLater(pending, throwsA(isA<StaffApiException>()));
      await session.signIn('new-cashier', 'fixture-password', '');
      staleResponse.complete(http.Response('{}', 401));
      await failure;
      expect(session.isCashier, isTrue);
      expect(session.displayName, 'new-cashier');
      expect(await session.readPreviousWebSession(), isTrue);
    },
  );

  test(
    'a pending restore 200 cannot resurrect staff after a current request 401',
    () async {
      final lateResponse = Completer<http.Response>();
      final restoringStarted = Completer<void>();
      var calls = 0;
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient((request) async {
            if (request.url.path.endsWith('/orders')) {
              return http.Response('{}', 401);
            }
            if (++calls == 2) {
              restoringStarted.complete();
              return lateResponse.future;
            }
            return http.Response(
              '{"user":{"username":"old-cashier","role":"cashier"}}',
              200,
            );
          }),
        ),
      );
      addTearDown(session.dispose);
      await session.restore();
      expect(session.isCashier, isTrue);
      final restoring = session.restore();
      await restoringStarted.future;
      await expectLater(
        session.api.request('/orders'),
        throwsA(isA<StaffApiException>()),
      );
      expect(session.isAuthenticated, isFalse);
      lateResponse.complete(
        http.Response(
          '{"user":{"username":"old-cashier","role":"cashier"}}',
          200,
        ),
      );
      await restoring;
      expect(session.isAuthenticated, isFalse);
      expect(session.error, isNull);
      expect(await session.readPreviousWebSession(), isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.containsKey(StaffAccountSession.previousWebSessionKey),
        isFalse,
      );
    },
  );

  test(
    'revocation of the old session does not cancel a verified fresh login',
    () async {
      final loginResponse = Completer<http.Response>();
      final loginStarted = Completer<void>();
      final session = StaffAccountSession(
        readPortalCookie: () async => null,
        api: StaffApiClient(
          browserTransport: true,
          client: MockClient((_) async => http.Response('{}', 401)),
        ),
        loginClient: AdminPortalLoginClient(
          browserTransport: true,
          client: MockClient((_) {
            loginStarted.complete();
            return loginResponse.future;
          }),
        ),
      );
      addTearDown(session.dispose);
      final signingIn = session.signIn('new-cashier', 'fixture-password', '');
      await loginStarted.future;
      await expectLater(
        session.api.request('/orders'),
        throwsA(isA<StaffApiException>()),
      );
      loginResponse.complete(
        http.Response(
          '{"user":{"username":"new-cashier","role":"cashier"}}',
          200,
        ),
      );
      await signingIn;
      expect(session.isCashier, isTrue);
      expect(session.displayName, 'new-cashier');
      expect(await session.readPreviousWebSession(), isTrue);
    },
  );
}
