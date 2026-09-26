import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';

import 'package:bulka_bonus/core/product_image_cache.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('stalled proxy falls back without forwarding proxy headers', () async {
    final requests = <http.Request>[];
    final service = ProductImageFileService(
      proxyTimeout: const Duration(milliseconds: 20),
      clientFactory: () => MockClient((request) async {
        requests.add(request);
        if (request.url.host == 'bulka.com.kz') {
          return Completer<http.Response>().future;
        }
        return http.Response.bytes(
          [1, 2, 3],
          200,
          headers: {'content-type': 'image/png'},
        );
      }),
    );
    final response = await service.get(
      'https://bulka.com.kz/api/public/image?path=menu_images/photo.png&edge=768',
      headers: {'If-None-Match': 'proxy-etag', 'Authorization': 'private'},
    );
    expect(response.statusCode, 200);
    expect(await response.content.expand((bytes) => bytes).toList(), [1, 2, 3]);
    expect(requests, hasLength(2));
    expect(
      requests.last.url.path,
      '/storage/v1/object/public/menu_images/photo.png',
    );
    expect(requests.last.headers.containsKey('authorization'), false);
    expect(requests.last.headers.containsKey('if-none-match'), false);
  });

  test('fallback survives a cache manager restart without network', () async {
    final directory = await Directory.systemTemp.createTemp(
      'bulka-photo-cache-',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.flutter.io/path_provider'),
          (_) async => directory.path,
        );
    var calls = 0;
    CacheManager createCache() => CacheManager(
      Config(
        'photo-restart-test',
        fileService: ProductImageFileService(
          clientFactory: () => MockClient((request) async {
            calls++;
            if (request.url.host == 'bulka.com.kz') {
              return http.Response('', 503);
            }
            return http.Response.bytes(
              [1, 2, 3],
              200,
              headers: {
                'content-type': 'image/png',
                'cache-control': 'public, max-age=86400',
              },
            );
          }),
        ),
      ),
    );
    const url =
        'https://bulka.com.kz/api/public/image?path=menu_images/drink.png&edge=768';
    final first = createCache();
    try {
      expect(await (await first.getSingleFile(url)).readAsBytes(), [1, 2, 3]);
      expect(calls, 2);
    } finally {
      await first.dispose();
    }
    final second = createCache();
    try {
      expect(await (await second.getSingleFile(url)).readAsBytes(), [1, 2, 3]);
      expect(calls, 2);
    } finally {
      await second.dispose();
      await directory.delete(recursive: true);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('plugins.flutter.io/path_provider'),
            null,
          );
    }
  });

  test('successful proxy and 304 never download the original', () async {
    for (final status in [200, 304]) {
      var calls = 0;
      final service = ProductImageFileService(
        clientFactory: () => MockClient((_) async {
          calls++;
          return http.Response('', status);
        }),
      );
      final response = await service.get(
        'https://bulka.com.kz/api/public/image?path=stories/banner.png&edge=768',
      );
      expect(response.statusCode, status);
      expect(calls, 1);
    }
  });

  test('options deduplicate openings and invalidate on menu updates', () async {
    var calls = 0;
    final api = BulkaApiClient(
      client: MockClient((_) async {
        calls++;
        return http.Response(
          jsonEncode({
            'success': true,
            'products': {
              'drink': {'configuration': null, 'modifierGroups': []},
            },
          }),
          200,
        );
      }),
    );
    await Future.wait([
      api.getProductOptions('drink'),
      api.getProductOptions('drink'),
    ]);
    await api.getProductOptions('drink');
    expect(calls, 1);
    api.invalidateProductOptions('drink');
    await api.getProductOptions('drink');
    expect(calls, 2);
  });

  test(
    'failed or incomplete options are not cached as safe to order',
    () async {
      var calls = 0;
      final api = BulkaApiClient(
        client: MockClient((_) async {
          calls++;
          return http.Response('{"success":true,"products":{}}', 200);
        }),
      );
      await expectLater(api.getProductOptions('drink'), throwsFormatException);
      await expectLater(api.getProductOptions('drink'), throwsFormatException);
      expect(calls, 2);
    },
  );
}
