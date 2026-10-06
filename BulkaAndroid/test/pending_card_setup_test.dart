import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
// The platform fake exercises the persistence acknowledgement contract.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';

class _UnacknowledgedPreferences extends InMemorySharedPreferencesStore {
  _UnacknowledgedPreferences() : super.empty();
  String? rejectWrite;
  String? rejectRemove;
  Completer<bool>? blockedWrite;

  @override
  Future<bool> setValue(String valueType, String key, Object value) async {
    if (rejectWrite != null && key.contains(rejectWrite!)) return false;
    final blocked = blockedWrite;
    if (blocked != null && key.contains('pending_card_setup_v1')) {
      if (!await blocked.future) return false;
    }
    return super.setValue(valueType, key, value);
  }

  @override
  Future<bool> remove(String key) async {
    if (rejectRemove != null && key.contains(rejectRemove!)) return false;
    return super.remove(key);
  }
}

_UnacknowledgedPreferences _installUnacknowledgedPreferences() {
  final original = SharedPreferencesStorePlatform.instance;
  final store = _UnacknowledgedPreferences();
  SharedPreferencesStorePlatform.instance = store;
  addTearDown(() => SharedPreferencesStorePlatform.instance = original);
  return store;
}

class _SetupApi extends BulkaApiClient {
  String owner = 'customer-one';
  int starts = 0;
  int resumes = 0;
  int cancellations = 0;
  String status = 'pending';
  bool offline = false;
  ApiException? cancellationError;
  Map<String, dynamic>? cancellationResult;
  Completer<Map<String, dynamic>>? pendingCancellation;
  @override
  String? get sessionCacheScope => owner;
  @override
  Future<Map<String, dynamic>> createForteCardSetup() async {
    starts++;
    return {'operationId': 'setup-$starts', 'paymentStatus': status};
  }

  @override
  Future<Map<String, dynamic>> resumeForteCardSetup(String id) async {
    resumes++;
    if (offline) throw ApiException('offline');
    return {'operationId': id, 'paymentStatus': status};
  }

