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
// The fake verifies failed local consent persistence still stops recording.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';

const _date = '2026-10-06';
Map<String, dynamic> _period(int offset) {
  final day = DateTime.parse(
    '${_date}T00:00:00Z',
  ).subtract(Duration(days: offset));
  return {
    'date': day.toIso8601String().substring(0, 10),
    'startAt': day.subtract(const Duration(hours: 5)).toIso8601String(),
    'endAt': offset == 0
        ? '2026-10-06T09:13:42.000Z'
        : day.add(const Duration(hours: 19)).toIso8601String(),
  };
}

class _ConsentPreferences extends InMemorySharedPreferencesStore {
  _ConsentPreferences() : super.empty();
  bool reject = false;
  @override
  Future<bool> setValue(String type, String key, Object value) async {
    if (reject && key.contains('walking_consent_v1_')) return false;
    return super.setValue(type, key, value);
  }
}

void _androidWidgetTest(String name, Future<void> Function(WidgetTester) body) {
  testWidgets(name, (tester) async {
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
  var authorized = true;
  var needsUpdate = false;
  var permissionDenied = false;
  var registered = true;
  var stopAcknowledged = true;
  var startsOn = _date;
  var serverSteps = 4321;
  var serverRewarded = false;
  var days = <Map<String, dynamic>>[];
  List<int>? returnedOffsets;
  Completer<Map<String, dynamic>>? measurementGate;
  Completer<bool>? stopGate;
  var nativePayload = '';
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    SharedPreferences.setMockInitialValues({});
    now = Duration.zero;
    requests = [];
    calls = [];
    missingBridge = false;
    authorized = true;
    needsUpdate = false;
    permissionDenied = false;
    registered = true;
    stopAcknowledged = true;
    startsOn = _date;
    serverSteps = 4321;
    serverRewarded = false;
    days = [];
    returnedOffsets = null;
    measurementGate = null;
    stopGate = null;
    nativePayload = '';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(WalkingRewardsNative.channel, (call) async {
          calls.add(call);
          if (missingBridge) throw MissingPluginException();
          switch (call.method) {
            case 'capabilities':
              return {
                'supported': true,
                'authorized': authorized,
                'requiresPlayServicesUpdate': needsUpdate,
              };
            case 'identity':
              return {
                'deviceId': 'a' * 64,
                'keyId': 'android-key',
                'platform': 'android',
              };
            case 'attest':
              return {'attestation': 'play-integrity-registration-token'};
            case 'measureBatch':
              final args = call.arguments as Map;
              if ((!authorized && args['requestPermission'] != true) ||
                  permissionDenied) {
                throw PlatformException(code: 'WALKING_PERMISSION');
              }
              authorized = true;
              if (measurementGate != null) return measurementGate!.future;
              nativePayload = jsonEncode({
                'challenge': args['challenge'],
                'source': 'android_local_recording',
                'measurements': [
                  for (final period in args['periods'] as List)
                    {...period as Map, 'steps': 1349},
                ],
              });
              return {
                'payload': nativePayload,
                'assertion': 'play-integrity-measurement-token',
                // An untrusted outer field must never become a submitted count.
                'steps': 999999,
              };
            case 'stop':
              authorized = false;
              return stopGate?.future ?? stopAcknowledged;
            case 'openSettings':
              return true;
          }
          throw StateError('Unexpected Android bridge method: ${call.method}');
        });
    api = BulkaApiClient(
      client: MockClient((request) async {
        if (!request.url.path.contains('/walking')) {
          return http.Response(jsonEncode({'success': true}), 200);
        }
        requests.add(request);
        final response = <String, dynamic>{'success': true};
        if (request.url.path.endsWith('/walking')) {
          response.addAll({
            'enabled': true,
            'date': _date,
            'startsOn': startsOn,
            'days': days,
          });
        } else if (request.url.path.endsWith('/challenge')) {
          final body = jsonDecode(request.body) as Map;
          response.addAll({
            'registered': registered,
            'challenge': '${body['purpose']}-challenge',
          });
          if (body['purpose'] == 'steps') {
            response['periods'] =
                (returnedOffsets ?? List<int>.from(body['dayOffsets'] as List))
                    .map(_period)
                    .toList();
          }
        } else if (request.url.path.endsWith('/sync')) {
          response['days'] = [
            {
              'date': '2026-10-05',
              'steps': 10000,
              'rewarded': true,
              'balance': 5000,
            },
            {
              'date': _date,
              'steps': serverSteps,
              'rewarded': serverRewarded,
              'balance': 5000,
            },
          ];
        } else if (!request.url.path.endsWith('/device')) {
          return http.Response(jsonEncode({'error': 'Not found'}), 404);
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

  List<MethodCall> measurements() =>
      calls.where((call) => call.method == 'measureBatch').toList();
  List<http.Request> syncs() =>
      requests.where((request) => request.url.path.endsWith('/sync')).toList();
  Future<void> waitForMeasurement() async {
    for (var i = 0; i < 100 && measurements().isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(measurements(), hasLength(1));
  }

  Future<void> showCard(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WalkingRewardsCard(api: api, onReward: () async {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  test(
    'Android without consent never reads sensors or sends step data',
    () async {
      await api.syncWalking();
      await api.autoSyncWalking();
      expect(requests, isEmpty);
      expect(calls, isEmpty);
    },
  );
  test(
    'Android submits one signed batch with exact server periods and no fabricated counts',
    () async {
      await api.setWalkingConsent(true);
      await api.syncWalking();
      final args = measurements().single.arguments as Map;
      expect(args['periods'], [_period(0)]);
      expect(args['requestPermission'], false);
      expect(args['platform'], 'android');
      expect(args['keyId'], 'android-key');
      final body = jsonDecode(syncs().single.body) as Map;
      expect(body['payload'], nativePayload);
      expect(body['assertion'], 'play-integrity-measurement-token');
      expect(body['platform'], 'android');
      expect(body.containsKey('steps'), false);
      expect(api.walkingProgress.value!.steps, 4321);
      expect(api.walkingProgress.value!.rewarded, false);
    },
  );
  test(
    'Android first registration attests the identity before a single batch proof',
    () async {
      registered = false;
      await api.setWalkingConsent(true);
      await api.syncWalking(requestPermission: true);
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
      final attest =
          calls.singleWhere((call) => call.method == 'attest').arguments as Map;
      expect(attest['platform'], 'android');
      expect(attest['keyId'], 'android-key');
      expect(attest['challenge'], 'register-challenge');
      final body =
          jsonDecode(
                requests
                    .singleWhere((r) => r.url.path.endsWith('/device'))
                    .body,
              )
              as Map;
      expect(body['attestation'], 'play-integrity-registration-token');
      expect(measurements(), hasLength(1));
    },
  );
  test(
    'batch skips rewarded, complete and prelaunch dates and uses only returned periods',
    () async {
      startsOn = '2026-10-03';
      days = [
        {'date': '2026-10-05', 'credited': true},
        {'date': '2026-10-04', 'complete': true},
      ];
      returnedOffsets = [3];
      await api.setWalkingConsent(true);
      await api.syncWalking();
      final challenge =
          jsonDecode(
                requests
                    .singleWhere((r) => r.url.path.endsWith('/challenge'))
                    .body,
              )
              as Map;
      expect(challenge['dayOffsets'], [0, 3]);
      expect((measurements().single.arguments as Map)['periods'], [_period(3)]);
    },
  );
  test(
    'normal sync continues today after credit and skips finished history',
    () async {
      startsOn = '2026-10-05';
      days = [
        {'date': _date, 'steps': 10000, 'credited': true},
        {'date': '2026-10-05', 'complete': true},
      ];
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(measurements(), hasLength(1));
      expect(syncs(), hasLength(1));
      expect(api.walkingProgress.value!.steps, 10000);
      expect(api.walkingProgress.value!.rewarded, true);
    },
  );
  test(
    'explicit reconnect after reward starts recording without a second reward',
    () async {
      authorized = false;
      days = [
        {'date': _date, 'steps': 10000, 'credited': true},
      ];
      serverSteps = 10000;
      serverRewarded = true;
      await api.setWalkingConsent(true);
      await api.syncWalking(requestPermission: true);
      final args = measurements().single.arguments as Map;
      expect(args['requestPermission'], true);
      expect(args['periods'], [_period(0)]);
      expect(api.walkingProgress.value!.rewarded, true);
      expect(
        (jsonDecode(syncs().single.body) as Map).containsKey('balance'),
        false,
      );
    },
  );
  test(
    'concurrent and repeated automatic syncs reuse one proof within a minute',
    () async {
      await api.setWalkingConsent(true);
      await Future.wait([
        api.syncWalking(),
        api.syncWalking(),
        api.autoSyncWalking(),
      ]);
      await api.autoSyncWalking();
      await api.syncWalking();
      await api.syncWalking();
      expect(measurements(), hasLength(1));
      expect(syncs(), hasLength(1));
      // Explicit Connect can immediately request permission without a user refresh control.
      await api.syncWalking(requestPermission: true);
      expect(measurements(), hasLength(2));
    },
  );
  test(
    'automatic sync cannot prompt permission and explicit Connect can',
    () async {
      authorized = false;
      await api.setWalkingConsent(true);
      await api.autoSyncWalking();
      expect(requests, isEmpty);
      expect(calls.where((call) => call.method != 'capabilities'), isEmpty);
      await expectLater(api.syncWalking(), throwsA(isA<PlatformException>()));
      expect(requests, isEmpty);
      await api.syncWalking(requestPermission: true);
      expect(
        (measurements().single.arguments as Map)['requestPermission'],
        true,
      );
    },
  );
  for (final revoke in [false, true]) {
    test(
      revoke
          ? 'Android opt-out stops recording and blocks an in-flight proof upload'
          : 'Android account switch blocks an in-flight proof upload',
      () async {
        await api.setWalkingConsent(true);
        measurementGate = Completer<Map<String, dynamic>>();
        final pending = api.syncWalking();
        final expectation = expectLater(pending, throwsA(isA<ApiException>()));
        await waitForMeasurement();
        if (revoke) {
          await api.setWalkingConsent(false);
          expect(calls.where((call) => call.method == 'stop'), hasLength(1));
        } else {
          api.setSession(accessToken: 'bob-token', cacheScope: 'bob');
        }
        measurementGate!.complete({
          'payload': 'old-owner-payload',
          'assertion': 'old-owner-proof',
        });
        await expectation;
        expect(syncs(), isEmpty);
      },
    );
  }
  test(
    'opting out awaits native stop acknowledgement and prevents later autosync',
    () async {
      await api.setWalkingConsent(true);
      stopGate = Completer<bool>();
      var completed = false;
      final disabling = api
          .setWalkingConsent(false)
          .then((_) => completed = true);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(completed, false);
      expect(await api.walkingConsent(), false);
      await api.autoSyncWalking();
      expect(requests, isEmpty);
      stopGate!.complete(true);
      await disabling;
      expect(completed, true);
    },
  );
  test(
    'failed native stop is reported instead of pretending unsubscribe succeeded',
    () async {
      await api.setWalkingConsent(true);
      stopAcknowledged = false;
      await expectLater(
        api.setWalkingConsent(false),
        throwsA(isA<PlatformException>()),
      );
      expect(await api.walkingConsent(), false);
    },
  );
  test(
    'failed opt-out preference write still unsubscribes and blocks data collection',
    () async {
      final original = SharedPreferencesStorePlatform.instance;
      final store = _ConsentPreferences();
      SharedPreferencesStorePlatform.instance = store;
      addTearDown(() => SharedPreferencesStorePlatform.instance = original);
      await api.setWalkingConsent(true);
      store.reject = true;
      await expectLater(
        api.setWalkingConsent(false),
        throwsA(isA<StateError>()),
      );
      expect(calls.where((call) => call.method == 'stop'), hasLength(1));
      expect(await api.walkingConsent(), false);
      await api.autoSyncWalking();
      expect(requests, isEmpty);
      store.reject = false;
      api.setSession(accessToken: 'bob-token', cacheScope: 'bob');
      await api.setWalkingConsent(true);
      // Reload exposes Alice's older persisted true value. Bob's consent must
      // not erase Alice's in-memory opt-out after its failed disk write.
      await (await SharedPreferences.getInstance()).reload();
      api.setSession(accessToken: 'alice-token', cacheScope: 'alice');
      expect(await api.walkingConsent(), false);
      await api.autoSyncWalking();
      expect(requests, isEmpty);
    },
  );
  _androidWidgetTest(
    'old Android binary without native bridge hides the walking card',
    (tester) async {
      missingBridge = true;
      await showCard(tester);
      expect(find.text('10 000 шагов в день'), findsNothing);
      expect(requests, isEmpty);
    },
  );
  _androidWidgetTest(
    'Android Connect explains background collection before requesting activity access',
    (tester) async {
      authorized = false;
      await showCard(tester);
      await tester.tap(find.text('Подключить шагомер'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('телефон считает шаги в фоне'),
        findsOneWidget,
      );
      expect(find.textContaining('число шагов за день и дату'), findsOneWidget);
      expect(measurements(), isEmpty);
      await tester.tap(find.text('Не сейчас'));
      await tester.pumpAndSettle();
      expect(await api.walkingConsent(), false);
      expect(requests, isEmpty);
      await tester.tap(find.text('Подключить шагомер'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Разрешить и подключить'));
      await tester.pumpAndSettle();
      expect(
        (measurements().single.arguments as Map)['requestPermission'],
        true,
      );
      expect(find.text('4 321'), findsOneWidget);
      expect(find.textContaining('Не удалось обновить шаги'), findsNothing);
    },
  );
  _androidWidgetTest(
    'denied Android permission offers settings, explicit reconnect and Disable',
    (tester) async {
      authorized = false;
      await api.setWalkingConsent(true);
      await showCard(tester);
      expect(find.text('Открыть настройки'), findsOneWidget);
      expect(find.text('Подключить шагомер'), findsOneWidget);
      expect(find.text('Отключить'), findsOneWidget);
      expect(find.textContaining('iPhone'), findsNothing);
      expect(requests, isEmpty);
      await tester.tap(find.text('Подключить шагомер'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Разрешить и подключить'));
      await tester.pumpAndSettle();
      expect(measurements(), hasLength(1));
      expect(find.text('4 321'), findsOneWidget);
    },
  );
  _androidWidgetTest(
    'Android automatic updates send one signed proof per minute',
    (tester) async {
      await api.setWalkingConsent(true);
      await showCard(tester);
      expect(measurements(), hasLength(1));
      now = const Duration(seconds: 59);
      await tester.pump(const Duration(seconds: 59));
      expect(measurements(), hasLength(1));
      serverSteps = 5432;
      now = const Duration(minutes: 1);
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(measurements(), hasLength(2));
      expect(find.text('5 432'), findsOneWidget);
      expect(
        (measurements().last.arguments as Map)['requestPermission'],
        false,
      );
      expect(
        (jsonDecode(syncs().last.body) as Map).containsKey('steps'),
        false,
      );
      expect(find.text('Обновить'), findsNothing);
    },
  );

  _androidWidgetTest(
    'Play Services update is actionable and never generates a proof',
    (tester) async {
      needsUpdate = true;
      await api.setWalkingConsent(true);
      await showCard(tester);
      expect(find.text('Обновить сервисы Google Play'), findsOneWidget);
      expect(find.text('Отключить'), findsOneWidget);
      await tester.tap(find.text('Обновить сервисы Google Play'));
      await tester.pumpAndSettle();
      expect(
        calls.where((call) => call.method == 'openSettings'),
        hasLength(1),
      );
      expect(requests, isEmpty);
    },
  );
  _androidWidgetTest(
    'Disable during Android measurement stops collection without showing a sync error',
    (tester) async {
      measurementGate = Completer<Map<String, dynamic>>();
      await api.setWalkingConsent(true);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WalkingRewardsCard(api: api, onReward: () async {}),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(measurements(), hasLength(1));
      await tester.tap(find.text('Отключить'));
      await tester.pump(const Duration(milliseconds: 100));
      measurementGate!.complete({'payload': 'revoked', 'assertion': 'revoked'});
      await tester.pumpAndSettle();
      expect(syncs(), isEmpty);
      expect(find.text('Подключить шагомер'), findsOneWidget);
      expect(find.textContaining('Не удалось обновить шаги'), findsNothing);
    },
  );
  _androidWidgetTest(
    'switching accounts clears the previous reward even when new owner cannot sync',
    (tester) async {
      serverSteps = 10000;
      serverRewarded = true;
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(api.walkingProgress.value!.rewarded, true);
      api.setSession(accessToken: 'bob-token', cacheScope: 'bob');
      await api.setWalkingConsent(true);
      authorized = false;
      await showCard(tester);
      expect(find.text('—'), findsOneWidget);
      expect(find.text('1 000 бонусов начислено'), findsNothing);
      expect(find.text('Открыть настройки'), findsOneWidget);
    },
  );
  _androidWidgetTest(
    'permission-dialog resume cannot replace an active Android sync with a permission error',
    (tester) async {
      measurementGate = Completer<Map<String, dynamic>>();
      await api.setWalkingConsent(true);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WalkingRewardsCard(api: api, onReward: () async {}),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(measurements(), hasLength(1));
      authorized = false;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump(const Duration(milliseconds: 100));
      authorized = true;
      measurementGate!.complete({
        'payload': 'signed-periods',
        'assertion': 'native-token',
      });
      await tester.pumpAndSettle();
      expect(find.text('Открыть настройки'), findsNothing);
      expect(find.text('Обновить'), findsNothing);
      expect(find.text('4 321'), findsOneWidget);
    },
  );
  _androidWidgetTest(
    'denied Connect can reconnect explicitly after permission is granted',
    (tester) async {
      authorized = false;
      permissionDenied = true;
      await showCard(tester);
      await tester.tap(find.text('Подключить шагомер'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Разрешить и подключить'));
      await tester.pumpAndSettle();
      expect(find.text('Открыть настройки'), findsOneWidget);
      expect(find.text('Отключить'), findsOneWidget);
      permissionDenied = false;
      await tester.tap(find.text('Подключить шагомер'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Разрешить и подключить'));
      await tester.pumpAndSettle();
      expect(measurements(), hasLength(2));
      expect(syncs(), hasLength(1));
      expect(find.text('4 321'), findsOneWidget);
    },
  );
  _androidWidgetTest(
    'Android Russian and Kazakh consent fits narrow screens with large text',
    (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final language in ['ru', 'kk']) {
        appLanguageNotifier.value = language;
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
                    key: ValueKey(language),
                    api: api,
                    onReward: () async {},
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final connect = find.text(
          language == 'ru' ? 'Подключить шагомер' : 'Қадам санағышын қосу',
        );
        await tester.ensureVisible(connect);
        await tester.tap(connect);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final decline = find.text(
          language == 'ru' ? 'Не сейчас' : 'Қазір емес',
        );
        await tester.ensureVisible(decline);
        await tester.tap(decline);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
    },
  );
  _androidWidgetTest('preview of Android walking card and consent', (
    tester,
  ) async {
    const path = String.fromEnvironment('WALKING_ANDROID_PREVIEW');
    if (path.isEmpty) return;
    await tester.runAsync(() async {
      await (FontLoader('Montserrat')
            ..addFont(
              rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'),
            )
            ..addFont(
              rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf'),
            ))
          .load();
      await (FontLoader('MontserratBold')..addFont(
            rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf'),
          ))
          .load();
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('assets/fonts/BulkaIcons.ttf'))).load();
    });
    tester.view.physicalSize = const Size(430, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    authorized = false;
    final boundary = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 24),
                    Text(
                      'Профиль Bulka',
                      style: buildBulkaTheme().textTheme.headlineSmall,
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
    Future<void> capture(String suffix) => tester.runAsync(() async {
      final image =
          await (boundary.currentContext!.findRenderObject()
                  as RenderRepaintBoundary)
              .toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File('$path-$suffix.png').writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
    await capture('card');
    await tester.tap(find.text('Подключить шагомер'));
    await tester.pumpAndSettle();
    await capture('consent');
  });
}
