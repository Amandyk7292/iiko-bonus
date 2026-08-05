import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _LocationsApi extends BulkaApiClient {
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'astana-1',
      name: 'Bulka Astana',
      address: 'Кабанбай батыра, 46А',
      city: 'Астана',
    ),
    BakeryLocation(
      id: 'aktau-1',
      name: 'ЖК Дукат',
      address: '17-й микрорайон, 1',
      city: 'Актау',
    ),
  ];
}

class _PendingForteApi extends BulkaApiClient {
  @override
  Future<Map<String, dynamic>> checkForteCardSetupStatus(
    String operationId,
  ) async => const {'success': true, 'paymentStatus': 'pending'};
}

class _PaidReturnApi extends BulkaApiClient {
  var statusChecks = 0;

  @override
  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async {
    statusChecks++;
    return const {'success': true, 'paymentStatus': 'paid'};
  }
}

Widget _locationsHost(BulkaApiClient api) {
  return MaterialApp(
    theme: buildBulkaTheme(),
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () => Navigator.of(context).push<void>(
              MaterialPageRoute(
                builder: (_) => LocationsScreen(api: api, orderType: 'pickup'),
              ),
            ),
            child: const Text('open-locations'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  test('the same durable push message is handled only once', () async {
    SharedPreferences.setMockInitialValues({});
    const payload = {
      'pushOutboxId': '7c95a723-56e9-4c67-b106-3cb8867f0aaa',
      'type': 'bonus',
    };

    expect(await PushNotifications.claimMessage(payload), isTrue);
    expect(await PushNotifications.claimMessage(payload), isFalse);
    final preferences = await SharedPreferences.getInstance();
    expect(
      preferences.getStringList('seenPushOutboxIdsV1'),
      contains(payload['pushOutboxId']),
    );
  });

  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets(
    'first fulfillment visit asks for a city and back keeps the hierarchy',
    (tester) async {
      await tester.pumpWidget(_locationsHost(_LocationsApi()));
      await tester.tap(find.text('open-locations'));
      await tester.pumpAndSettle();

      expect(find.text('Астана'), findsOneWidget);
      expect(find.text('Актау'), findsOneWidget);
      expect(find.text('ЖК Дукат'), findsNothing);

      await tester.tap(find.text('Актау'));
      await tester.pumpAndSettle();
      expect(find.text('ЖК Дукат'), findsOneWidget);
      expect(find.text('Астана'), findsNothing);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Астана'), findsOneWidget);
      expect(find.text('Актау'), findsOneWidget);
      expect(find.text('ЖК Дукат'), findsNothing);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('open-locations'), findsOneWidget);
    },
  );

  testWidgets('an explicitly selected city restores its branch list', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      'selected_fulfillment_city_explicit_pickup': 'Актау',
      'selected_fulfillment_city_confirmed_pickup': true,
    });

    await tester.pumpWidget(_locationsHost(_LocationsApi()));
    await tester.tap(find.text('open-locations'));
    await tester.pumpAndSettle();

    expect(find.text('ЖК Дукат'), findsOneWidget);
    expect(find.text('Астана'), findsNothing);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Астана'), findsOneWidget);
    expect(find.text('Актау'), findsOneWidget);
  });

  testWidgets('legacy city value is ignored until the customer confirms it', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      'selected_fulfillment_city_explicit': 'Астана',
      'selected_fulfillment_city_explicit_pickup': 'Астана',
    });

    await tester.pumpWidget(_locationsHost(_LocationsApi()));
    await tester.tap(find.text('open-locations'));
    await tester.pumpAndSettle();

    expect(find.text('Астана'), findsOneWidget);
    expect(find.text('Актау'), findsOneWidget);
    expect(find.text('Bulka Astana'), findsNothing);
  });

  test('product share URI opens the exact supported catalog product', () {
    const product = CatalogProduct(
      id: 'bun / 17',
      title: 'Булочка',
      price: 500,
      category: 'Выпечка',
      imageUrl: '',
      inStockCount: 2,
      preparationMinutes: 10,
    );

    final uri = catalogProductShareUri(product);

    expect(uri.scheme, 'https');
    expect(uri.host, 'bulka.com.kz');
    expect(uri.pathSegments, ['catalog', 'product', 'bun / 17']);
    expect(uri.queryParameters['category'], 'Выпечка');
    expect(catalogProductShareText(product), uri.toString());
    expect(catalogProductShareText(product), isNot(contains(product.title)));
  });

  test('new buyer API contracts parse without losing typed data', () async {
    final api = BulkaApiClient(
      client: MockClient((request) async {
        if (request.url.path == '/api/customer/bonus-expiry') {
          expect(request.url.queryParameters['days'], '30');
          return http.Response(
            jsonEncode({
              'success': true,
              'summary': {
                'currentBalance': 1200,
                'totalExpiring': 300,
                'nextExpiryAt': '2026-08-15T00:00:00.000Z',
                'buckets': [
                  {
                    'expiresAt': '2026-08-15T00:00:00.000Z',
                    'amount': 300,
                    'daysRemaining': 17,
                  },
                ],
              },
            }),
            200,
          );
        }
        if (request.url.path == '/api/customer/stock-subscriptions') {
          if (request.method == 'GET') {
            return http.Response(
              jsonEncode({
                'success': true,
                'subscriptions': [
                  {
                    'id': 'stock-1',
                    'productId': 'bun',
                    'branchId': 'branch-1',
                    'status': 'active',
                    'createdAt': '2026-07-29T00:00:00.000Z',
                  },
                ],
              }),
              200,
            );
          }
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          expect(body, {'productId': 'bun', 'branchId': 'branch-1'});
          return http.Response(
            jsonEncode({
              'success': true,
              'subscription': {
                'id': 'stock-2',
                ...body,
                'status': 'active',
                'createdAt': '2026-07-29T00:00:00.000Z',
              },
            }),
            200,
          );
        }
        if (request.url.path == '/api/customer/orders/order-1/pickup-handoff') {
          return http.Response(
            jsonEncode({
              'success': true,
              'handoff': {
                'orderId': 'order-1',
                'qrPayload': 'bulka:pickup:secure-value',
                'pin': '4812',
                'expiresAt': '2026-07-29T22:00:00.000Z',
                'usedAt': null,
              },
            }),
            200,
          );
        }
        if (request.url.path == '/api/customer/gift-certificate-purchases') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          expect(body['amount'], 5000);
          expect(
            (body['recipient'] as Map<String, dynamic>)['phone'],
            '+77000000000',
          );
          return http.Response(
            jsonEncode({
              'success': true,
              'purchase': {'id': 'gift-1', 'status': 'pending'},
              'payment': {
                'provider': 'forte',
                'operationId': 'operation-1',
                'checkoutUrl': 'https://ecom.fortebank.com/flex/',
              },
            }),
            200,
          );
        }
        return http.Response(jsonEncode({'success': false}), 404);
      }),
    );

    final expiry = await api.getBonusExpiry();
    expect(expiry.totalExpiring, 300);
    expect(expiry.buckets.single.daysRemaining, 17);

    final subscriptions = await api.getStockSubscriptions();
    expect(subscriptions.single.productId, 'bun');
    final created = await api.createStockSubscription(
      productId: 'bun',
      branchId: 'branch-1',
    );
    expect(created.id, 'stock-2');

    final handoff = await api.getPickupHandoff('order-1');
    expect(handoff.pin, '4812');
    expect(handoff.isUsed, isFalse);

    final gift = await api.createGiftCertificatePurchase(
      requestId: 'gift-request-1',
      amount: 5000,
      recipientPhone: '+77000000000',
      paymentMethod: 'forte',
    );
    expect(
      (gift['payment'] as Map<String, dynamic>)['operationId'],
      'operation-1',
    );
  });

  test('gift retry accepts an already active idempotent purchase', () async {
    final api = BulkaApiClient(
      client: MockClient((request) async {
        expect(request.url.path, '/api/customer/gift-certificate-purchases');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['requestId'], '317615f9-b35f-4eb4-9f6d-777f2236bb25');
        return http.Response(
          jsonEncode({
            'success': true,
            'purchase': {
              'id': 'gift-active',
              'status': 'active',
              'amount': 5000,
              'recipient': {'phone': '+77000000000', 'registered': false},
              'deliveryMode': 'share_code',
              'giftCard': {'code': 'BLK-EXAMPLE', 'balance': 5000},
            },
            'payment': null,
          }),
          200,
        );
      }),
    );

    final result = await api.createGiftCertificatePurchase(
      requestId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
      amount: 5000,
      recipientPhone: '+77000000000',
      paymentMethod: 'forte',
    );

    expect((result['purchase'] as Map<String, dynamic>)['status'], 'active');
    expect(result['payment'], isEmpty);
  });

  test(
    'gift wallet and sender history parse as separate customer views',
    () async {
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.url.path == '/api/customer/gift-cards') {
            return http.Response(
              jsonEncode({
                'success': true,
                'cards': [
                  {
                    'id': 'card-1',
                    'purchaseId': 'purchase-1',
                    'last4': 'A1B2',
                    'balance': 5000,
                    'code': 'BLK-A1B2',
                  },
                ],
              }),
              200,
            );
          }
          if (request.url.path == '/api/customer/gift-certificate-purchases') {
            return http.Response(
              jsonEncode({
                'success': true,
                'purchases': [
                  {
                    'id': 'purchase-2',
                    'status': 'pending_payment',
                    'amount': 3000,
                  },
                ],
              }),
              200,
            );
          }
          return http.Response('{}', 404);
        }),
      );

      final received = await api.getReceivedGiftCards();
      final history = await api.getGiftCertificatePurchases();

      expect(received.single['code'], 'BLK-A1B2');
      expect(history.single['status'], 'pending_payment');
    },
  );

  test(
    'pending gift draft survives restart and keeps its request id',
    () async {
      final api = BulkaApiClient()
        ..setSession(cacheScope: 'customer-gift-test');
      final pending = PendingGiftPurchase(
        requestId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
        amount: 5000,
        recipientPhone: '+77000000000',
        recipientName: 'Алия',
        message: 'С праздником',
        paymentMethod: 'forte',
        createdAt: DateTime.utc(2026, 7, 29, 12),
        purchaseId: 'purchase-1',
      );

      await PendingGiftPurchaseStore.save(api, pending);
      final restored = await PendingGiftPurchaseStore.load(api);

      expect(restored?.requestId, pending.requestId);
      expect(restored?.purchaseId, 'purchase-1');
      expect(
        restored?.matches(
          amount: 5000,
          recipientPhone: '+77000000000',
          recipientName: 'Алия',
          message: 'С праздником',
          paymentMethod: 'forte',
        ),
        isTrue,
      );
    },
  );

  test(
    'legacy Kaspi gift draft is discarded while the provider is disabled',
    () async {
      final api = BulkaApiClient()
        ..setSession(cacheScope: 'customer-kaspi-gift-test');
      final pending = PendingGiftPurchase(
        requestId: '417615f9-b35f-4eb4-9f6d-777f2236bb25',
        amount: 5000,
        recipientPhone: '+77000000000',
        paymentMethod: 'kaspi',
        createdAt: DateTime.now(),
      );

      await PendingGiftPurchaseStore.save(api, pending);

      expect(await PendingGiftPurchaseStore.load(api), isNull);
      final preferences = await SharedPreferences.getInstance();
      expect(preferences.getString(PendingGiftPurchaseStore.key(api)), isNull);
    },
  );

  test('gift delivery and recovery messages exist in RU, KK and EN', () {
    const keys = {
      'gift_purchase_success_registered',
      'gift_purchase_success_share',
      'gift_code_hint_unregistered',
      'gift_pending_description',
      'gift_received_title',
      'gift_history_title',
    };
    for (final key in keys) {
      for (final language in AppLang.supportedCodes) {
        final text = localizedAppText(key, language: language);
        expect(text.trim(), isNotEmpty, reason: '$key:$language');
        expect(text, isNot(key), reason: '$key:$language');
      }
    }
  });

  test('registration always sends versioned legal consent', () async {
    late Map<String, dynamic> payload;
    final api = BulkaApiClient(
      client: MockClient((request) async {
        expect(request.url.path, '/api/auth/register');
        expect(request.headers['authorization'], 'Bearer registration-token');
        payload = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'success': true, 'exists': false}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    await api.registerCustomer(
      phone: '+77000000000',
      name: 'Покупатель',
      registrationToken: 'registration-token',
    );

    expect(payload['acceptedLegal'], isTrue);
    final consent = payload['legalConsent'] as Map<String, dynamic>;
    expect(consent['offerVersion'], bulkaPublicOfferVersion);
    expect(consent['privacyVersion'], bulkaPrivacyPolicyVersion);
    expect(consent['locale'], 'ru');
    expect(consent['channel'], anyOf('web', 'mobile_app'));
    expect(DateTime.tryParse(consent['acceptedAt'] as String), isNotNull);
  });

  test('API errors retain a short support code without exposing internals', () {
    final error = ApiException(
      'Не удалось выполнить действие',
      requestId: 'request-a1b2c3d4e5f6',
    );
    expect(error.supportCode, 'B2C3D4E5F6');
    expect(error.toString(), 'Не удалось выполнить действие');
  });

  test('notification targets retain exact resources and destinations', () {
    final order = resolveNotificationPayload({
      'destination': 'order',
      'orderId': 'order-17',
    });
    expect(order.kind, NotificationTargetKind.order);
    expect(order.resourceId, 'order-17');

    final support = resolveNotificationPayload({
      'type': 'support',
      'requestId': 'support-4',
    });
    expect(support.kind, NotificationTargetKind.support);
    expect(support.resourceId, 'support-4');

    expect(
      resolveNotificationPayload(const {}, fallbackType: 'abandoned_cart').kind,
      NotificationTargetKind.cart,
    );
    expect(
      resolveNotificationPayload(const {}, fallbackType: 'broadcast').kind,
      NotificationTargetKind.notifications,
    );
  });

  test('a delayed cold-start push reaches the already-mounted app', () async {
    PushNotifications.takeInitialOpenedTarget();
    final received = PushNotifications.openedTargets.first;

    await Future<void>.delayed(Duration.zero);
    PushNotifications.publishOpenedTargetForTesting({
      'destination': 'order',
      'orderId': 'cold-start-order',
    });

    final payload = await received.timeout(const Duration(seconds: 1));
    expect(payload['orderId'], 'cold-start-order');
    expect(PushNotifications.takeInitialOpenedTarget(), isNull);
  });

  test('configurable products cannot be added as an aggregate grid line', () {
    expect(
      catalogProductOptionsRequireDetails({
        'configuration': {'enabled': true, 'productKind': 'variant'},
      }),
      isTrue,
    );
    expect(
      catalogProductOptionsRequireDetails({
        'modifierGroups': [
          {'id': 'syrup'},
        ],
      }),
      isTrue,
    );
    expect(
      catalogProductOptionsRequireDetails({
        'configuration': {'enabled': false, 'productKind': 'standard'},
        'modifierGroups': const [],
      }),
      isFalse,
    );
  });

  test(
    'repeat-order cart merge and replace preserve variant identities',
    () async {
      final cart = CartProvider();
      await Future<void>.delayed(Duration.zero);
      cart.addItem(productId: 'coffee', name: 'Кофе', price: 900, imageUrl: '');
      final configured = CartItem(
        id: 'bun',
        cartKey: CartProvider.configuredCartKey('bun', {
          'size': 'large',
        }, const []),
        name: 'Булочка',
        price: 500,
        imageUrl: '',
        configuration: {'size': 'large'},
        quantity: 2,
      );

      cart.mergeItems([configured]);
      expect(cart.items, hasLength(2));
      expect(cart.getQuantity('bun'), 2);

      cart.mergeItems([configured]);
      expect(cart.getQuantity('bun'), 4);

      cart.replaceWithItems([configured]);
      expect(cart.items, hasLength(1));
      expect(cart.getQuantity('coffee'), 0);
      expect(cart.getQuantity('bun'), 2);
    },
  );

  test(
    'pending Forte operation is scoped and never stores a redirect secret',
    () async {
      final api = BulkaApiClient()..setSession(cacheScope: '+77000000000');
      await PendingForteOperationStore.save(
        api,
        operationId: 'operation-1',
        checkoutId: 'checkout-1',
      );

      final pending = await PendingForteOperationStore.load(api);
      expect(pending?.operationId, 'operation-1');
      expect(pending?.checkoutId, 'checkout-1');
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getKeys().map(prefs.getString).whereType<String>().join(' '),
        isNot(contains('password')),
      );
      expect(isTerminalForteFailure('declined'), isTrue);
      expect(isTerminalForteFailure('processing'), isFalse);
    },
  );

  testWidgets('timed-out card setup can close with a pending result', (
    tester,
  ) async {
    FortePaymentResult? result;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                result = await Navigator.of(context).push<FortePaymentResult>(
                  MaterialPageRoute(
                    builder: (_) => FortePaymentScreen(
                      api: _PendingForteApi(),
                      operationId: 'setup-operation',
                      redirectUrl: 'https://invalid.example/checkout',
                      cardSetup: true,
                      statusTimeout: Duration.zero,
                    ),
                  ),
                );
              },
              child: const Text('open-forte'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open-forte'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Закрыть'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Закрыть'));
    await tester.pumpAndSettle();

    expect(find.text('open-forte'), findsOneWidget);
    expect(result?.outcome, FortePaymentOutcome.pending);
  });

  test(
    'cold Forte return owns checkout restore and clears a paid cart',
    () async {
      SharedPreferences.setMockInitialValues({
        'lastAppScreen': 'checkout',
        'bulka_cart_v1': jsonEncode([
          {
            'id': 'bun',
            'cartKey': 'bun',
            'name': 'Булочка',
            'price': 300,
            'basePrice': 300,
            'imageUrl': '',
            'quantity': 1,
          },
        ]),
      });
      final api = _PaidReturnApi()..setSession(cacheScope: 'customer-return');
      await PendingForteOperationStore.save(
        api,
        operationId: 'paid-operation',
        checkoutId: 'checkout-return',
      );
      final prefs = await SharedPreferences.getInstance();
      final cart = CartProvider();

      await reconcileReturnedForteCheckout(api: api, cart: cart, prefs: prefs);

      expect(api.statusChecks, 1);
      expect(cart.isRestored, isTrue);
      expect(cart.items, isEmpty);
      expect(jsonDecode(prefs.getString('bulka_cart_v1')!), isEmpty);
      expect(await PendingForteOperationStore.load(api), isNull);
      expect(prefs.getString('lastAppScreen'), 'customer-orders');
    },
  );
}
