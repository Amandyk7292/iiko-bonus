import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/walking_rewards_native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const date = '2026-10-02';
final period = {
  'date': date,
  'startAt': '2026-10-01T19:00:00.000Z',
  'endAt': '2026-10-02T12:00:00.000Z',
};
void iosWidgetTest(
  String description,
  Future<void> Function(WidgetTester) body,
) {
  testWidgets(description, (tester) async {
    try {
      await body(tester);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late List<http.Request> requests;
  late List<MethodCall> calls;
  late BulkaApiClient api;
  var missingBridge = false;
  var days = <Map<String, dynamic>>[];
  var permissionDenied = false;
  Completer<Map<String, String>>? measurementGate;
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    SharedPreferences.setMockInitialValues({});
    requests = [];
    calls = [];
    days = [];
    missingBridge = false;
    permissionDenied = false;
    measurementGate = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(WalkingRewardsNative.channel, (call) async {
          calls.add(call);
          if (missingBridge) throw MissingPluginException();
          if (call.method == 'capabilities') {
            return {'supported': true, 'authorized': true};
          }
          if (call.method == 'identity') {
            return {'deviceId': 'a' * 64, 'keyId': 'native-key'};
          }
          if (call.method == 'measure') {
            if (permissionDenied) {
              throw PlatformException(code: 'WALKING_PERMISSION');
            }
            if (measurementGate != null) return measurementGate!.future;
            return {
              'payload': jsonEncode({
                'source': 'ios_core_motion',
                'steps': 1234,
                'date': (call.arguments as Map)['date'],
              }),
              'assertion': 'native-signed-proof',
            };
          }
          return {};
        });
    api = BulkaApiClient(
      client: MockClient((request) async {
        if (!request.url.path.contains('/walking')) {
          return http.Response(jsonEncode({'success': true}), 200);
        }
        requests.add(request);
        Map<String, dynamic> response = {'success': true};
        if (request.url.path.endsWith('/walking')) {
          response.addAll({
            'enabled': true,
            'date': date,
            'startsOn': days.isEmpty ? date : '2026-10-01',
            'days': days,
          });
        }
        if (request.url.path.endsWith('/challenge')) {
          final offset = (jsonDecode(request.body) as Map)['dayOffset'] ?? 0;
          response.addAll({
            'registered': true,
            'challenge': 'server-challenge',
            'period': offset == 0
                ? period
                : {
                    'date': '2026-10-01',
                    'startAt': '2026-09-30T19:00:00.000Z',
                    'endAt': '2026-10-01T19:00:00.000Z',
                  },
          });
        }
        if (request.url.path.endsWith('/sync')) {
          response.addAll({'date': date, 'steps': 1234, 'rewarded': false});
        }
        return http.Response(jsonEncode(response), 200);
      }),
    );
    api.setSession(accessToken: 'alice-token', cacheScope: 'alice');
  });
  tearDown(() {
    api.dispose();
    debugDefaultTargetPlatformOverride = null;
    appLanguageNotifier.value = 'ru';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(WalkingRewardsNative.channel, null);
  });
  test('no consent means no sensor access and no step data sent', () async {
    await api.syncWalking();
    await api.autoSyncWalking();
    expect(requests, isEmpty);
    expect(calls, isEmpty);
  });
  test(
    'automatic sync coalesces requests and forwards only native signed data with server day boundaries',
    () async {
      await api.setWalkingConsent(true);
      await Future.wait([api.syncWalking(), api.syncWalking()]);
      await api.autoSyncWalking();
      final measured = calls.where((call) => call.method == 'measure').single;
      expect((measured.arguments as Map)['startAt'], period['startAt']);
      final body =
          jsonDecode(
                requests
                    .where((request) => request.url.path.endsWith('/sync'))
                    .single
                    .body,
              )
              as Map;
      expect(body['assertion'], 'native-signed-proof');
      expect(body.containsKey('steps'), false);
      expect(api.walkingProgress.value!.steps, 1234);
      await api.setWalkingConsent(false);
      final count = requests.length;
      await api.autoSyncWalking();
      expect(requests.length, count);
    },
  );
  test(
    'a previous day measured before midnight is queried again after the day ends',
    () async {
      days = [
        {
          'date': '2026-10-01',
          'steps': 9999,
          'credited': false,
          'complete': false,
        },
      ];
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(
        calls
            .where((call) => call.method == 'measure')
            .map((call) => (call.arguments as Map)['date']),
        [date, '2026-10-01'],
      );
    },
  );
  test(
    'a complete historical day and an already rewarded day are never sent again',
    () async {
      days = [
        {'date': date, 'steps': 10000, 'credited': true, 'complete': false},
        {
          'date': '2026-10-01',
          'steps': 3000,
          'credited': false,
          'complete': true,
        },
      ];
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(calls.where((call) => call.method == 'measure'), isEmpty);
      expect(api.walkingProgress.value!.rewarded, true);
    },
  );
  for (final revoke in [false, true]) {
    test(
      revoke
          ? 'disconnect during measurement prevents data upload'
          : 'account switching during measurement prevents data upload',
      () async {
        await api.setWalkingConsent(true);
        measurementGate = Completer<Map<String, String>>();
        final pending = api.syncWalking();
        final expectation = expectLater(pending, throwsA(isA<ApiException>()));
        for (
          var i = 0;
          i < 100 && !calls.any((call) => call.method == 'measure');
          i++
        ) {
          await Future<void>.delayed(const Duration(milliseconds: 5));
        }
        expect(calls.any((call) => call.method == 'measure'), true);
        if (revoke) {
          await api.setWalkingConsent(false);
        } else {
          api.setSession(accessToken: 'bob-token', cacheScope: 'bob');
        }
        measurementGate!.complete({
          'payload': 'old-account-data',
          'assertion': 'old-account-proof',
        });
        await expectation;
        expect(
          requests.where((request) => request.url.path.endsWith('/sync')),
          isEmpty,
        );
      },
    );
  }
  iosWidgetTest(
    'the existing iOS binary without the bridge hides the feature safely',
    (tester) async {
      missingBridge = true;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WalkingRewardsCard(api: api, onReward: () async {}),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('10 000 шагов в день'), findsNothing);
      expect(requests, isEmpty);
    },
  );
  iosWidgetTest(
    'denying motion access never claims a reward and offers iPhone settings',
    (tester) async {
      await api.setWalkingConsent(true);
      permissionDenied = true;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WalkingRewardsCard(api: api, onReward: () async {}),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Открыть настройки'), findsOneWidget);
      expect(find.textContaining('бонусов начислено'), findsNothing);
      expect(
        requests.where((request) => request.url.path.endsWith('/sync')),
        isEmpty,
      );
    },
  );
  iosWidgetTest(
    'compact Russian and Kazakh card supports large text without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final lang in ['ru', 'kk']) {
        appLanguageNotifier.value = lang;
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(1.8)),
              child: Scaffold(
                body: SingleChildScrollView(
                  child: WalkingRewardsCard(
                    key: ValueKey(lang),
                    api: api,
                    onReward: () async {},
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
    },
  );
  iosWidgetTest('preview of the actual walking card', (tester) async {
    const path = String.fromEnvironment('WALKING_PREVIEW');
    if (path.isEmpty) return;
    final fonts = FontLoader('Montserrat')
      ..addFont(rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'))
      ..addFont(rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf'));
    await tester.runAsync(fonts.load);
    await tester.runAsync(() async {
      await (FontLoader('MontserratBold')..addFont(
            rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf'),
          ))
          .load();
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
    });
    tester.view.physicalSize = const Size(390, 500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await api.setWalkingConsent(true);
    days = [
      {'date': date, 'steps': 10000, 'credited': true},
    ];
    final boundary = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: RepaintBoundary(
          key: boundary,
          child: Scaffold(
            backgroundColor: const Color(0xFFF9F8F2),
            body: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 24),
                    const Text(
                      'Профиль Bulka',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    WalkingRewardsCard(api: api, onReward: () async {}),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      final image =
          await (boundary.currentContext!.findRenderObject()
                  as RenderRepaintBoundary)
              .toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File(path).writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
  });
}
