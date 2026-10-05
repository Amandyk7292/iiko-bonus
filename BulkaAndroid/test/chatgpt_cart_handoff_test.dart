import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _token = 'bc1.eyJ0ZXN0IjoxfQ.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const _branchId = '11111111-1111-4111-8111-111111111111';

Map<String, dynamic> _draft({
  int price = 300,
  bool requiresSelection = false,
}) => {
  'version': 1,
  'currency': 'KZT',
  'branch': {
    'id': _branchId,
    'name': 'Bulka',
    'city': 'Актау',
    'address': '19А',
  },
  'orderType': 'pickup',
  'expiresAt': DateTime.now()
      .add(const Duration(minutes: 30))
      .toUtc()
      .toIso8601String(),
  'requiresSelection': requiresSelection,
  'itemSubtotal': requiresSelection ? null : price * 2,
  'items': [
    {
      'id': 'bun',
      'quantity': 2,
      'price': price,
      'basePrice': price,
      'lineTotal': price * 2,
      'unit': 'шт.',
      'quantityStep': 1,
      'requiresSelection': requiresSelection,
      'product': {
        'id': 'bun',
        'name': 'Булочка',
        'price': price,
        'imageUrl': '',
        'isAvailable': true,
      },
      'configuration': null,
      'modifiers': [],
    },
  ],
};

http.Response _json(Object value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json'},
);

class _HandoffApi extends BulkaApiClient {
  _HandoffApi({required super.client});
  String pendingStatus = 'pending';
  int paymentChecks = 0;
  @override
  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async {
    paymentChecks++;
    return {'paymentStatus': pendingStatus};
  }
}

Future<CartProvider> _cart({bool existing = true}) async {
  final cart = CartProvider();
  await cart.restored;
  if (existing) {
    cart.addItem(
      productId: 'old',
      name: 'Моя корзина',
      price: 120,
      imageUrl: '',
    );
  }
  await cart.persisted;
  return cart;
}

