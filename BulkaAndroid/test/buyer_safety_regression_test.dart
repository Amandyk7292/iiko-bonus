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
