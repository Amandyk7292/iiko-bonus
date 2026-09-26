import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _AccountApi extends BulkaApiClient {
  _AccountApi()
    : super(
        client: MockClient((_) async => throw StateError('Unexpected request')),
      );
  final events = StreamController<Map<String, dynamic>>.broadcast();
  bool offline = true;
  int calls = 0;
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  void reconnectEvents() {}
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async {
    calls++;
    if (offline) throw http.ClientException('offline');
    return {'enabled': true, 'blocked': false, 'balance': 1200};
  }
}

void main() {
  for (final recovery in ['connected', 'resume', 'retry', 'backoff']) {
    testWidgets(
      'personal account returns after initial offline via $recovery',
      (tester) async {
        final api = _AccountApi();
        var available = false;
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: Scaffold(
              body: PersonalAccountOption(
                api: api,
                selected: false,
                onAvailable: (value) => available = value,
                onSelect: () {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(api.calls, 1);
        expect(available, isFalse);
        expect(
          find.byKey(const ValueKey('checkout-personal-account-retry')),
          findsOneWidget,
        );
        api.offline = false;
        switch (recovery) {
          case 'connected':
            api.events.add({'type': 'connected'});
            await tester.pump();
            // A reconnect supersedes the previous failure's bounded backoff.
            await tester.pump(const Duration(seconds: 2));
          case 'resume':
            tester.binding.handleAppLifecycleStateChanged(
              AppLifecycleState.paused,
            );
            tester.binding.handleAppLifecycleStateChanged(
              AppLifecycleState.resumed,
            );
          case 'retry':
            await tester.tap(
              find.byKey(const ValueKey('checkout-personal-account-retry')),
            );
          case 'backoff':
            await tester.pump(const Duration(seconds: 2));
        }
        await tester.pumpAndSettle();
        expect(api.calls, greaterThan(1));
        expect(available, isTrue);
        expect(
          find.byKey(const ValueKey('checkout-personal-account')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('checkout-personal-account-retry')),
          findsNothing,
        );
        await tester.pumpWidget(const SizedBox.shrink());
        await api.events.close();
        api.dispose();
      },
    );
  }
  testWidgets(
    'background outage keeps a previously available account and retries',
    (tester) async {
      final api = _AccountApi()..offline = false;
      var available = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: PersonalAccountOption(
              api: api,
              selected: true,
              onAvailable: (value) => available = value,
              onSelect: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(available, isTrue);
      api.offline = true;
      api.events.add({'type': 'personal-account.updated'});
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(available, isTrue);
      expect(
        find.byKey(const ValueKey('checkout-personal-account')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('checkout-personal-account-retry')),
        findsOneWidget,
      );
      api.offline = false;
      await tester.tap(
        find.byKey(const ValueKey('checkout-personal-account-retry')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-personal-account-retry')),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      await api.events.close();
      api.dispose();
    },
  );
}
