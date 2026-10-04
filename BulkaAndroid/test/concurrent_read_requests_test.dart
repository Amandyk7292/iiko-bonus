import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response _json(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  test(
    'read after successful address deletion cannot join pre-delete read',
    () async {
      final beforeDelete = Completer<http.Response>();
      var reads = 0;
      final api = BulkaApiClient(
        client: MockClient((request) {
          if (request.method == 'DELETE') {
            return Future.value(_json({'success': true}));
          }
          reads++;
          return reads == 1
              ? beforeDelete.future
              : Future.value(_json({'success': true, 'addresses': []}));
        }),
      );
      addTearDown(api.dispose);
      final old = api.getCustomerAddresses();
      await Future<void>.delayed(Duration.zero);
      await api.deleteCustomerAddress('deleted-address');
      final fresh = api.getCustomerAddresses();
      await Future<void>.delayed(Duration.zero);
      expect(reads, 2);
      expect(
        await fresh,
        isEmpty,
        reason: 'Fresh state must arrive before the older snapshot completes.',
      );
      beforeDelete.complete(
        _json({
          'success': true,
          'addresses': [
            {
              'id': 'deleted-address',
              'address': 'Старый адрес',
              'city': 'Актау',
              'latitude': 43.65,
              'longitude': 51.19,
            },
          ],
        }),
      );
      expect((await old).single.id, 'deleted-address');
    },
  );

  final writers = <String, Future<dynamic> Function(BulkaApiClient)>{
    'POST': (api) => api.createPersonalAccountTopup('fixture', 500),
    'PUT': (api) => api.updateProfile(phone: '77760000000', name: 'fixture'),
    'PATCH': (api) => api.setDefaultCustomerAddress('fixture'),
    'DELETE': (api) => api.deleteCustomerAddress('fixture'),
    'multipart': (api) => api.uploadCustomerAvatar(
      bytes: [1, 2, 3],
      fileName: 'fixture.png',
      mimeType: 'image/png',
    ),
  };
  for (final entry in writers.entries) {
    test(
      '${entry.key} separates reads before, during and after its completion',
      () async {
        final responses = <Completer<http.Response>>[];
        final mutation = Completer<http.Response>();
        final api = BulkaApiClient(
          client: MockClient((request) {
            if (request.method != 'GET') return mutation.future;
            final response = Completer<http.Response>();
            responses.add(response);
            return response.future;
          }),
        );
        addTearDown(api.dispose);
        final before = api.getPersonalAccount();
        final beforeTwin = api.getPersonalAccount();
        await Future<void>.delayed(Duration.zero);
        expect(responses, hasLength(1));
        final write = entry.value(api);
        final during = api.getPersonalAccount();
        await Future<void>.delayed(Duration.zero);
        expect(responses, hasLength(2));
        mutation.complete(
          _json({
            'success': true,
            'avatar': {'key': 'fixture'},
          }),
        );
        await write;
        final after = api.getPersonalAccount();
        await Future<void>.delayed(Duration.zero);
        expect(responses, hasLength(3));
        for (var i = 0; i < responses.length; i++) {
          responses[i].complete(_json({'revision': i}));
        }
        expect(
          (await Future.wait([
            before,
            beforeTwin,
            during,
            after,
          ])).map((r) => r['revision']),
          [0, 0, 1, 2],
        );
      },
    );
  }

  for (final unknown in [false, true]) {
    test(
      'failed write separates future reads (${unknown ? 'unknown transport outcome' : 'HTTP failure'})',
      () async {
        final responses = <Completer<http.Response>>[];
        final mutation = Completer<http.Response>();
        final api = BulkaApiClient(
          client: MockClient((request) {
            if (request.method != 'GET') return mutation.future;
            final response = Completer<http.Response>();
            responses.add(response);
            return response.future;
          }),
        );
        addTearDown(api.dispose);
        final before = api.getPersonalAccount();
        final failed = expectLater(
          api.deleteCustomerAddress('fixture'),
          throwsA(unknown ? isA<TimeoutException>() : isA<ApiException>()),
        );
        final during = api.getPersonalAccount();
        await Future<void>.delayed(Duration.zero);
        expect(responses, hasLength(2));
        if (unknown) {
          mutation.completeError(TimeoutException('fixture'));
        } else {
          mutation.complete(_json({'code': 'FIXTURE_FAILURE'}, status: 503));
        }
        await failed;
        final after = api.getPersonalAccount();
        await Future<void>.delayed(Duration.zero);
        expect(responses, hasLength(3));
        for (var i = 0; i < responses.length; i++) {
          responses[i].complete(_json({'revision': i}));
        }
        expect(
          (await Future.wait([
            before,
            during,
            after,
          ])).map((r) => r['revision']),
          [0, 1, 2],
        );
      },
    );
  }

  test(
    'each overlapping mutation completion advances the read boundary',
    () async {
      final responses = <Completer<http.Response>>[];
      final firstWrite = Completer<http.Response>();
      final secondWrite = Completer<http.Response>();
      var writes = 0;
      final api = BulkaApiClient(
        client: MockClient((request) {
          if (request.method != 'GET') {
            return ++writes == 1 ? firstWrite.future : secondWrite.future;
          }
          final response = Completer<http.Response>();
          responses.add(response);
          return response.future;
        }),
      );
      addTearDown(api.dispose);
      final reads = [api.getPersonalAccount()];
      final first = api.deleteCustomerAddress('first');
      reads.add(api.getPersonalAccount());
      final second = api.deleteCustomerAddress('second');
      reads.add(api.getPersonalAccount());
      await Future<void>.delayed(Duration.zero);
      expect(responses, hasLength(3));
      firstWrite.complete(_json({'success': true}));
      await first;
      reads.add(api.getPersonalAccount());
      await Future<void>.delayed(Duration.zero);
      expect(responses, hasLength(4));
      secondWrite.complete(_json({'success': true}));
      await second;
      reads.add(api.getPersonalAccount());
      await Future<void>.delayed(Duration.zero);
      expect(responses, hasLength(5));
      for (var i = 0; i < responses.length; i++) {
        responses[i].complete(_json({'revision': i}));
      }
      expect((await Future.wait(reads)).map((r) => r['revision']), [
        0,
        1,
        2,
        3,
        4,
      ]);
    },
  );

  test(
    'concurrent reads share transport but keep independent nested data',
    () async {
      final response = Completer<http.Response>();
      var reads = 0;
      final api = BulkaApiClient(
        client: MockClient((_) {
          reads++;
          return response.future;
        }),
      );
      addTearDown(api.dispose);
      final first = api.getPersonalAccount();
      final second = api.getPersonalAccount();
      await Future<void>.delayed(Duration.zero);
      expect(reads, 1);
      response.complete(
        _json({
          'items': [
            {'amount': 500},
          ],
        }),
      );
      final data = await Future.wait([first, second]);
      (data.first['items'] as List).first['amount'] = 0;
      expect((data.last['items'] as List).first['amount'], 500);
      expect(identical(data.first, data.last), isFalse);
      await api.getPersonalAccount();
      expect(
        reads,
        2,
        reason: 'Completed reads have no TTL or retained response.',
      );
    },
  );

  test(
    'query, language and API instance remain separate read scopes',
    () async {
      final response = Completer<http.Response>();
      final requests = <http.Request>[];
      http.Client client() => MockClient((request) {
        requests.add(request);
        return response.future;
      });
      final api = BulkaApiClient(client: client());
      final other = BulkaApiClient(client: client());
      addTearDown(api.dispose);
      addTearDown(other.dispose);
      final pending = [
        api.getCustomerOrders(),
        api.getCustomerOrders(completed: true),
      ];
      appLanguageNotifier.value = 'kk';
      pending.add(api.getCustomerOrders());
      pending.add(other.getCustomerOrders());
      await Future<void>.delayed(Duration.zero);
      expect(requests, hasLength(4));
      expect(
        requests.take(2).map((r) => r.headers['Accept-Language']),
        everyElement('ru'),
      );
      expect(
        requests.skip(2).map((r) => r.headers['Accept-Language']),
        everyElement('kk'),
      );
      response.complete(_json({'success': true, 'orders': []}));
      await Future.wait(pending);
    },
  );

  test('account switch cannot join or adopt a previous pending read', () async {
    final oldResponse = Completer<http.Response>();
    final currentResponse = Completer<http.Response>();
    var reads = 0;
    final api = BulkaApiClient(
      client: MockClient((request) {
        if (request.method != 'GET') {
          return Future.value(_json({'success': true}));
        }
        reads++;
        return request.headers['Authorization'] == 'Bearer old'
            ? oldResponse.future
            : currentResponse.future;
      }),
    )..setSession(accessToken: 'old');
    addTearDown(api.dispose);
    final old = api.getPersonalAccount();
    final oldCheck = expectLater(
      old,
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          'SESSION_IDENTITY_CHANGED',
        ),
      ),
    );
    api.setSession(accessToken: 'current');
    final current = api.getPersonalAccount();
    await Future<void>.delayed(Duration.zero);
    expect(reads, 2);
    oldResponse.complete(_json({'owner': 'old'}));
    currentResponse.complete(_json({'owner': 'current'}));
    await oldCheck;
    expect((await current)['owner'], 'current');
  });

  test(
    'shared API error retains metadata and a later retry is independent',
    () async {
      final response = Completer<http.Response>();
      var reads = 0;
      final api = BulkaApiClient(
        client: MockClient((_) {
          reads++;
          return reads == 1
              ? response.future
              : Future.value(_json({'amount': 500}));
        }),
      );
      addTearDown(api.dispose);
      final error = isA<ApiException>()
          .having((e) => e.statusCode, 'status', 429)
          .having((e) => e.code, 'code', 'TEMPORARY_LIMIT')
          .having((e) => e.retryAfterSeconds, 'retry', 60)
          .having((e) => e.requestId, 'request ID', 'fixture-id');
      final first = expectLater(api.getPersonalAccount(), throwsA(error));
      final second = expectLater(api.getPersonalAccount(), throwsA(error));
      await Future<void>.delayed(Duration.zero);
      expect(reads, 1);
      response.complete(
        _json({
          'code': 'TEMPORARY_LIMIT',
          'retryAfterSeconds': 60,
          'requestId': 'fixture-id',
        }, status: 429),
      );
      await Future.wait([first, second]);
      expect((await api.getPersonalAccount())['amount'], 500);
      expect(reads, 2);
    },
  );

  test(
    'transport failure fans out without an unhandled cleanup error',
    () async {
      final response = Completer<http.Response>();
      var reads = 0;
      final api = BulkaApiClient(
        client: MockClient((_) {
          reads++;
          return reads == 1 ? response.future : Future.value(_json({}));
        }),
      );
      addTearDown(api.dispose);
      final first = expectLater(
        api.getPersonalAccount(),
        throwsA(isA<TimeoutException>()),
      );
      final second = expectLater(
        api.getPersonalAccount(),
        throwsA(isA<TimeoutException>()),
      );
      await Future<void>.delayed(Duration.zero);
      response.completeError(TimeoutException('fixture'));
      await Future.wait([first, second]);
      await api.getPersonalAccount();
      expect(reads, 2);
    },
  );

  test(
    'concurrent 401 reads refresh once and share the authenticated retry',
    () async {
      final expired = Completer<http.Response>();
      final recovered = Completer<http.Response>();
      var reads = 0;
      var refreshes = 0;
      final api = BulkaApiClient(
        client: MockClient((request) {
          if (request.url.path == '/api/auth/refresh') {
            refreshes++;
            return Future.value(
              _json({'accessToken': 'new', 'refreshToken': 'new-refresh'}),
            );
          }
          if (request.method != 'GET') {
            return Future.value(_json({'success': true}));
          }
          reads++;
          return request.headers['Authorization'] == 'Bearer old'
              ? expired.future
              : recovered.future;
        }),
      )..setSession(accessToken: 'old', refreshToken: 'refresh');
      addTearDown(api.dispose);
      final results = Future.wait([
        api.getPersonalAccount(),
        api.getPersonalAccount(),
      ]);
      await Future<void>.delayed(Duration.zero);
      expect(reads, 1);
      expired.complete(_json({}, status: 401));
      await Future<void>.delayed(Duration.zero);
      expect(refreshes, 1);
      expect(reads, 2);
      recovered.complete(_json({'amount': 500}));
      expect((await results).map((r) => r['amount']), everyElement(500));
    },
  );

  test('identical writes are never coalesced', () async {
    final response = Completer<http.Response>();
    var writes = 0;
    final api = BulkaApiClient(
      client: MockClient((_) {
        writes++;
        return response.future;
      }),
    );
    addTearDown(api.dispose);
    final first = api.createPersonalAccountTopup('fixture', 500);
    final second = api.createPersonalAccountTopup('fixture', 500);
    await Future<void>.delayed(Duration.zero);
    expect(writes, 2);
    response.complete(_json({'success': true}));
    await Future.wait([first, second]);
  });

  testWidgets('shared stalled reads still time out and permit a fresh retry', (
    tester,
  ) async {
    var reads = 0;
    final response = Completer<http.Response>();
    final api = BulkaApiClient(
      client: MockClient((_) {
        reads++;
        return reads == 1 ? response.future : Future.value(_json({}));
      }),
    );
    addTearDown(api.dispose);
    final first = expectLater(
      api.getPersonalAccount(),
      throwsA(isA<TimeoutException>()),
    );
    final second = expectLater(
      api.getPersonalAccount(),
      throwsA(isA<TimeoutException>()),
    );
    await tester.pump();
    expect(reads, 1);
    await tester.pump(const Duration(seconds: 15));
    await Future.wait([first, second]);
    await api.getPersonalAccount();
    expect(reads, 2);
  });
}
