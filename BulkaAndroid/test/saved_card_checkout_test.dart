import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('Forte checkout sends the selected saved card id', () async {
    Map<String, dynamic>? requestBody;
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/customer/forte-pay/create');
      requestBody = Map<String, dynamic>.from(jsonDecode(request.body) as Map);
      return http.Response(
        jsonEncode({
          'success': true,
          'operationId': 'f5557b78-8344-44f8-ab5d-bdeb6e313547',
          'redirectUrl':
              'https://bulka.com.kz/payments/forte-widget#checkout-token',
        }),
        201,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = BulkaApiClient(client: client)
      ..setSession(accessToken: 'access-token');

    await api.createFortePayment(
      cartItems: const [
        {'productId': 'product-1', 'quantity': 1},
      ],
      orderType: 'pickup',
      scheduledAt: '2026-07-28T16:00:00.000Z',
      checkoutId: '31f0d793-0102-4d2f-a5a1-744d12cffe7c',
      savedPaymentMethodId: '86d95454-7866-414d-a3f1-8f85cef12391',
    );

    expect(
      requestBody?['savedPaymentMethodId'],
      '86d95454-7866-414d-a3f1-8f85cef12391',
    );
  });
}
