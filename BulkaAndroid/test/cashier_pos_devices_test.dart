import 'package:flutter/services.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class PairingApi extends StaffApiClient {
  int reads = 0;
  int codes = 0;
  bool linked = false;
  bool fail = false;
  final List<Map<String, Object?>> devices = [
    {
      'terminalId': 'one',
      'name': 'Касса 1',
      'online': true,
      'pairedAt': 'first',
    },
  ];
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (endpoint.endsWith('/pairing-code')) {
      expect(method, 'POST');
      expect(body, isEmpty);
      codes++;
      if (fail) throw const StaffApiException(503, 'OFFLINE', 'Нет связи');
      return {
        'code': '654321',
        'pairingId': 'pair-$codes',
        'expiresAt': DateTime.now()
            .add(const Duration(minutes: 5))
            .toIso8601String(),
      };
    }
    reads++;
    return {
      'devices': devices,
      'pairing': query['pairingId'] == null
          ? null
          : {
              'id': query['pairingId'],
              'terminalId': linked ? 'two' : null,
              'status': linked ? 'paired' : 'waiting',
            },
    };
  }
}

void main() {
  setUpAll(() async {
    await (FontLoader('Montserrat')..addFont(
          rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'),
        ))
        .load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  setUp(() => appLanguageNotifier.value = 'ru');
  testWidgets(
    'pairing screen fits a phone with two registers and the activation code',
    (tester) async {
      final api = PairingApi();
      api.devices.add({
        'terminalId': 'two',
        'name': 'Касса 2',
        'online': false,
        'pairedAt': 'second',
      });
      addTearDown(api.close);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme().copyWith(
            textTheme: ThemeData(fontFamily: 'Montserrat').textTheme,
          ),
          home: RepaintBoundary(
            key: const ValueKey('pairing-preview'),
            child: CashierPosDevicesScreen(
              api: api,
              branchName: '19а ЖК Жасыл дала',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('pos-create-code')));
      await tester.pumpAndSettle();
      await expectLater(
        find.byKey(const ValueKey('pairing-preview')),
        matchesGoldenFile('goldens/cashier-pos-pairing.png'),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  Future<void> open(WidgetTester tester, PairingApi api) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: CashierPosDevicesScreen(api: api, branchName: 'ЖК Дукат'),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'second register appears alongside first only when this code is consumed',
    (tester) async {
      final api = PairingApi();
      addTearDown(api.close);
      await open(tester, api);
      expect(find.text('Касса 1'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('pos-create-code')));
      await tester.tap(find.byKey(const ValueKey('pos-create-code')));
      await tester.pumpAndSettle();
      expect(find.text('654321'), findsOneWidget);
      api.devices.add({
        'terminalId': 'two',
        'name': 'Касса 2',
        'online': false,
        'pairedAt': 'second',
      });
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(find.text('654321'), findsOneWidget);
      api.linked = true;
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(find.text('654321'), findsNothing);
      expect(find.text('Касса 1'), findsOneWidget);
      expect(find.text('Касса 2'), findsOneWidget);
      expect(api.codes, 1);
      await tester.pumpWidget(const SizedBox());
      final reads = api.reads;
      await tester.pump(const Duration(seconds: 30));
      expect(api.reads, reads);
    },
  );

  testWidgets('failed pairing keeps existing registers and allows retry', (
    tester,
  ) async {
    final api = PairingApi()..fail = true;
    addTearDown(api.close);
    await open(tester, api);
    await tester.tap(find.byKey(const ValueKey('pos-create-code')));
    await tester.pumpAndSettle();
    expect(find.text('Нет связи'), findsOneWidget);
    expect(find.text('Касса 1'), findsOneWidget);
    api.fail = false;
    await tester.tap(find.byKey(const ValueKey('pos-create-code')));
    await tester.pumpAndSettle();
    expect(find.text('654321'), findsOneWidget);
    expect(api.codes, 2);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'backgrounding pauses refresh; code expires without blocking the screen',
    (tester) async {
      final api = PairingApi();
      addTearDown(api.close);
      await open(tester, api);
      await tester.tap(find.byKey(const ValueKey('pos-create-code')));
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      final reads = api.reads;
      await tester.pump(const Duration(minutes: 6));
      expect(api.reads, reads);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      // FakeAsync advances scheduled timers, while expiresAt remains based on wall time.
      expect(find.text('654321'), findsOneWidget);
      expect(api.reads, greaterThan(reads));
      await tester.pumpWidget(const SizedBox());
    },
  );
}
