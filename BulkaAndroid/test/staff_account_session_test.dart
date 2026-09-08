import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

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
      await session.logout();
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
}
