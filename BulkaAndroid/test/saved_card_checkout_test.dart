import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('checkout quote uses the Forte endpoint', () async {
    Uri? requestUri;
    final client = MockClient((request) async {
      requestUri = request.url;
      return http.Response(
        jsonEncode({
          'success': true,
          'subtotal': 500,
          'discount': 0,
          'deliveryFee': 0,
          'total': 500,
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = BulkaApiClient(client: client)
      ..setSession(accessToken: 'access-token');

    await api.quoteForteOrder(
      cartItems: const [
        {'productId': 'product-1', 'quantity': 1},
      ],
      orderType: 'pickup',
      scheduledAt: '2026-07-28T16:00:00.000Z',
      branchId: 'branch-1',
    );

    expect(requestUri?.path, '/api/customer/forte-pay/quote');
  });

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

  testWidgets('checkout renders every saved card and selects the tapped card', (
    tester,
  ) async {
    String? selectedMethodId;
    late StateSetter updateHarness;
    final api = _SavedCardsApi();

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              updateHarness = setState;
              return buildCheckoutSavedCardsPanelForTest(
                api: api,
                selectedMethodId: selectedMethodId,
                onDefaultResolved: (methodId) {
                  updateHarness(() => selectedMethodId = methodId);
                },
                onSelect: (methodId) {
                  updateHarness(() => selectedMethodId = methodId);
                },
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('checkout-saved-card-card-one')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('checkout-saved-card-card-two')),
      findsOneWidget,
    );
    expect(find.text('VISA •••• 1328'), findsOneWidget);
    expect(find.text('MASTERCARD •••• 2046'), findsOneWidget);
    expect(selectedMethodId, 'card-one');
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('checkout-saved-card-card-one')),
        matching: find.byIcon(Icons.check_circle_rounded),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('CVV'), findsNothing);
    expect(find.textContaining('защищённому токену'), findsNothing);

    await tester.tap(
      find.byKey(const ValueKey('checkout-saved-card-card-two')),
    );
    await tester.pumpAndSettle();

    expect(selectedMethodId, 'card-two');
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('checkout-saved-card-card-two')),
        matching: find.byIcon(Icons.check_circle_rounded),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('CVV'), findsNothing);
  });
}

class _SavedCardsApi extends BulkaApiClient {
  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => [
    {
      'id': 'card-one',
      'brand': 'visa',
      'lastFour': '1328',
      'expMonth': 12,
      'expYear': 2029,
      'isDefault': true,
      'requiresRelink': false,
    },
    {
      'id': 'card-two',
      'brand': 'mastercard',
      'lastFour': '2046',
      'expMonth': 8,
      'expYear': 2030,
      'isDefault': false,
      'requiresRelink': true,
    },
  ];
}
