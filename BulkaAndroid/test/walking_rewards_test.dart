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
      await tester.pumpWidget(const SizedBox.shrink());
      debugDefaultTargetPlatformOverride = null;
    }
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late List<http.Request> requests;
  late List<MethodCall> calls;
  late BulkaApiClient api;
  var now = Duration.zero;
  var missingBridge = false;
  var days = <Map<String, dynamic>>[];
  var permissionDenied = false;
  var registered = true;
  var serverSteps = 1234;
  var serverRewarded = false;
  var serverDeviceRewarded = false;
  Completer<Map<String, String>>? measurementGate;
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    SharedPreferences.setMockInitialValues({});
    now = Duration.zero;
    requests = [];
    calls = [];
    days = [];
    missingBridge = false;
    permissionDenied = false;
    registered = true;
    serverSteps = 1234;
    serverRewarded = false;
    serverDeviceRewarded = false;
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
          if (call.method == 'attest') {
            return {'attestation': 'native-attestation'};
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
        if (!request.url.path.startsWith('/api/customer/walking')) {
          return http.Response(jsonEncode({'error': 'Not found'}), 404);
        }
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
            'registered': registered,
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
          response.addAll({
            'date': date,
            'steps': serverSteps,
            'rewarded': serverRewarded,
            'deviceRewarded': serverDeviceRewarded,
          });
        }
        return http.Response(jsonEncode(response), 200);
      }),
    );
    api.setSession(accessToken: 'alice-token', cacheScope: 'alice');
    api.setWalkingClockForTest(() => now);
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
    'first registration uses the real customer API routes before sending signed steps',
    () async {
      registered = false;
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(
        requests.map((request) => '${request.method} ${request.url.path}'),
        [
          'GET /api/customer/walking',
          'POST /api/customer/walking/challenge',
          'POST /api/customer/walking/challenge',
          'POST /api/customer/walking/device',
          'POST /api/customer/walking/sync',
        ],
      );
      expect(calls.where((call) => call.method == 'attest'), hasLength(1));
      expect(api.walkingProgress.value!.steps, 1234);
    },
  );
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
    'today keeps updating after credit while a complete historical day is skipped',
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
      expect(calls.where((call) => call.method == 'measure'), hasLength(1));
      expect(api.walkingProgress.value!.steps, 10000);
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
  Future<void> showCard(
    WidgetTester tester, {
    bool reducedMotion = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: MediaQuery(
          data: MediaQueryData(
            size: tester.view.physicalSize / tester.view.devicePixelRatio,
            disableAnimations: reducedMotion,
          ),
          child: Scaffold(
            body: SingleChildScrollView(
              child: WalkingRewardsCard(api: api, onReward: () async {}),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  int measurementCount() =>
      calls.where((call) => call.method == 'measure').length;

  test(
    'all automatic callers share a one minute throttle and retain accepted progress',
    () async {
      await api.setWalkingConsent(true);
      await api.syncWalking();
      now = const Duration(seconds: 59);
      await api.autoSyncWalking();
      await api.syncWalking();
      expect(measurementCount(), 1);
      now = const Duration(minutes: 1);
      serverSteps = 2345;
      await api.syncWalking();
      expect(measurementCount(), 2);
      expect(api.walkingProgress.value!.steps, 2345);
    },
  );

  test(
    'stale status cannot drop accepted steps or credited device state while proof is pending',
    () async {
      days = [
        {'date': date, 'steps': 10000, 'credited': true},
        {'date': '2026-10-01', 'steps': 3000, 'complete': true},
      ];
      serverSteps = 15000;
      serverRewarded = true;
      serverDeviceRewarded = true;
      await api.setWalkingConsent(true);
      await api.syncWalking();
      now = const Duration(minutes: 1);
      serverSteps = 16000;
      serverRewarded = false;
      serverDeviceRewarded = false;
      days.first['credited'] = false;
      measurementGate = Completer<Map<String, String>>();
      final pending = api.syncWalking();
      for (var i = 0; i < 100 && measurementCount() < 2; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      expect(measurementCount(), 2);
      expect(api.walkingProgress.value!.steps, 15000);
      expect(api.walkingProgress.value!.rewarded, true);
      expect(api.walkingProgress.value!.deviceRewarded, true);
      measurementGate!.complete({
        'payload': 'native-new-proof',
        'assertion': 'signed-new-proof',
      });
      await pending;
      expect(api.walkingProgress.value!.steps, 16000);
      expect(api.walkingProgress.value!.rewarded, true);
      expect(api.walkingProgress.value!.deviceRewarded, true);
    },
  );

  iosWidgetTest(
    'the visible card updates once each minute and animates the actual counter',
    (tester) async {
      await api.setWalkingConsent(true);
      await showCard(tester);
      expect(measurementCount(), 1);
      expect(find.text('1 234'), findsOneWidget);
      serverSteps = 2234;
      now = const Duration(seconds: 59);
      await tester.pump(const Duration(seconds: 59));
      expect(measurementCount(), 1);
      now = const Duration(minutes: 1);
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(measurementCount(), 2);
      await tester.pump(const Duration(milliseconds: 150));
      final displayed = tester
          .widget<Text>(find.byKey(const ValueKey('walking-step-count')))
          .data!;
      final count = int.parse(displayed.replaceAll(' ', ''));
      expect(count, greaterThan(1234));
      expect(count, lessThan(2234));
      await tester.pumpAndSettle();
      expect(find.text('2 234'), findsOneWidget);
      expect(find.text('Обновить'), findsNothing);
    },
  );

  iosWidgetTest(
    'rapid hide and resume retain the minute fence and remaining deadline',
    (tester) async {
      await api.setWalkingConsent(true);
      var enabled = true;
      late StateSetter change;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) {
                change = setState;
                return TickerMode(
                  enabled: enabled,
                  child: WalkingRewardsCard(api: api, onReward: () async {}),
                );
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      now = const Duration(seconds: 20);
      await tester.pump(const Duration(seconds: 20));
      for (var i = 0; i < 3; i++) {
        change(() => enabled = false);
        await tester.pumpAndSettle();
        change(() => enabled = true);
        await tester.pumpAndSettle();
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pumpAndSettle();
      }
      expect(measurementCount(), 1);
      now = const Duration(seconds: 59);
      await tester.pump(const Duration(seconds: 39));
      expect(measurementCount(), 1);
      now = const Duration(minutes: 1);
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(measurementCount(), 2);
    },
  );

  iosWidgetTest(
    'background and disabled tickers pause measurement then resume when due',
    (tester) async {
      await api.setWalkingConsent(true);
      var enabled = true;
      late StateSetter change;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) {
                change = setState;
                return TickerMode(
                  enabled: enabled,
                  child: WalkingRewardsCard(api: api, onReward: () async {}),
                );
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      now = const Duration(minutes: 2);
      await tester.pump(const Duration(minutes: 2));
      expect(measurementCount(), 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(measurementCount(), 2);
      change(() => enabled = false);
      await tester.pump();
      now = const Duration(minutes: 4);
      await tester.pump(const Duration(minutes: 2));
      expect(measurementCount(), 2);
      change(() => enabled = true);
      await tester.pumpAndSettle();
      expect(measurementCount(), 3);
      await tester.pumpWidget(const SizedBox.shrink());
      now = const Duration(minutes: 6);
      await tester.pump(const Duration(minutes: 2));
      expect(measurementCount(), 3);
    },
  );

  iosWidgetTest(
    'scrolling the card off screen pauses updates and returning refreshes due steps',
    (tester) async {
      await api.setWalkingConsent(true);
      final scroll = ScrollController();
      addTearDown(scroll.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              controller: scroll,
              child: Column(
                children: [
                  WalkingRewardsCard(api: api, onReward: () async {}),
                  const SizedBox(height: 1600),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      scroll.jumpTo(1000);
      await tester.pumpAndSettle();
      now = const Duration(minutes: 2);
      await tester.pump(const Duration(minutes: 2));
      expect(measurementCount(), 1);
      scroll.jumpTo(0);
      await tester.pumpAndSettle();
      expect(measurementCount(), 2);
    },
  );

  iosWidgetTest(
    'a pending measurement stays single flight across timer and resume',
    (tester) async {
      await api.setWalkingConsent(true);
      measurementGate = Completer<Map<String, String>>();
      await showCard(tester);
      expect(measurementCount(), 1);
      now = const Duration(seconds: 20);
      await tester.pump(const Duration(seconds: 20));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(measurementCount(), 1);
      measurementGate!.complete({
        'payload': 'native-proof',
        'assertion': 'signed-proof',
      });
      await tester.pumpAndSettle();
      expect(find.text('1 234'), findsOneWidget);
    },
  );

  iosWidgetTest(
    'measurement failure retries automatically without a step retry button',
    (tester) async {
      await api.setWalkingConsent(true);
      permissionDenied = true;
      await showCard(tester);
      expect(measurementCount(), 1);
      expect(find.text('Открыть настройки'), findsOneWidget);
      permissionDenied = false;
      now = const Duration(minutes: 1);
      await tester.pump(const Duration(minutes: 1));
      await tester.pumpAndSettle();
      expect(measurementCount(), 2);
      expect(find.text('1 234'), findsOneWidget);
      expect(find.text('Повторить'), findsNothing);
      expect(find.text('Обновить'), findsNothing);
    },
  );

  iosWidgetTest(
    'automatic updates stop after consent revocation or session logout',
    (tester) async {
      await api.setWalkingConsent(true);
      await showCard(tester);
      await api.setWalkingConsent(false);
      now = const Duration(minutes: 2);
      await tester.pump(const Duration(minutes: 2));
      await tester.pumpAndSettle();
      expect(measurementCount(), 1);
      await api.setWalkingConsent(true);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(measurementCount(), 2);
      api.setSession();
      now = const Duration(minutes: 4);
      await tester.pump(const Duration(minutes: 2));
      expect(measurementCount(), 2);
    },
  );

  iosWidgetTest(
    'reduced motion updates the accepted counter without intermediate animation',
    (tester) async {
      await api.setWalkingConsent(true);
      await showCard(tester, reducedMotion: true);
      serverSteps = 2234;
      now = const Duration(minutes: 1);
      await tester.pump(const Duration(minutes: 1));
      await tester.pump();
      expect(find.text('2 234'), findsOneWidget);
      final animation = tester.widget<TweenAnimationBuilder<double>>(
        find.byWidgetPredicate(
          (widget) => widget is TweenAnimationBuilder<double>,
        ),
      );
      expect(animation.duration, Duration.zero);
    },
  );

  iosWidgetTest(
    'a failed balance refresh preserves successfully synchronized steps',
    (tester) async {
      await api.setWalkingConsent(true);
      serverSteps = 10000;
      serverRewarded = true;
      var balanceRefreshes = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WalkingRewardsCard(
              api: api,
              onReward: () async {
                balanceRefreshes++;
                throw const FormatException('profile');
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('10 000'), findsOneWidget);
      expect(balanceRefreshes, 1);
      expect(find.textContaining('Не удалось обновить шаги'), findsNothing);
      expect(find.text('Обновить'), findsNothing);
    },
  );
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
              data: const MediaQueryData(
                size: Size(320, 900),
                textScaler: TextScaler.linear(2.0),
              ),
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
  iosWidgetTest(
    'credited counter and actions fit 320 pixels at double text size in both languages',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await api.setWalkingConsent(true);
      serverSteps = 150000;
      serverRewarded = true;
      for (final lang in ['ru', 'kk']) {
        appLanguageNotifier.value = lang;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: MediaQuery(
              data: const MediaQueryData(
                size: Size(320, 1100),
                textScaler: TextScaler.linear(2),
                disableAnimations: true,
              ),
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
        expect(find.text('150 000'), findsOneWidget);
        expect(find.text(lang == 'ru' ? 'Отключить' : 'Өшіру'), findsOneWidget);
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
      )..addFont(rootBundle.load('assets/fonts/BulkaIcons.ttf'))).load();
    });
    tester.view.physicalSize = const Size(390, 500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await api.setWalkingConsent(true);
    serverSteps = 6432;
    final boundary = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
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
    Future<void> capture(String target) async {
      await tester.runAsync(() async {
        final image =
            await (boundary.currentContext!.findRenderObject()
                    as RenderRepaintBoundary)
                .toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(target).writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }

    await capture(path.replaceFirst('.png', '-progress.png'));
    now = const Duration(minutes: 1);
    serverSteps = 10864;
    serverRewarded = true;
    await api.syncWalking();
    await tester.pumpAndSettle();
    await capture(path);
  });
}
