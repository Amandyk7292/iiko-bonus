import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _id = '9d479966-406a-41b4-9ad3-911ab7c6e2f2';
http.Response _json(Map<String, dynamic> value, [int status = 200]) =>
    http.Response(
      jsonEncode(value),
      status,
      headers: {'content-type': 'application/json'},
    );
Map<String, dynamic> get _uploaded => {
  'success': true,
  'photoId': _id,
  'expiresAt': DateTime.now()
      .toUtc()
      .add(const Duration(days: 1))
      .toIso8601String(),
};

void main() {
  test(
    'photo upload, preview and deletion use private authenticated requests',
    () async {
      final requests = <http.Request>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (!request.url.path.contains('/checkout-photo')) return _json({});
          requests.add(request);
          if (request.method == 'POST') return _json(_uploaded);
          if (request.method == 'DELETE') return _json({'success': true});
          return http.Response.bytes(
            [1, 2, 3],
            200,
            headers: {'content-type': 'image/png'},
          );
        }),
        useCookieSessionTransport: false,
      );
      addTearDown(api.dispose);
      api.setSession(accessToken: 'fixture-token', cacheScope: '77000000001');
      expect(
        (await api.uploadPickupOrderPhoto(
          bytes: [1, 2, 3],
          mimeType: 'image/png',
        ))['photoId'],
        _id,
      );
      expect(await api.getPickupOrderPhotoImage(_id), [1, 2, 3]);
      await api.removePickupOrderPhoto(_id);
      expect(requests.map((r) => r.method), ['POST', 'GET', 'DELETE']);
      for (final request in requests) {
        expect(request.headers['Authorization'], 'Bearer fixture-token');
      }
      expect(
        requests.first.body,
        contains('name="photo"; filename="pickup-photo.png"'),
      );
      expect(requests.first.body, isNot(contains('77000000001')));
      expect(requests[1].url.path, endsWith('/checkout-photo/$_id/image'));
    },
  );

  test(
    'a late upload response cannot authorize a different customer',
    () async {
      final response = Completer<http.Response>();
      final reachedServer = Completer<void>();
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (!request.url.path.endsWith('/checkout-photo')) return _json({});
          reachedServer.complete();
          return response.future;
        }),
        useCookieSessionTransport: false,
      );
      addTearDown(api.dispose);
      api.setSession(accessToken: 'first-token', cacheScope: '77000000001');
      final upload = api.uploadPickupOrderPhoto(
        bytes: [1],
        mimeType: 'image/png',
      );
      final assertion = expectLater(
        upload,
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'SESSION_IDENTITY_CHANGED',
          ),
        ),
      );
      await reachedServer.future;
      api.setSession(accessToken: 'second-token', cacheScope: '77000000002');
      response.complete(_json(_uploaded));
      await assertion;
    },
  );

  test(
    'private preview refreshes authentication once without changing its owner',
    () async {
      final tokens = <String?>[];
      var refreshes = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.url.path.endsWith('/refresh')) {
            refreshes++;
            return _json({
              'success': true,
              'accessToken': 'renewed-token',
              'refreshToken': 'renewed-refresh',
            });
          }
          if (!request.url.path.endsWith('/image')) return _json({});
          tokens.add(request.headers['Authorization']);
          if (tokens.length == 1) return _json({'message': 'expired'}, 401);
          return http.Response.bytes(
            [3],
            200,
            headers: {'content-type': 'image/jpeg'},
          );
        }),
        useCookieSessionTransport: false,
      );
      addTearDown(api.dispose);
      api.setSession(
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        cacheScope: '77000000001',
      );
      expect(await api.getPickupOrderPhotoImage(_id), [3]);
      expect(refreshes, 1);
      expect(tokens, ['Bearer old-token', 'Bearer renewed-token']);
      expect(api.sessionCacheScope, '77000000001');
    },
  );

  test(
    'private preview preserves real server rejection instead of decoding it as a photo',
    () async {
      final api = BulkaApiClient(
        client: MockClient(
          (request) async => request.url.path.endsWith('/image')
              ? _json({
                  'message': 'expired',
                  'code': 'PICKUP_PHOTO_EXPIRED',
                }, 410)
              : _json({}),
        ),
        useCookieSessionTransport: false,
      );
      addTearDown(api.dispose);
      api.setSession(accessToken: 'fixture-token', cacheScope: '77000000001');
      await expectLater(
        api.getPickupOrderPhotoImage(_id),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'status', 410)
              .having((e) => e.code, 'code', 'PICKUP_PHOTO_EXPIRED'),
        ),
      );
    },
  );

  test(
    'oversized and unsupported photo files are rejected before upload',
    () async {
      var requests = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          requests++;
          return _json(_uploaded);
        }),
      );
      addTearDown(api.dispose);
      await expectLater(
        api.uploadPickupOrderPhoto(
          bytes: List.filled(5 * 1024 * 1024 + 1, 0),
          mimeType: 'image/jpeg',
        ),
        throwsA(isA<ApiException>()),
      );
      await expectLater(
        api.uploadPickupOrderPhoto(bytes: [1], mimeType: 'image/svg+xml'),
        throwsA(isA<ApiException>()),
      );
      expect(requests, 0);
    },
  );

  test(
    'payment includes an explicitly chosen photo id and leaves ordinary checkout unchanged',
    () async {
      final payments = <Map<String, dynamic>>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.url.path.endsWith('/forte-pay/create')) {
            payments.add(jsonDecode(request.body) as Map<String, dynamic>);
          }
          return _json({'success': true});
        }),
        useCookieSessionTransport: false,
      );
      addTearDown(api.dispose);
      api.setSession(accessToken: 'fixture-token', cacheScope: '77000000001');
      for (final photoId in [null, _id]) {
        await api.createFortePayment(
          cartItems: const [
            {'productId': 'bun', 'quantity': 1},
          ],
          orderType: 'pickup',
          scheduledAt: '2026-10-06T06:00:00Z',
          checkoutId: 'checkout-one',
          pickupPhotoId: photoId,
        );
      }
      expect(payments.first.containsKey('pickupPhotoId'), isFalse);
      expect(payments.last.remove('pickupPhotoId'), _id);
      expect(payments.last, payments.first);
    },
  );
}