Future<void> _showHandoff(
  WidgetTester tester, {
  required BulkaApiClient api,
  required CartProvider cart,
  ValueChanged<ChatGptCartDraft>? onImported,
  Future<void> Function(ChatGptCartDraft)? onSelectOptions,
}) async {
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: cart,
      child: MaterialApp(
        theme: buildBulkaTheme(),
        home: ChatGptCartHandoff(
          enabled: true,
          api: api,
          onImported: onImported ?? (_) {},
          onSelectOptions: onSelectOptions ?? (_) async {},
          child: const Scaffold(body: Text('Обычное приложение')),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    clientRouteNotifier.value = Uri(path: '/');
    PendingChatGptCartLink.clear();
  });
  tearDown(() {
    clientRouteNotifier.value = Uri(path: '/');
    PendingChatGptCartLink.clear();
  });

  test(
    'accepts exactly one bounded handoff token and scrubs only its query',
    () {
      final link = Uri.parse(
        'https://bulka.com.kz/cart?chatgptCart=$_token&keep=1&keep=2#review',
      );
      expect(chatGptCartTokenFromUri(link), _token);
      expect(
        chatGptCartTokenFromUri(
          Uri.parse('/cart?chatgptCart=$_token&chatgptCart=$_token'),
        ),
        isNull,
      );
      expect(
        chatGptCartTokenFromUri(Uri.parse('/cart?chatgptCart=not-a-token')),
        isNull,
      );
      expect(
        chatGptCartTokenFromUri(
          Uri(
            queryParameters: {'chatgptCart': 'bc1.${'a' * 8200}.${'a' * 43}'},
          ),
        ),
        isNull,
      );
      final clean = withoutChatGptCartToken(link);
      expect(clean.path, '/cart');
      expect(clean.queryParametersAll['keep'], ['1', '2']);
      expect(clean.fragment, 'review');
      expect(clean.toString().contains(_token), false);
      PendingChatGptCartLink.capture(link, replaceBrowserUrl: false);
      expect(clientRouteNotifier.value, clean);
      expect(PendingChatGptCartLink.take()?.token, _token);
      expect(PendingChatGptCartLink.take(), isNull);
      expect((SharedPreferences.getInstance()), completes);
    },
  );

  test(
    'resolve uses public POST and keeps token out of URL and Authorization',
    () async {
      final requests = <http.Request>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          requests.add(request);
          return _json({'success': true, 'draft': _draft()});
        }),
      );
      api.setSession(
        accessToken: 'customer-auth-token',
        cacheScope: 'family:test',
      );
      final resolved = await api.resolveChatGptCart(_token);
      expect(resolved.itemSubtotal, 600);
      expect(requests, hasLength(1));
      expect(requests.single.method, 'POST');
      expect(requests.single.url.path, '/api/public/chatgpt-cart/resolve');
      expect(requests.single.url.query, isEmpty);
      expect(
        requests.single.headers.keys.map((key) => key.toLowerCase()),
        isNot(contains('authorization')),
      );
      expect(jsonDecode(requests.single.body), {'token': _token});
      api.dispose();
    },
  );

  test(
    'fractional quantities and compact variants survive normal checkout payload',
    () async {
      final json = _draft(price: 1200);
      json['itemSubtotal'] = 1950;
      final line = (json['items'] as List).single as Map<String, dynamic>;
      line.addAll({
        'quantity': 1.5,
        'quantityStep': 0.001,
        'unit': 'кг',
        'price': 1300,
        'lineTotal': 1950,
        'configuration': {'weight': '1-5kg', 'filling': 'berry'},
        'modifiers': [
          {
            'groupId': 'topping',
            'optionIds': ['almond'],
          },
        ],
        'selectedOptions': {
          'configuration': {
            'weight': {'title': '1,5 кг'},
            'filling': {'title': 'Ягоды'},
          },
        },
      });
      final draft = ChatGptCartDraft.fromJson(json);
      final cart = await _cart(existing: false);
      final api = _HandoffApi(client: MockClient((_) async => _json({})));
      await importReviewedChatGptCart(
        api: api,
        cart: cart,
        draft: draft,
        reviewedCartRevision: cart.checkoutRevision,
      );
      final item = cart.items.values.single;
      expect(item.quantity, 1.5);
      expect(item.unit, 'кг');
      expect(item.quantityStep, 0.001);
      expect(item.price, 1300);
      expect(item.basePrice, 1200);
      expect(item.toOrderPayload(), {
        'id': 'bun',
        'quantity': 1.5,
        'configuration': {'weight': '1-5kg', 'filling': 'berry'},
        'modifiers': [
          {
            'groupId': 'topping',
            'optionIds': ['almond'],
          },
        ],
      });
      final restored = CartProvider();
      await restored.restored;
      expect(
        restored.items.values.single.toOrderPayload(),
        item.toOrderPayload(),
      );
      expect(api.paymentChecks, 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('selected_bakery_location_id_pickup'), _branchId);
      expect(
        prefs.getKeys().any((key) => '${prefs.get(key)}'.contains(_token)),
        false,
      );
      api.dispose();
      cart.dispose();
      restored.dispose();
    },
  );

  test(
    'malformed price, quantity, identity, or expired draft cannot import',
    () async {
      for (final change in [
        {'quantity': 1.5},
        {'price': -1},
        {'quantity': 100},
        {'id': 'another-product'},
        {'quantity': 0.00001, 'quantityStep': 0.000001},
        {'lineTotal': 1},
      ]) {
        final json = _draft();
        ((json['items'] as List).single as Map<String, dynamic>).addAll(change);
        expect(
          () => ChatGptCartDraft.fromJson(json),
          throwsA(isA<ApiException>()),
        );
      }
      final json = _draft()
        ..['expiresAt'] = DateTime.now()
            .subtract(const Duration(seconds: 1))
            .toIso8601String();
      final cart = await _cart();
      final api = _HandoffApi(client: MockClient((_) async => _json({})));
      await expectLater(
        importReviewedChatGptCart(
          api: api,
          cart: cart,
          draft: ChatGptCartDraft.fromJson(json),
          reviewedCartRevision: cart.checkoutRevision,
        ),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'CHATGPT_CART_EXPIRED',
          ),
        ),
      );
      expect(cart.getQuantity('old'), 1);
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets(
    'cancel preserves existing cart and never creates checkout or login',
    (tester) async {
      final paths = <String>[];
      final api = _HandoffApi(
        client: MockClient((request) async {
          paths.add(request.url.path);
          return _json({'success': true, 'draft': _draft()});
        }),
      );
      final cart = await _cart();
      clientRouteNotifier.value = Uri.parse('/cart?chatgptCart=$_token');
      await _showHandoff(tester, api: api, cart: cart);
      expect(find.text('Текущая корзина будет заменена.'), findsOneWidget);
      expect(clientRouteNotifier.value.queryParameters['chatgptCart'], isNull);
      expect(cart.getQuantity('old'), 1);
      await tester.tap(find.byKey(const ValueKey('chatgpt-cart-cancel')));
      await tester.pumpAndSettle();
      expect(cart.getQuantity('old'), 1);
      expect(paths, ['/api/public/chatgpt-cart/resolve']);
      expect(find.text('Обычное приложение'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets(
    'explicit approval rechecks live basket, persists it, then opens cart',
    (tester) async {
      final paths = <String>[];
      final api = _HandoffApi(
        client: MockClient((request) async {
          paths.add(request.url.path);
          return _json({'success': true, 'draft': _draft()});
        }),
      );
      final cart = await _cart();
      ChatGptCartDraft? imported;
      clientRouteNotifier.value = Uri.parse('/?chatgptCart=$_token');
      await _showHandoff(
        tester,
        api: api,
        cart: cart,
        onImported: (draft) => imported = draft,
      );
      expect(imported, isNull);
      await tester.tap(find.byKey(const ValueKey('chatgpt-cart-confirm')));
      await tester.pumpAndSettle();
      expect(cart.getQuantity('old'), 0);
      expect(cart.getQuantity('bun'), 2);
      expect(imported?.branch.id, _branchId);
      expect(paths, [
        '/api/public/chatgpt-cart/resolve',
        '/api/public/chatgpt-cart/resolve',
      ]);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('lastAppScreen'), 'main');
      expect(prefs.getString('selected_order_type'), 'pickup');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets(
    'price change during review keeps cart unchanged for a new review',
    (tester) async {
      var requests = 0;
      final api = _HandoffApi(
        client: MockClient(
          (_) async => _json({
            'success': true,
            'draft': _draft(price: ++requests == 1 ? 300 : 400),
          }),
        ),
      );
      final cart = await _cart();
      clientRouteNotifier.value = Uri.parse('/cart?chatgptCart=$_token');
      await _showHandoff(tester, api: api, cart: cart);
      await tester.tap(find.byKey(const ValueKey('chatgpt-cart-confirm')));
      await tester.pumpAndSettle();
      expect(cart.getQuantity('old'), 1);
      expect(cart.getQuantity('bun'), 0);
      expect(
        find.text(
          'Корзина изменилась. Откройте ссылку ещё раз и проверьте товары.',
        ),
        findsOneWidget,
      );
      expect(api.paymentChecks, 0);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets(
    'missing mandatory variants navigates to choices without replacing cart',
    (tester) async {
      final api = _HandoffApi(
        client: MockClient(
          (_) async => _json({
            'success': true,
            'draft': _draft(requiresSelection: true),
          }),
        ),
      );
      final cart = await _cart();
      ChatGptCartDraft? chosen;
      clientRouteNotifier.value = Uri.parse('/cart?chatgptCart=$_token');
      await _showHandoff(
        tester,
        api: api,
        cart: cart,
        onSelectOptions: (draft) async => chosen = draft,
      );
      expect(find.text('Выбрать варианты'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('chatgpt-cart-confirm')));
      await tester.pumpAndSettle();
      expect(chosen?.requiresSelection, true);
      expect(cart.getQuantity('old'), 1);
      expect(cart.getQuantity('bun'), 0);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets('expired or invalid links leave normal application usable', (
    tester,
  ) async {
    final api = _HandoffApi(
      client: MockClient(
        (_) async =>
            _json({'success': false, 'code': 'CHATGPT_CART_EXPIRED'}, 410),
      ),
    );
    final cart = await _cart();
    clientRouteNotifier.value = Uri.parse('/cart?chatgptCart=$_token');
    await _showHandoff(tester, api: api, cart: cart);
    expect(
      find.text('Ссылка на корзину истекла. Создайте новую в ChatGPT.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Понятно'));
    await tester.pumpAndSettle();
    expect(find.text('Обычное приложение'), findsOneWidget);
    expect(cart.getQuantity('old'), 1);
    expect(
      clientRouteNotifier.value.queryParameters.containsKey('chatgptCart'),
      false,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.dispose();
    cart.dispose();
  });

  test('pending payment and cart edits block replacement', () async {
    final cart = await _cart();
    final api = _HandoffApi(client: MockClient((_) async => _json({})));
    await PendingForteOperationStore.save(
      api,
      operationId: 'pending-payment',
      checkoutId: 'existing-checkout',
    );
    final revision = cart.checkoutRevision;
    await expectLater(
      importReviewedChatGptCart(
        api: api,
        cart: cart,
        draft: ChatGptCartDraft.fromJson(_draft()),
        reviewedCartRevision: revision,
      ),
      throwsA(isA<ApiException>()),
    );
    expect(cart.getQuantity('old'), 1);
    expect(
      (await PendingForteOperationStore.load(api))?.operationId,
      'pending-payment',
    );
    api.pendingStatus = 'paid';
    cart.addItem(productId: 'another', name: 'Новое', price: 100, imageUrl: '');
    await expectLater(
      importReviewedChatGptCart(
        api: api,
        cart: cart,
        draft: ChatGptCartDraft.fromJson(_draft()),
        reviewedCartRevision: revision,
      ),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          'CHATGPT_CART_CHANGED',
        ),
      ),
    );
    expect(cart.getQuantity('another'), 1);
    api.dispose();
    cart.dispose();
  });

  testWidgets('variant titles are localized and review fits a narrow phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final json = _draft();
    ((json['items'] as List).single
        as Map<String, dynamic>)['selectedOptions'] = {
      'configuration': {
        'weight': {
          'title': {'ru': '1,5 кг', 'kk': '1,5 кг', 'en': '1.5 kg'},
        },
        'filling': {
          'title': {'ru': 'Ягоды', 'kk': 'Жидектер', 'en': 'Berries'},
        },
      },
      'modifiers': [
        {
          'options': [
            {
              'title': {'ru': 'Коробка', 'kk': 'Қорап', 'en': 'Box'},
            },
          ],
        },
      ],
    };
    final draft = ChatGptCartDraft.fromJson(json);
    for (final language in ['ru', 'kk']) {
      appLanguageNotifier.value = language;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: Center(
              child: ChatGptCartReviewDialog(draft: draft, replacesCart: true),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          language == 'ru'
              ? '1,5 кг, Ягоды, Коробка'
              : '1,5 кг, Жидектер, Қорап',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('{ru:'), findsNothing);
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'disabled checkout restore cannot open previous checkout during review',
    (tester) async {
      SharedPreferences.setMockInitialValues({'lastAppScreen': 'checkout'});
      final cart = await _cart();
      final api = _HandoffApi(
        client: MockClient(
          (_) async =>
              _json({'success': true, 'locations': [], 'products': []}),
        ),
      );
      var authRequests = 0;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: OrdersScreen(
              api: api,
              customer: null,
              restoreCheckout: false,
              onRequireAuth: () async {
                authRequests++;
                return false;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(authRequests, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets('native shell leaves handoff links alone', (tester) async {
    var requests = 0;
    final api = _HandoffApi(
      client: MockClient((_) async {
        requests++;
        return _json({});
      }),
    );
    final cart = await _cart();
    final uri = Uri.parse('/cart?chatgptCart=$_token');
    clientRouteNotifier.value = uri;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          home: ChatGptCartHandoff(
            enabled: false,
            api: api,
            onImported: (_) {},
            onSelectOptions: (_) async {},
            child: const Scaffold(body: Text('Native app')),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(requests, 0);
    expect(clientRouteNotifier.value, uri);
    expect(find.byType(ChatGptCartReviewDialog), findsNothing);
    await tester.pumpWidget(const SizedBox());
    api.dispose();
    cart.dispose();
  });
}