  Map<String, dynamic> cancellation(String id) => {
    'success': true,
    'operationId': id,
    'paymentStatus': 'pending',
    'status': 'pending',
    'cancelled': true,
    'cardSaved': false,
    'canResume': false,
  };
  @override
  Future<Map<String, dynamic>> cancelForteCardSetup(String id) async {
    cancellations++;
    if (offline) throw ApiException('offline');
    if (cancellationError != null) throw cancellationError!;
    return pendingCancellation?.future ??
        cancellationResult ??
        cancellation(id);
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  test(
    'a false operation write never returns a launchable bank form',
    () async {
      final store = _installUnacknowledgedPreferences()
        ..rejectWrite = 'pending_card_setup_v1';
      final api = _SetupApi()..owner = 'failed-operation-write';
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(isA<ApiException>()),
      );
      expect(api.starts, 1);
      // Reload removes the optimistic SharedPreferences cache entry; the store
      // must still reconcile the known server operation before another launch.
      await (await SharedPreferences.getInstance()).reload();
      expect(await PendingCardSetupStore.load(api), 'setup-1');
      store.rejectWrite = null;
      api.offline = true;
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(isA<ApiException>()),
      );
      expect(api.starts, 1);
      api.offline = false;
      final fresh = await PendingCardSetupStore.createOrResume(api);
      expect(fresh['operationId'], 'setup-2');
      expect(api.cancellations, 2);
      await PendingCardSetupStore.clear(api, 'setup-2');
      api.dispose();
    },
  );

  test(
    'false cancellation-intent write cannot acknowledge cancellation',
    () async {
      final store = _installUnacknowledgedPreferences();
      final api = _SetupApi()..owner = 'failed-cancellation-write';
      await PendingCardSetupStore.save(api, 'old-operation');
      store.rejectWrite = 'pending_card_setup_cancel_v1';
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(isA<ApiException>()),
      );
      expect(api.cancellations, 0);
      expect(api.starts, 0);
      await (await SharedPreferences.getInstance()).reload();
      expect(await PendingCardSetupStore.load(api), 'old-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        false,
      );
      store.rejectWrite = null;
      await PendingCardSetupStore.cancel(api, 'old-operation');
      expect(api.cancellations, 1);
      expect(await PendingCardSetupStore.load(api), isNull);
      api.dispose();
    },
  );

  for (final removal in [
    'pending_card_setup_v1',
    'pending_card_setup_cancel_v1',
  ]) {
    test(
      'false $removal removal blocks a fresh hold despite cache eviction',
      () async {
        final store = _installUnacknowledgedPreferences();
        final api = _SetupApi()..owner = 'failed-removal-$removal';
        await PendingCardSetupStore.save(api, 'old-operation');
        store.rejectRemove = removal;
        for (var attempt = 0; attempt < 2; attempt++) {
          await expectLater(
            PendingCardSetupStore.createOrResume(api),
            throwsA(isA<ApiException>()),
          );
          expect(api.starts, 0);
          expect(await PendingCardSetupStore.load(api), 'old-operation');
        }
        store.rejectRemove = null;
        final fresh = await PendingCardSetupStore.createOrResume(api);
        expect(fresh['operationId'], 'setup-1');
        expect(api.cancellations, 3);
        await PendingCardSetupStore.clear(api, 'setup-1');
        api.dispose();
      },
    );
  }

  testWidgets('a stalled operation write times out without opening its form', (
    tester,
  ) async {
    final store = _installUnacknowledgedPreferences();
    final reply = store.blockedWrite = Completer<bool>();
    final api = _SetupApi()..owner = 'stalled-operation-write';
    final request = PendingCardSetupStore.createOrResume(api);
    final rejected = expectLater(request, throwsA(isA<ApiException>()));
    await tester.pump();
    expect(api.starts, 1);
    await tester.pump(const Duration(seconds: 3));
    await rejected;
    expect(await PendingCardSetupStore.load(api), 'setup-1');
    expect(api.cancellations, 0);
    store.blockedWrite = null;
    reply.complete(false);
    await tester.pump();
    await PendingCardSetupStore.cancel(api, 'setup-1');
    expect(await PendingCardSetupStore.load(api), isNull);
    api.dispose();
  });
  test(
    'a second Add Card cancels the exited form and creates a fresh operation',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.createOrResume(api);
      await PendingCardSetupStore.createOrResume(api);
      expect(api.starts, 2);
      expect(api.cancellations, 1);
      expect(api.resumes, 0);
      expect(await PendingCardSetupStore.load(api), 'setup-2');
      expect(
        await PendingCardSetupStore.isCancellationRequested(api, 'setup-1'),
        false,
      );
      api.dispose();
    },
  );

  test(
    'an acknowledged cancellation clears a financially pending operation',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      final result = await PendingCardSetupStore.cancel(api, 'old-operation');
      expect(result['paymentStatus'], 'pending');
      expect(result['cancelled'], true);
      expect(await PendingCardSetupStore.load(api), isNull);
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        false,
      );
      expect(api.starts, 0);
      api.dispose();
    },
  );

  test(
    'unknown cancellation keeps its durable intent and blocks a fresh hold',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      api.offline = true;
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'CARD_SETUP_CANCEL_UNAVAILABLE',
          ),
        ),
      );
      expect(await PendingCardSetupStore.load(api), 'old-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        true,
      );
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(isA<ApiException>()),
      );
      expect(api.starts, 0);
      expect(api.resumes, 0);
      api.offline = false;
      await PendingCardSetupStore.createOrResume(api);
      expect(api.starts, 1);
      expect(await PendingCardSetupStore.load(api), 'setup-1');
      api.dispose();
    },
  );

  test(
    'late card-save acknowledgement returns paid without another verification hold',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      api.cancellationResult = {
        ...api.cancellation('old-operation'),
        'cardSaved': true,
        'cancelled': false,
      };
      final result = await PendingCardSetupStore.createOrResume(api);
      expect(result['paymentStatus'], 'paid');
      expect(result['status'], 'paid');
      expect(api.starts, 0);
      expect(api.resumes, 0);
      expect(await PendingCardSetupStore.load(api), isNull);
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        false,
      );
      api.dispose();
    },
  );

  test(
    'typed not-found cancellation retires a stale session before fresh creation',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      api.cancellationError = ApiException(
        'Not found',
        statusCode: 404,
        code: 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND',
      );
      await PendingCardSetupStore.createOrResume(api);
      expect(api.starts, 1);
      expect(api.resumes, 0);
      expect(await PendingCardSetupStore.load(api), 'setup-1');
      api.dispose();
    },
  );

  test(
    'HTML not-found cancellation is unknown and cannot start a second hold',
    () async {
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response('<html>Not found</html>', 404),
        ),
      );
      await PendingCardSetupStore.save(api, 'old-operation');
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'CARD_SETUP_CANCEL_UNAVAILABLE',
          ),
        ),
      );
      expect(await PendingCardSetupStore.load(api), 'old-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        true,
      );
      api.dispose();
    },
  );

  test(
    'non-acknowledgement or wrong operation response never retires pending evidence',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      for (final result in [
        {...api.cancellation('old-operation'), 'cancelled': false},
        api.cancellation('other-operation'),
      ]) {
        api.cancellationResult = result;
        await expectLater(
          PendingCardSetupStore.createOrResume(api),
          throwsA(isA<ApiException>()),
        );
        expect(api.starts, 0);
        expect(await PendingCardSetupStore.load(api), 'old-operation');
        expect(
          await PendingCardSetupStore.isCancellationRequested(
            api,
            'old-operation',
          ),
          true,
        );
      }
      api.dispose();
    },
  );

  test(
    'concurrent Add Card actions share cancellation and a single fresh hold',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      final reply = api.pendingCancellation = Completer<Map<String, dynamic>>();
      final first = PendingCardSetupStore.createOrResume(api);
      final second = PendingCardSetupStore.createOrResume(api);
      await Future<void>.delayed(Duration.zero);
      expect(api.cancellations, 1);
      expect(api.starts, 0);
      reply.complete(api.cancellation('old-operation'));
      final results = await Future.wait([first, second]);
      expect(api.starts, 1);
      expect(results.map((r) => r['operationId']), ['setup-1', 'setup-1']);
      api.dispose();
    },
  );

  test(
    'an owner change during cancellation cannot clear the next account or create its hold',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      final other = _SetupApi()..owner = 'customer-two';
      await PendingCardSetupStore.save(other, 'other-operation');
      final reply = api.pendingCancellation = Completer<Map<String, dynamic>>();
      final request = PendingCardSetupStore.createOrResume(api);
      final rejected = expectLater(
        request,
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'SESSION_IDENTITY_CHANGED',
          ),
        ),
      );
      await Future<void>.delayed(Duration.zero);
      api.owner = 'customer-two';
      reply.complete(api.cancellation('old-operation'));
      await rejected;
      expect(api.starts, 0);
      expect(await PendingCardSetupStore.load(other), 'other-operation');
      api.owner = 'customer-one';
      expect(await PendingCardSetupStore.load(api), 'old-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        true,
      );
      api.dispose();
      other.dispose();
    },
  );

  test(
    'logout and re-login cannot accept a cancellation response from the previous session',
    () async {
      final api = _SetupApi()
        ..setSession(accessToken: 'test-token', cacheScope: 'customer-one');
      await PendingCardSetupStore.save(api, 'old-operation');
      final reply = api.pendingCancellation = Completer<Map<String, dynamic>>();
      final request = PendingCardSetupStore.cancel(api, 'old-operation');
      final rejected = expectLater(
        request,
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'SESSION_IDENTITY_CHANGED',
          ),
        ),
      );
      await Future<void>.delayed(Duration.zero);
      api.setSession();
      api.setSession(
        accessToken: 'next-test-token',
        cacheScope: 'customer-one',
      );
      reply.complete(api.cancellation('old-operation'));
      await rejected;
      expect(await PendingCardSetupStore.load(api), 'old-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        true,
      );
      api.dispose();
    },
  );

  test(
    'clearing an older session cannot remove a newer pending id or cancellation intent',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'new-operation');
      await PendingCardSetupStore.markCancellationRequested(
        api,
        'new-operation',
      );
      await PendingCardSetupStore.clear(api, 'old-operation');
      expect(await PendingCardSetupStore.load(api), 'new-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'new-operation',
        ),
        true,
      );
      api.dispose();
    },
  );

  testWidgets(
    'cancellation times out while preserving intent and blocking fresh creation',
    (tester) async {
      final api = _SetupApi();
      await PendingCardSetupStore.save(api, 'old-operation');
      final reply = api.pendingCancellation = Completer<Map<String, dynamic>>();
      final request = PendingCardSetupStore.createOrResume(api);
      final rejected = expectLater(
        request,
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'CARD_SETUP_CANCEL_UNAVAILABLE',
          ),
        ),
      );
      await tester.pump();
      expect(api.cancellations, 1);
      await tester.pump(const Duration(seconds: 9));
      await rejected;
      expect(api.starts, 0);
      expect(await PendingCardSetupStore.load(api), 'old-operation');
      expect(
        await PendingCardSetupStore.isCancellationRequested(
          api,
          'old-operation',
        ),
        true,
      );
      reply.complete(api.cancellation('old-operation'));
      await tester.pump();
      api.dispose();
    },
  );
  test(
    'HTML gateway failures preserve a typed error and do not prove a missing payment',
    () async {
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response('<html>Not found</html>', 404),
        ),
      );
      await expectLater(
        api.checkForteCheckoutStatus('test-id'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.code, 'code', 'INVALID_API_RESPONSE')
              .having((e) => e.statusCode, 'status', 404),
        ),
      );
      api.dispose();
    },
  );
  testWidgets(
    'hosted checkout explains payment without forcing an unavailable card setup',
    (tester) async {
      final api = BulkaApiClient(
        client: MockClient(
          (request) async => http.Response(
            jsonEncode(
              request.url.path.endsWith('/availability')
                  ? {
                      'success': true,
                      'available': true,
                      'integration': 'hosted_page',
                      'cardSetup': false,
                    }
                  : {'success': true, 'methods': []},
            ),
            200,
          ),
        ),
      );
      final available = await api.isFortePaymentAvailable();
      expect(available, true);
      expect(api.forteCardSetupAvailable, false);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: buildCheckoutSavedCardsPanelForTest(
              api: api,
              available: available,
              selectedMethodId: null,
              onDefaultResolved: (_) {},
              onSelect: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-hosted-payment')),
        findsOneWidget,
      );
      expect(find.text('Добавить карту'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    },
  );
}
