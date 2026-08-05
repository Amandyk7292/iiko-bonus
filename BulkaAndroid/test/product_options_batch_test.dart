import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('catalog resolves 162 option flags with one compact request', () async {
    final ids = List.generate(162, (index) => 'product-$index');
    var requestCount = 0;
    final client = MockClient((request) async {
      requestCount += 1;
      expect(request.method, 'POST');
      expect(request.url.path, '/api/public/product-options/summary');
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      final requestedIds = (body['productIds'] as List).cast<String>();
      expect(requestedIds, hasLength(162));
      return http.Response(
        jsonEncode({
          'success': true,
          'products': {for (final id in requestedIds) id: id == 'product-7'},
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    final flags = await BulkaApiClient(
      client: client,
    ).getProductOptionFlagsBatch(ids);

    expect(requestCount, 1);
    expect(flags, hasLength(162));
    expect(flags['product-7'], isTrue);
    expect(flags['product-8'], isFalse);
  });
}
