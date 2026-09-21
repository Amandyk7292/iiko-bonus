import 'helpers/selected_bakery_locations.dart';
import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({
      'selected_bakery_location_id_pickup': 'branch-preview',
      'selected_bakery_location_pickup': 'Предыдущая пекарня',
    });
  });

  testWidgets('popular product link opens its details without a bakery', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 44, bottom: 34);
    tester.view.viewPadding = const FakeViewPadding(top: 44, bottom: 34);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    addTearDown(tester.view.resetViewPadding);
    SharedPreferences.setMockInitialValues({});
    final client = MockClient(
      (request) async => request.url.path.endsWith('/api/guest/locations')
          ? selectedBakeryLocationsResponse()
          : _response(
              request.url.path.endsWith('/api/guest/menu')
                  ? _menu()
                  : {'success': true},
            ),
    );
    addTearDown(client.close);
    final cart = CartProvider();
    await cart.restored;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme().copyWith(platform: TargetPlatform.windows),
          home: CatalogScreen(
            api: BulkaApiClient(client: client),
            initialClientUri: productClientUri('bun-1'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsOneWidget);
    expect(
      tester
          .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
          .product
          .id,
      'bun-1',
    );
    expect(tester.takeException(), isNull);
    expect(
      tester.getTopLeft(find.byKey(const ValueKey('product-photo-area'))).dy,
      0,
    );
    expect(
      tester.getTopLeft(find.byKey(const ValueKey('product-close'))).dy,
      greaterThanOrEqualTo(44),
    );
    expect(
      find.descendant(
        of: find.byType(ProductDetailsScreen),
        matching: find.byType(Scrollbar),
      ),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('catalog-image-add')).hitTestable(),
      findsOneWidget,
    );
    expect(
      tester
          .getBottomRight(
            find.byKey(const ValueKey('catalog-image-add')).hitTestable(),
          )
          .dy,
      greaterThan(750),
    );
    await tester.pumpWidget(const SizedBox.shrink());
    cart.dispose();
  });

  testWidgets(
    'bought together filters unavailable products and opens the selected product',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/api/guest/locations')) {
          return selectedBakeryLocationsResponse();
        }
        if (request.url.path.endsWith('/api/guest/menu')) {
          final menu = _menu();
          menu['products'] = <dynamic>[
            ...(menu['products'] as List),
            {
              'id': 'coffee',
              'categoryId': 'buns',
              'name': 'Кофе',
              'price': 600,
              'imageUrl': '',
              'onlineOrderable': true,
            },
            {
              'id': 'unavailable',
              'categoryId': 'buns',
              'name': 'Нет в наличии',
              'price': 300,
              'imageUrl': '',
              'onlineOrderable': false,
            },
          ];
          return _response(menu);
        }
        if (request.url.path.endsWith('/bun-1/bought-together')) {
          return _response({
            'success': true,
            'productIds': [
              'bun-1',
              'coffee',
              'coffee',
              'unavailable',
              'missing',
            ],
          });
        }
        return _response({'success': true});
      });
      addTearDown(client.close);
      final cart = CartProvider();
      await cart.restored;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: CatalogScreen(
              api: BulkaApiClient(client: client),
              initialClientUri: productClientUri('bun-1'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final details = tester.widget<ProductDetailsScreen>(
        find.byType(ProductDetailsScreen),
      );
      expect(details.liveProducts.value.containsKey('coffee'), isTrue);
      expect(details.liveProducts.value['coffee']!.isStopListed, isFalse);
      expect(find.text('С этим часто покупают'), findsOneWidget);
      final coffee = find.byKey(const ValueKey('cart-popular-product-coffee'));
      expect(coffee, findsOneWidget);
      expect(
        find.byKey(const ValueKey('cart-popular-product-bun-1')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('cart-popular-product-unavailable')),
        findsNothing,
      );
      await tester.ensureVisible(coffee);
      await tester.tap(coffee);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
            .product
            .id,
        'coffee',
      );
      expect(
        find.byKey(const ValueKey('product-bought-together')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      cart.dispose();
    },
  );

  for (final openByImage in [true, false]) {
    testWidgets(
      'unavailable product details remain readable; image=$openByImage',
      (tester) async {
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/api/guest/locations')) {
            return selectedBakeryLocationsResponse();
          }
          final menu = _menu(available: false);
          (menu['products'] as List).first['ingredients'] =
              'Мука, масло, сахар';
          return _response(
            request.url.path.endsWith('/api/guest/menu')
                ? menu
                : {'success': true},
          );
        });
        addTearDown(client.close);
        final cart = CartProvider();
        await cart.restored;
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: MaterialApp(
              theme: buildBulkaTheme(),
              home: CatalogScreen(api: BulkaApiClient(client: client)),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('catalog-category-card-Булочки')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          openByImage
              ? find.byKey(const ValueKey('catalog-product-image-bun-1'))
              : find.text('Плюшка'),
        );
        await tester.pumpAndSettle();
        expect(find.byType(ProductDetailsScreen), findsOneWidget);
        expect(
          tester
              .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
              .product
              .isStopListed,
          isTrue,
        );
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(const ValueKey('catalog-image-add')),
              )
              .onPressed,
          isNull,
        );
        expect(
          find.byKey(const ValueKey('product-show-allergens')),
          findsNothing,
        );
        expect(find.text('Мука, масло, сахар'), findsNothing);
        expect(cart.items, isEmpty);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        cart.dispose();
      },
    );
  }

  for (final available in [true, false]) {
    testWidgets(
      'fulfillment choice checks fresh branch menu; available=$available',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var selected = false;
        var requests = 0;
        late StateSetter update;
        final cart = CartProvider();
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/api/guest/locations')) {
            return selectedBakeryLocationsResponse();
          }
          final isBranch =
              request.url.queryParameters['branchId'] == 'branch-1';
          return _response(
            request.url.path.endsWith('/api/guest/menu')
                ? _menu(
                    price: isBranch ? 650 : 500,
                    available: !isBranch || available,
                  )
                : {'success': true},
          );
        });
        addTearDown(client.close);
        final api = BulkaApiClient(client: client);

        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: MaterialApp(
              theme: buildBulkaTheme(),
              home: StatefulBuilder(
                builder: (context, setState) {
                  update = setState;
                  return CatalogScreen(
                    api: api,
                    hasSelectedOrderType: selected,
                    selectionRevision: selected ? 1 : 0,
                    onRequestOrderType: () => requests++,
                  );
                },
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('catalog-category-card-Булочки')),
        );
        await tester.pumpAndSettle();
        if (available) {
          await tester.tap(find.text('Плюшка'));
          await tester.pumpAndSettle();
          expect(find.byType(ProductDetailsScreen), findsOneWidget);
        }
        await tester.tap(
          find.byKey(const ValueKey('catalog-image-add')).hitTestable().last,
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('catalog-order-type-required-ok')),
        );
        await tester.pumpAndSettle();
        expect(requests, 1);
        expect(cart.itemCount, 0);

        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('selected_order_type', 'pickup');
        await prefs.setString('selected_bakery_location_id_pickup', 'branch-1');
        await prefs.setString(
          'selected_bakery_location_pickup',
          'Выбранная пекарня',
        );
        update(() => selected = true);
        await tester.pumpAndSettle();

        expect(cart.itemCount, 0);
        if (available) {
          final details = tester.widget<ProductDetailsScreen>(
            find.byType(ProductDetailsScreen),
          );
          expect(details.product.id, 'bun-1');
          expect(details.product.price, 650);
          expect(details.hasSelectedOrderType, isTrue);
          expect(
            tester
                .getSize(find.byKey(const ValueKey('product-photo-area')))
                .width,
            390,
          );
        } else {
          expect(find.byType(ProductDetailsScreen), findsNothing);
          expect(find.textContaining('Товар недоступен'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('closed product does not reopen after menu refresh', (
    tester,
  ) async {
    final client = MockClient(
      (request) async => request.url.path.endsWith('/api/guest/locations')
          ? selectedBakeryLocationsResponse()
          : _response(
              request.url.path.endsWith('/api/guest/menu')
                  ? _menu()
                  : {'success': true},
            ),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: CatalogScreen(api: BulkaApiClient(client: client)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('catalog-category-card-Булочки')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Плюшка'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('product-close')));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsNothing);
    await tester.pump(const Duration(seconds: 65));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('category and product selection survives background refresh', (
    tester,
  ) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      final menu = _menu();
      (menu['categories'] as List).add({
        'id': 'drinks',
        'name': 'Напитки',
        'imageUrl': '',
      });
      (menu['products'] as List).add({
        'id': 'coffee',
        'categoryId': 'drinks',
        'name': 'Кофе',
        'price': 700,
        'imageUrl': '',
        'onlineOrderable': true,
      });
      return _response(
        request.url.path.endsWith('/api/guest/menu') ? menu : {'success': true},
      );
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: CatalogScreen(
            api: BulkaApiClient(client: client),
            initialClientUri: Uri(path: '/catalog'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('catalog-category-card-Булочки')),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 65));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('catalog-category-back')), findsOneWidget);
    await tester.tap(find.text('Плюшка'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('product-close')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('catalog-category-back')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('catalog-category-card-Напитки')),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 65));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsNothing);
    await tester.tap(find.text('Кофе'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
          .product
          .id,
      'coffee',
    );
    await tester.pump(const Duration(seconds: 65));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
          .product
          .id,
      'coffee',
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('declining fulfillment selection keeps the open product', (
    tester,
  ) async {
    final client = MockClient(
      (request) async => request.url.path.endsWith('/api/guest/locations')
          ? selectedBakeryLocationsResponse()
          : _response(
              request.url.path.endsWith('/api/guest/menu')
                  ? _menu()
                  : {'success': true},
            ),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: CatalogScreen(api: BulkaApiClient(client: client)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('catalog-category-card-Булочки')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Плюшка'));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('catalog-image-add')).hitTestable().last,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Продолжить просмотр'));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsOneWidget);
    expect(find.text('Выбрать тип заказа'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

Map<String, dynamic> _menu({int price = 500, bool available = true}) => {
  'success': true,
  'categories': [
    {'id': 'buns', 'name': 'Булочки', 'imageUrl': ''},
  ],
  'products': [
    {
      'id': 'bun-1',
      'categoryId': 'buns',
      'name': 'Плюшка',
      'price': price,
      'imageUrl': '',
      'onlineOrderable': available,
    },
  ],
};

http.Response _response(Map<String, dynamic> body) => http.Response(
  jsonEncode(body),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
