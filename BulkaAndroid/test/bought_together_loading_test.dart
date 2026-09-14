import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
    'retries pending recommendations with branch context until ready',
    () async {
      var requests = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          expect(request.url.queryParameters['branchId'], 'branch-a');
          requests++;
          return http.Response(
            jsonEncode({
              'success': true,
              'ready': requests > 1,
              'productIds': requests > 1 ? ['astana:coffee'] : [],
            }),
            200,
          );
        }),
      );
      expect(
        await api.getBoughtTogetherProductIds(
          'astana:bun',
          branchId: 'branch-a',
        ),
        ['astana:coffee'],
      );
      expect(requests, 2);
      api.dispose();
    },
  );
  test('does not fetch after the product screen is disposed', () async {
    final api = BulkaApiClient(
      client: MockClient((_) async => throw StateError('unexpected request')),
    );
    expect(
      await api.getBoughtTogetherProductIds('bun', isActive: () => false),
      isEmpty,
    );
    api.dispose();
  });
}
