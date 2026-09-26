import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _AccountAuditApi extends BulkaApiClient {
  int reads = 0;
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async {
    reads++;
    return {
      'enabled': false,
      'balance': 100,
      'entries': [],
      '_requestId': 'read-$reads',
    };
  }
}

void main() {
  test('large API responses preserve Unicode, data and request IDs', () async {
    final payload = {
      'balance': 1500,
      'entries': List.generate(
        1200,
        (i) => {'id': '$i', 'reason': 'Покупка — бәліш', 'amount': i},
      ),
    };
    final api = BulkaApiClient(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(payload),
          200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-request-id': 'large-audit',
          },
        ),
      ),
    );
    final result = await api.getPersonalAccount();
    expect(result['entries'], payload['entries']);
    expect(result['_requestId'], 'large-audit');
    api.dispose();
  });

  test('large API failures retain their support code', () async {
    final api = BulkaApiClient(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': 'Ошибка',
            'code': 'TEST_FAILURE',
            'padding': 'x' * 70000,
          }),
          422,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-request-id': 'error-audit',
          },
        ),
      ),
    );
    await expectLater(
      api.getPersonalAccount(),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', 'TEST_FAILURE')
            .having((e) => e.requestId, 'requestId', 'error-audit'),
      ),
    );
    api.dispose();
  });

  test('malformed large API response remains an API error', () async {
    final api = BulkaApiClient(
      client: MockClient((_) async => http.Response('x' * 70000, 200)),
    );
    await expectLater(
      api.getPersonalAccount(),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          'INVALID_API_RESPONSE',
        ),
      ),
    );
    api.dispose();
  });

  test(
    'session change while receiving a large response rejects stale data',
    () async {
      final api = BulkaApiClient(
        client: MockClient(
          (_) async =>
              http.Response(jsonEncode({'padding': 'x' * 200000}), 200),
        ),
      )..setSession(accessToken: 'old', cacheScope: 'old');
      final pending = api.getPersonalAccount();
      Timer.run(() => api.setSession(accessToken: 'new', cacheScope: 'new'));
      await expectLater(
        pending,
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'SESSION_IDENTITY_CHANGED',
          ),
        ),
      );
      api.dispose();
    },
  );

  testWidgets(
    'account polling keeps unchanged widgets and pauses under routes or in background',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      appLanguageNotifier.value = 'ru';
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final api = _AccountAuditApi();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: PersonalAccountScreen(api: api),
        ),
      );
      await tester.pumpAndSettle();
      final balance = find.byKey(const ValueKey('personal-account-balance'));
      final beforeWidget = tester.widget(balance);
      final beforeReads = api.reads;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(api.reads, beforeReads + 1);
      expect(tester.widget(balance), same(beforeWidget));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(const Duration(seconds: 20));
      expect(api.reads, beforeReads + 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(api.reads, beforeReads + 2);
      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      unawaited(
        navigator.push<void>(
          MaterialPageRoute(
            builder: (_) => const Scaffold(body: Text('Covered')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final coveredReads = api.reads;
      await tester.pump(const Duration(seconds: 20));
      expect(api.reads, coveredReads);
      navigator.pop();
      await tester.pumpAndSettle();
      expect(api.reads, greaterThan(coveredReads));
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    },
  );
}
