import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/core/walking_rewards_native.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _date = '2026-10-07';
Map<String, dynamic> _period(int offset) {
  final day = DateTime.parse(
    '${_date}T00:00:00Z',
  ).subtract(Duration(days: offset));
  return {
    'date': day.toIso8601String().substring(0, 10),
    'startAt': day.subtract(const Duration(hours: 5)).toIso8601String(),
    'endAt': offset == 0
        ? '2026-10-07T10:00:00.000Z'
        : day.add(const Duration(hours: 19)).toIso8601String(),
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late BulkaApiClient api;
  late List<MethodCall> nativeCalls;
  late List<http.Request> requests;
  late Set<String> registeredKeys;
  late Map<String, Map<String, dynamic>> days;
  var now = Duration.zero;
  var key = 'key-1';
  var device = 'a' * 64;
  var history = false;
  var staleHistory = false;
  var challenges = 0;
  var measurements = 0;
  FutureOr<Object?> Function(MethodCall)? nativeOverride;
  http.Response? Function(http.Request)? serverOverride;

  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    SharedPreferences.setMockInitialValues({});
    nativeCalls = [];
    requests = [];
    registeredKeys = {'key-1'};
    days = {
      _date: {
        'date': _date,
        'steps': 1206,
        'credited': false,
        'complete': false,
      },
    };
    now = Duration.zero;
    key = 'key-1';
    device = 'a' * 64;
    history = false;
    staleHistory = false;
    challenges = 0;
    measurements = 0;
    nativeOverride = null;
    serverOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(WalkingRewardsNative.channel, (call) async {
          nativeCalls.add(call);
          final override = await nativeOverride?.call(call);
          if (override != null) return override;
          switch (call.method) {
            case 'capabilities':
              return {'supported': true, 'authorized': true};
            case 'identity':
              return {'deviceId': device, 'keyId': key};
            case 'attest':
              return {'attestation': 'native-attestation-$key'};
            case 'measure':
              final args = call.arguments as Map;
              measurements++;
              return {
                'payload': jsonEncode({
                  'challenge': args['challenge'],
                  'source': 'ios_core_motion',
                  'steps': 2300,
                  'date': args['date'],
                  'startAt': args['startAt'],
                  'endAt': args['endAt'],
                }),
                'assertion': 'native-proof-$measurements',
              };
          }
          return {};
        });
    api = BulkaApiClient(
      client: MockClient((request) async {
        requests.add(request);
        final override = serverOverride?.call(request);
        if (override != null) return override;
        final body = request.method == 'POST'
            ? jsonDecode(request.body) as Map
            : <String, dynamic>{};
        final response = <String, dynamic>{'success': true};
        if (request.url.path.endsWith('/walking')) {
          response.addAll({
            'enabled': true,
            'date': _date,
            'startsOn': history ? '2026-10-01' : _date,
            'days': days.values.toList(),
          });
        } else if (request.url.path.endsWith('/challenge')) {
          response.addAll({
            'registered': registeredKeys.contains(body['keyId']),
            'challenge': 'fresh-challenge-${++challenges}',
            'period': _period((body['dayOffset'] ?? 0) as int),
          });
        } else if (request.url.path.endsWith('/device')) {
          registeredKeys.add(body['keyId'] as String);
          response['registered'] = true;
        } else if (request.url.path.endsWith('/sync')) {
          final payload = jsonDecode(body['payload'] as String) as Map;
          final date = payload['date'] as String;
          if (!staleHistory) {
            days[date] = {
              'date': date,
              'steps': 2300,
              'credited': false,
              'complete': date != _date,
            };
          }
          response.addAll({'date': date, 'steps': 2300, 'rewarded': false});
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
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(WalkingRewardsNative.channel, null);
  });

  List<http.Request> posts(String suffix) =>
      requests.where((request) => request.url.path.endsWith(suffix)).toList();
  http.Response rejected(String code, {int status = 409, int? retry}) =>
      http.Response(
        jsonEncode({'success': false, 'code': code}),
        status,
        headers: {if (retry != null) 'retry-after': '$retry'},
      );

  for (final method in ['attest', 'measure']) {
    test(
      '$method invalid key registers the actual native replacement once',
      () async {
        if (method == 'attest') registeredKeys.clear();
        var failed = false;
        nativeOverride = (call) {
          if (call.method == method && !failed) {
            failed = true;
            key =
                'key-2'; // Installed bridge clears invalidKey then regenerates.
            throw PlatformException(code: 'WALKING_DEVICE_ERROR');
          }
          return null;
        };
        await api.setWalkingConsent(true);
        await Future.wait([api.syncWalking(), api.syncWalking()]);
        expect(api.walkingProgress.value!.steps, 2300);
        expect(api.walkingSyncFailure, null);
        final registration = jsonDecode(posts('/device').single.body) as Map;
        expect(registration['keyId'], 'key-2');
        expect(registration['deviceId'], device);
        expect(
          nativeCalls.where((call) => call.method == 'identity'),
          hasLength(2),
        );
        expect(posts('/sync'), hasLength(1));
        expect(jsonDecode(posts('/sync').single.body)['keyId'], 'key-2');
      },
    );
  }

  test(
    'generic device failure with unchanged identity does not reattest',
    () async {
      nativeOverride = (call) {
        if (call.method == 'measure') {
          throw PlatformException(code: 'WALKING_DEVICE_ERROR');
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await expectLater(api.syncWalking(), throwsA(isA<PlatformException>()));
      expect(api.walkingProgress.value!.steps, 1206);
      expect(posts('/sync'), isEmpty);
      expect(posts('/device'), isEmpty);
      expect(
        nativeCalls.where((call) => call.method == 'measure'),
        hasLength(1),
      );
      expect(
        nativeCalls.where((call) => call.method == 'identity'),
        hasLength(2),
      );
    },
  );

  test(
    'recovery rejects a changed stable device and never sends its proof',
    () async {
      nativeOverride = (call) {
        if (call.method == 'measure') {
          key = 'key-2';
          device = 'b' * 64;
          throw PlatformException(code: 'WALKING_DEVICE_ERROR');
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await expectLater(api.syncWalking(), throwsA(isA<PlatformException>()));
      expect(posts('/challenge'), hasLength(1));
      expect(posts('/device'), isEmpty);
      expect(posts('/sync'), isEmpty);
    },
  );

  for (final code in [
    'WALKING_PERMISSION',
    'WALKING_BUSY',
    'WALKING_UNSUPPORTED',
  ]) {
    test('$code never starts key or proof recovery', () async {
      nativeOverride = (call) {
        if (call.method == 'measure') throw PlatformException(code: code);
        return null;
      };
      await api.setWalkingConsent(true);
      await expectLater(api.syncWalking(), throwsA(isA<PlatformException>()));
      expect(
        nativeCalls.where((call) => call.method == 'identity'),
        hasLength(1),
      );
      expect(posts('/sync'), isEmpty);
    });
  }

  test(
    'sync rejection gets a new challenge and freshly measured signed proof',
    () async {
      var failed = false;
      serverOverride = (request) {
        if (request.url.path.endsWith('/sync') && !failed) {
          failed = true;
          return rejected('WALKING_PROOF_INVALID');
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await api.syncWalking();
      final bodies = posts(
        '/sync',
      ).map((r) => jsonDecode(r.body) as Map).toList();
      expect(bodies, hasLength(2));
      expect(bodies[0]['challenge'], isNot(bodies[1]['challenge']));
      expect(bodies[0]['assertion'], isNot(bodies[1]['assertion']));
      expect(bodies.every((body) => !body.containsKey('steps')), true);
      expect(posts('/device'), isEmpty);
      expect(api.walkingProgress.value!.steps, 2300);
    },
  );

  test(
    'lost registration plus consumed native attestation has bounded recovery',
    () async {
      var lost = false;
      var consumed = false;
      serverOverride = (request) {
        if (request.url.path.endsWith('/sync') && !lost) {
          lost = true;
          registeredKeys.clear();
          return rejected('WALKING_KEY_UNKNOWN');
        }
        return null;
      };
      nativeOverride = (call) {
        if (call.method == 'attest' && key == 'key-1' && !consumed) {
          consumed = true;
          key = 'key-2';
          throw PlatformException(code: 'WALKING_DEVICE_ERROR');
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(
        nativeCalls.where((call) => call.method == 'identity'),
        hasLength(3),
      );
      expect(posts('/device'), hasLength(1));
      expect(jsonDecode(posts('/device').single.body)['keyId'], 'key-2');
      expect(posts('/sync'), hasLength(2));
      expect(api.walkingSyncFailure, null);
    },
  );

  test(
    'persistent invalid proof stops after one fresh proof and keeps failure',
    () async {
      serverOverride = (request) => request.url.path.endsWith('/sync')
          ? rejected('WALKING_PROOF_INVALID')
          : null;
      await api.setWalkingConsent(true);
      await expectLater(api.syncWalking(), throwsA(isA<ApiException>()));
      expect(posts('/sync'), hasLength(2));
      expect(posts('/device'), isEmpty);
      expect(api.walkingSyncFailure, isA<ApiException>());
      await api.syncWalking();
      expect(posts('/sync'), hasLength(2));
      expect(api.walkingSyncFailure, isA<ApiException>());
    },
  );

  test('registration proof rejection is not retried or weakened', () async {
    registeredKeys.clear();
    serverOverride = (request) => request.url.path.endsWith('/device')
        ? rejected('WALKING_PROOF_INVALID')
        : null;
    await api.setWalkingConsent(true);
    await expectLater(api.syncWalking(), throwsA(isA<ApiException>()));
    expect(posts('/device'), hasLength(1));
    expect(posts('/sync'), isEmpty);
    expect(
      nativeCalls.where((call) => call.method == 'identity'),
      hasLength(1),
    );
  });

  for (final revoke in [false, true]) {
    test(
      '${revoke ? 'consent revocation' : 'account change'} fences key recovery',
      () async {
        final replacement = Completer<Map<String, dynamic>>();
        var identityCalls = 0;
        nativeOverride = (call) {
          if (call.method == 'identity' && ++identityCalls == 2) {
            return replacement.future;
          }
          if (call.method == 'measure') {
            key = 'key-2';
            throw PlatformException(code: 'WALKING_DEVICE_ERROR');
          }
          return null;
        };
        await api.setWalkingConsent(true);
        final pending = api.syncWalking();
        final expectation = expectLater(pending, throwsA(isA<ApiException>()));
        for (var i = 0; i < 100 && identityCalls < 2; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 2));
        }
        expect(identityCalls, 2);
        if (revoke) {
          await api.setWalkingConsent(false);
        } else {
          api.setSession(accessToken: 'bob-token', cacheScope: 'bob');
        }
        replacement.complete({'deviceId': device, 'keyId': key});
        await expectation;
        expect(posts('/challenge'), hasLength(1));
        expect(posts('/device'), isEmpty);
        expect(posts('/sync'), isEmpty);
      },
    );
  }

  test(
    'seven day catchup completes once then five minute polling uses today only',
    () async {
      history = true;
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(posts('/sync'), hasLength(7));
      for (var minute = 1; minute <= 4; minute++) {
        now = Duration(minutes: minute);
        await api.syncWalking();
      }
      expect(posts('/challenge'), hasLength(11));
      expect(posts('/sync'), hasLength(11));
    },
  );

  test(
    'historical proof recovery does not remeasure already accepted days',
    () async {
      history = true;
      var failed = false;
      serverOverride = (request) {
        if (request.url.path.endsWith('/sync') && !failed) {
          final body = jsonDecode(request.body) as Map;
          final payload = jsonDecode(body['payload'] as String) as Map;
          if (payload['date'] == '2026-10-05') {
            failed = true;
            return rejected('WALKING_PROOF_INVALID');
          }
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await api.syncWalking();
      final measuredDays = nativeCalls
          .where((call) => call.method == 'measure')
          .map((call) => (call.arguments as Map)['date'])
          .toList();
      expect(measuredDays.where((day) => day == _date), hasLength(1));
      expect(measuredDays.where((day) => day == '2026-10-06'), hasLength(1));
      expect(measuredDays, hasLength(8));
      expect(api.walkingProgress.value!.steps, 2300);
    },
  );

  test(
    "missing older motion history preserves today's accepted update",
    () async {
      history = true;
      nativeOverride = (call) {
        if (call.method == 'measure' &&
            (call.arguments as Map)['date'] != _date) {
          throw PlatformException(code: 'WALKING_DEVICE_ERROR');
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(api.walkingProgress.value!.steps, 2300);
      expect(api.walkingSyncFailure, null);
      expect(days.containsKey('2026-10-06'), false);
      expect(posts('/sync'), hasLength(1));
      now = const Duration(minutes: 1);
      await api.syncWalking();
      expect(posts('/sync'), hasLength(2));
      expect(
        nativeCalls.where(
          (call) =>
              call.method == 'measure' &&
              (call.arguments as Map)['date'] == '2026-10-06',
        ),
        hasLength(2),
      );
      nativeOverride = null;
      now = const Duration(minutes: 2);
      await api.syncWalking();
      expect(days['2026-10-06']!['complete'], true);
      expect(posts('/sync'), hasLength(9));
    },
  );

  test(
    'history quota pauses catchup without making today appear failed',
    () async {
      history = true;
      serverOverride = (request) {
        if (request.url.path.endsWith('/challenge') &&
            jsonDecode(request.body)['dayOffset'] == 1) {
          return rejected('WALKING_RATE_LIMIT', status: 429, retry: 180);
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await api.syncWalking();
      expect(api.walkingProgress.value!.steps, 2300);
      expect(api.walkingSyncFailure, null);
      expect(api.walkingRefreshDelay, const Duration(minutes: 3));
      now = const Duration(minutes: 2);
      await api.syncWalking();
      expect(posts('/sync'), hasLength(1));
      serverOverride = null;
      now = const Duration(minutes: 3);
      await api.syncWalking();
      expect(posts('/sync'), hasLength(8));
      expect(days['2026-10-06']!['complete'], true);
    },
  );

  for (final retry in [null, 180]) {
    test(
      'rate limit honors ${retry ?? 300}s without reconnect bypass',
      () async {
        serverOverride = (request) => request.url.path.endsWith('/sync')
            ? rejected('WALKING_RATE_LIMIT', status: 429, retry: retry)
            : null;
        await api.setWalkingConsent(true);
        await expectLater(api.syncWalking(), throwsA(isA<ApiException>()));
        final pause = retry ?? 300;
        now = Duration(seconds: pause - 1);
        expect(api.walkingRefreshDelay, const Duration(seconds: 1));
        await api.syncWalking();
        await api.syncWalking(requestPermission: true);
        await api.autoSyncWalking();
        expect(posts('/sync'), hasLength(1));
        expect(api.walkingSyncFailure, isA<ApiException>());
        serverOverride = null;
        now = Duration(seconds: pause);
        await api.syncWalking();
        expect(posts('/sync'), hasLength(2));
        expect(api.walkingSyncFailure, null);
      },
    );
  }

  test(
    'large stale history hits shared quota then stops all automatic retries',
    () async {
      history = true;
      staleHistory = true;
      var postCount = 0;
      serverOverride = (request) {
        if (request.method == 'POST' && ++postCount > 40) {
          return rejected('WALKING_RATE_LIMIT', status: 429, retry: 180);
        }
        return null;
      };
      await api.setWalkingConsent(true);
      await api.syncWalking();
      now = const Duration(minutes: 1);
      await api.syncWalking();
      now = const Duration(minutes: 2);
      await api
          .syncWalking(); // Today already committed before history hit quota.
      expect(postCount, 41);
      now = const Duration(minutes: 4);
      await api.autoSyncWalking();
      await api.syncWalking(requestPermission: true);
      expect(postCount, 41);
      expect(api.walkingProgress.value!.steps, 2300);
      expect(api.walkingSyncFailure, null);
    },
  );

  test('disable and reconnect retain the server quota timer', () async {
    serverOverride = (request) => request.url.path.endsWith('/sync')
        ? rejected('WALKING_RATE_LIMIT', status: 429, retry: 180)
        : null;
    await api.setWalkingConsent(true);
    await expectLater(api.syncWalking(), throwsA(isA<ApiException>()));
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    nativeOverride = (call) => call.method == 'stop' ? true : null;
    await api.setWalkingConsent(false);
    await api.setWalkingConsent(true);
    expect(api.walkingRefreshDelay, const Duration(minutes: 3));
    await api.syncWalking(requestPermission: true);
    expect(posts('/sync'), hasLength(1));
  });

  test('repeated native key errors stop after a single replacement', () async {
    var failures = 0;
    nativeOverride = (call) {
      if (call.method == 'measure') {
        key = 'key-${++failures + 1}';
        throw PlatformException(code: 'WALKING_DEVICE_ERROR');
      }
      return null;
    };
    await api.setWalkingConsent(true);
    await expectLater(api.syncWalking(), throwsA(isA<PlatformException>()));
    expect(failures, 2);
    expect(
      nativeCalls.where((call) => call.method == 'identity'),
      hasLength(2),
    );
    expect(posts('/device'), hasLength(1));
    expect(posts('/sync'), isEmpty);
  });

  testWidgets(
    'late native proof after timeout is not uploaded or retried early',
    (tester) async {
      try {
        final gate = Completer<Map<String, dynamic>>();
        nativeOverride = (call) =>
            call.method == 'measure' ? gate.future : null;
        await api.setWalkingConsent(true);
        final pending = api.syncWalking();
        final expectation = expectLater(
          pending,
          throwsA(isA<TimeoutException>()),
        );
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 45));
        await expectation;
        expect(
          nativeCalls.where((call) => call.method == 'identity'),
          hasLength(1),
        );
        gate.complete({
          'payload': 'late-native-proof',
          'assertion': 'late-signature',
        });
        await tester.pump();
        expect(posts('/sync'), isEmpty);
        now = const Duration(seconds: 59);
        await api.syncWalking();
        expect(
          nativeCalls.where((call) => call.method == 'measure'),
          hasLength(1),
        );
        expect(api.walkingSyncFailure, isA<TimeoutException>());
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    },
  );

  testWidgets(
    'older motion failure never puts an error on accepted today card',
    (tester) async {
      try {
        history = true;
        nativeOverride = (call) {
          if (call.method == 'measure' &&
              (call.arguments as Map)['date'] != _date) {
            throw PlatformException(code: 'WALKING_DEVICE_ERROR');
          }
          return null;
        };
        await api.setWalkingConsent(true);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: WalkingRewardsCard(api: api, onReward: () async {}),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('2 300'), findsOneWidget);
        expect(find.textContaining('Не удалось обновить шаги'), findsNothing);
        expect(find.text('Открыть настройки'), findsNothing);
        now = const Duration(minutes: 1);
        await tester.pump(const Duration(minutes: 1));
        await tester.pumpAndSettle();
        expect(posts('/sync'), hasLength(2));
        expect(find.textContaining('Не удалось обновить шаги'), findsNothing);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        debugDefaultTargetPlatformOverride = null;
      }
    },
  );

  testWidgets(
    'reentry preserves error during throttle and clears after real sync',
    (tester) async {
      try {
        nativeOverride = (call) {
          if (call.method == 'measure') {
            throw PlatformException(code: 'WALKING_DEVICE_ERROR');
          }
          return null;
        };
        await api.setWalkingConsent(true);
        Widget card() => MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: WalkingRewardsCard(api: api, onReward: () async {}),
            ),
          ),
        );
        await tester.pumpWidget(card());
        await tester.pumpAndSettle();
        expect(find.textContaining('Не удалось обновить шаги'), findsOneWidget);
        expect(find.text('1 206'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        now = const Duration(seconds: 20);
        await tester.pumpWidget(card());
        await tester.pumpAndSettle();
        expect(find.textContaining('Не удалось обновить шаги'), findsOneWidget);
        expect(
          nativeCalls.where((call) => call.method == 'measure'),
          hasLength(1),
        );
        nativeOverride = null;
        now = const Duration(minutes: 1);
        await tester.pump(const Duration(seconds: 40));
        await tester.pumpAndSettle();
        expect(find.textContaining('Не удалось обновить шаги'), findsNothing);
        expect(find.text('2 300'), findsOneWidget);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        debugDefaultTargetPlatformOverride = null;
      }
    },
  );
}
