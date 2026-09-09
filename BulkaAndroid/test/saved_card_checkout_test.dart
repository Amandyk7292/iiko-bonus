import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('checkout quote uses the Forte endpoint', () async {
    Uri? requestUri;
    Map<String, dynamic>? quoteBody;
    final client = MockClient((request) async {
      requestUri = request.url;
      quoteBody = jsonDecode(request.body) as Map<String, dynamic>;
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
      useBonuses: true,
    );

    expect(requestUri?.path, '/api/customer/forte-pay/quote');
    expect(quoteBody?['deliveryQuoteVersion'], 1);
    expect(quoteBody?['useBonuses'], true);
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
      deliveryQuoteToken: 'server-locked-delivery-quote',
      useBonuses: true,
      expectedBonusSpent: 250,
    );

    expect(
      requestBody?['savedPaymentMethodId'],
      '86d95454-7866-414d-a3f1-8f85cef12391',
    );
    expect(requestBody?['deliveryQuoteVersion'], 1);
    expect(requestBody?['deliveryQuoteToken'], 'server-locked-delivery-quote');
    expect(requestBody?.containsKey('deliveryFee'), false);
    expect(requestBody?['expectedBonusSpent'], 250);
    expect(requestBody?['useBonuses'], true);
  });

  testWidgets('card picker keeps selection through background refreshes', (
    tester,
  ) async {
    String? selectedMethodId;
    bool? available = true;
    late StateSetter update;
    final api = _SavedCardsApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return buildCheckoutSavedCardsPanelForTest(
                api: api,
                available: available,
                selectedMethodId: selectedMethodId,
                onDefaultResolved: (id) => update(() => selectedMethodId = id),
                onSelect: (id) => update(() => selectedMethodId = id),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(selectedMethodId, 'card-one');
    expect(find.text('•••• 1328'), findsOneWidget);
    expect(find.text('•••• 2046'), findsNothing);
    expect(api.loads, 1);

    await tester.tap(find.byKey(const ValueKey('checkout-choose-card')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('checkout-add-saved-card')),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey('checkout-saved-card-card-two')),
    );
    await tester.pumpAndSettle();
    expect(selectedMethodId, 'card-two');
    expect(find.text('•••• 2046'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('checkout-close-card-picker')),
      findsNothing,
    );
    for (var i = 0; i < 4; i++) {
      update(() => available = null);
      await tester.pump();
      expect(find.text('•••• 2046'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('checkout-saved-cards-loading')),
        findsNothing,
      );
      update(() => available = true);
      await tester.pumpAndSettle();
    }
    expect(api.loads, 1);
    expect(selectedMethodId, 'card-two');
    update(() => available = false);
    await tester.pumpAndSettle();
    expect(selectedMethodId, isNull);
    expect(find.text('•••• 2046'), findsNothing);
    expect(
      find.byKey(const ValueKey('checkout-saved-cards-unavailable')),
      findsOneWidget,
    );
  });

  testWidgets(
    'bonuses remain optional and unavailable balance cannot be spent',
    (tester) async {
      bool enabled = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => buildCheckoutBonusSwitchForTest(
                enabled: enabled,
                available: 1200,
                maximum: 895,
                busy: false,
                onChanged: (value) => setState(() => enabled = value),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('checkout-use-bonuses')));
      await tester.pumpAndSettle();
      expect(enabled, true);
      await tester.tap(find.byKey(const ValueKey('checkout-use-bonuses')));
      await tester.pumpAndSettle();
      expect(enabled, false);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: buildCheckoutBonusSwitchForTest(
              enabled: false,
              available: 0,
              maximum: 0,
              busy: false,
              onChanged: (_) => fail('Zero balance must disable redemption'),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('checkout-use-bonuses')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}

class _SavedCardsApi extends BulkaApiClient {
  int loads = 0;
  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async {
    loads++;
    return [
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
}
