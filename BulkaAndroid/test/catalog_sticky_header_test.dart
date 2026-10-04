import 'helpers/selected_bakery_locations.dart';
import 'dart:async';
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
      'selected_bakery_location_id_pickup': 'branch-one',
      'selected_bakery_location_pickup': 'Филиал',
    });
  });

  testWidgets('catalog asks for a bakery instead of showing skeletons', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 520);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({});
    var menuRequests = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      if (request.url.path.endsWith('/api/guest/menu')) menuRequests++;
      return http.Response(
        jsonEncode({'success': true}),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: Scaffold(
            extendBody: true,
            bottomNavigationBar: const SizedBox(
              height: 88,
              child: ColoredBox(color: Colors.white),
            ),
            body: CatalogScreen(api: BulkaApiClient(client: client)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('catalog-select-bakery-state')),
      findsOneWidget,
    );
    expect(find.text('Сначала выберите пекарню'), findsOneWidget);
    expect(find.text('Выбрать пекарню'), findsWidgets);
    expect(
      find.byKey(const ValueKey('catalog-skeleton-categories')),
      findsNothing,
    );
    expect(menuRequests, 0);
    expect(find.byIcon(Icons.storefront_rounded), findsNothing);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -700));
    await tester.pumpAndSettle();
    final button = find.descendant(
      of: find.byKey(const ValueKey('catalog-select-bakery-state')),
      matching: find.text('Выбрать пекарню'),
    );
    expect(button.hitTestable(), findsOneWidget);
    expect(tester.getBottomRight(button).dy, lessThanOrEqualTo(520 - 88));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('search and categories stay pinned while products scroll', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      if (request.url.path.endsWith('/api/guest/menu')) {
        expect(request.url.queryParameters['orderType'], 'pickup');
      }
      final payload = request.url.path.endsWith('/api/guest/menu')
          ? {
              'success': true,
              'categories': List.generate(
                12,
                (index) => {
                  'id': 'category-$index',
                  'name': 'Категория $index',
                  'imageUrl': '',
                },
              ),
              'products': List.generate(
                12,
                (index) => {
                  'id': 'product-$index',
                  'categoryId': 'category-$index',
                  'name': 'Товар $index',
                  'price': 500 + index,
                  'imageUrl': '',
                  'onlineOrderable': true,
                },
              ),
            }
          : {'success': true};
      return http.Response(
        jsonEncode(payload),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: CatalogScreen(api: BulkaApiClient(client: client)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final firstCategory = find.byKey(
      const ValueKey('catalog-product-image-product-0'),
    );
    final search = find.byKey(const ValueKey('catalog-sticky-search'));
    final scrollView = find.byType(CustomScrollView);
    expect(firstCategory, findsOneWidget);
    expect(search, findsOneWidget);
    expect(
      find.byKey(const ValueKey('catalog-category-strip')),
      findsOneWidget,
    );
    final categoryY = tester
        .getTopLeft(find.byKey(const ValueKey('catalog-category-strip')))
        .dy;

    await tester.drag(scrollView, const Offset(0, -700));
    await tester.pumpAndSettle();
    final firstSearchY = tester.getCenter(search).dy;

    await tester.drag(scrollView, const Offset(0, -500));
    await tester.pumpAndSettle();
    final secondSearchY = tester.getCenter(search).dy;

    expect(secondSearchY, moreOrLessEquals(firstSearchY, epsilon: 0.5));
    expect(firstSearchY, lessThan(150));
    expect(
      tester
          .getTopLeft(find.byKey(const ValueKey('catalog-category-strip')))
          .dy,
      closeTo(categoryY, 0.1),
    );

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'products open immediately and categories navigate the same page',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final client = MockClient((request) async {
        if (request.url.path.endsWith('/api/guest/locations')) {
          return selectedBakeryLocationsResponse();
        }
        final payload = request.url.path.endsWith('/api/guest/menu')
            ? {
                'success': true,
                'categories': [
                  {'id': 'buns', 'name': 'Булочки', 'imageUrl': ''},
                  {'id': 'drinks', 'name': 'Напитки', 'imageUrl': ''},
                ],
                'products': [
                  {
                    'id': 'bun-1',
                    'categoryId': 'buns',
                    'name': 'Плюшка',
                    'price': 500,
                    'imageUrl': '',
                    'onlineOrderable': true,
                  },
                  {
                    'id': 'bun-2',
                    'categoryId': 'buns',
                    'name': 'Слойка',
                    'price': 600,
                    'imageUrl': '',
                    'onlineOrderable': false,
                  },
                  {
                    'id': 'drink-1',
                    'categoryId': 'drinks',
                    'name': 'Капучино',
                    'price': 900,
                    'imageUrl': '',
                    'onlineOrderable': false,
                  },
                ],
              }
            : {'success': true};
        return http.Response(
          jsonEncode(payload),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      addTearDown(client.close);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: ChangeNotifierProvider(
            create: (_) => CartProvider(),
            child: CatalogScreen(
              api: BulkaApiClient(client: client),
              hasSelectedOrderType: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('catalog-category-grid')), findsNothing);
      expect(
        find.byKey(const ValueKey('catalog-category-strip')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('catalog-product-image-bun-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('catalog-results-filter')),
        findsOneWidget,
      );
      final search = find.byKey(const ValueKey('catalog-sticky-search'));
      final field = tester.widget<TextField>(search);
      expect(field.autofillHints, isEmpty);
      expect(field.autocorrect, isFalse);
      expect(field.enableSuggestions, isFalse);
      await tester.enterText(search, 'плю');
      await tester.pumpAndSettle();
      expect(find.text('Результаты поиска'), findsOneWidget);
      expect(find.text('Слойка'), findsNothing);
      expect(
        find.byKey(const ValueKey('catalog-fulfillment-banner-pickup')),
        findsNothing,
      );
      await tester.enterText(search, '');
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('catalog-category-chip-Булочки')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('catalog-category-page-Булочки')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('catalog-products-list')),
        findsOneWidget,
      );
      expect(find.text('Плюшка'), findsOneWidget);
      expect(find.text('Слойка'), findsOneWidget);
      final image = find.byKey(const ValueKey('catalog-product-image-bun-1'));
      expect(
        find.ancestor(of: image, matching: find.byType(RepaintBoundary)),
        findsWidgets,
      );
      final price = tester.widget<Text>(find.text('500 ₸'));
      expect(price.style?.fontFamily, 'Montserrat');
      expect(price.style?.fontWeight, FontWeight.w700);
      await tester.tap(find.byKey(const ValueKey('catalog-favorite-bun-1')));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Удалить из избранного'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('catalog-results-filter')));
      await tester.pumpAndSettle();
      expect(find.text('Сортировка'), findsOneWidget);
      expect(find.text('Наличие'), findsNothing);
      await tester.tap(find.text('Применить'));
      await tester.pumpAndSettle();
      expect(find.text('Плюшка'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('adding without an order type opens the required prompt', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var homeRequests = 0;

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      final payload = request.url.path.endsWith('/api/guest/menu')
          ? {
              'success': true,
              'categories': [
                {'id': 'buns', 'name': 'Булочки', 'imageUrl': ''},
              ],
              'products': [
                {
                  'id': 'bun-1',
                  'categoryId': 'buns',
                  'name': 'Плюшка',
                  'price': 500,
                  'imageUrl': '',
                  'onlineOrderable': true,
                },
              ],
            }
          : {'success': true};
      return http.Response(
        jsonEncode(payload),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: CatalogScreen(
            api: BulkaApiClient(client: client),
            onRequestOrderType: () => homeRequests++,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final categoryCard = find.byKey(
      const ValueKey('catalog-category-chip-Булочки'),
    );
    await tester.ensureVisible(categoryCard);
    await tester.tap(categoryCard);
    await tester.pumpAndSettle();

    final addButton = find.byKey(const ValueKey('catalog-image-add')).first;
    await tester.ensureVisible(addButton);
    await tester.tap(addButton);
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.text('Выбрать тип заказа'), findsOneWidget);
    expect(find.text('Продолжить просмотр'), findsOneWidget);
    expect(
      Provider.of<CartProvider>(
        tester.element(find.byType(CatalogScreen)),
        listen: false,
      ).itemCount,
      0,
    );

    await tester.tap(
      find.byKey(const ValueKey('catalog-order-type-required-ok')),
    );
    await tester.pumpAndSettle();
    expect(homeRequests, 1);
  });

  testWidgets('catalog shows placeholders while the menu is loading', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final menuResponse = Completer<http.Response>();

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      if (request.url.path.endsWith('/api/guest/menu')) {
        return menuResponse.future;
      }
      return http.Response(
        jsonEncode({'success': true}),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: CatalogScreen(api: BulkaApiClient(client: client)),
        ),
      ),
    );
    await tester.pump();

    expect(
      find.byKey(const ValueKey('catalog-category-skeleton-strip')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('catalog-skeleton-categories')),
      findsOneWidget,
    );
    final loadingCardSize = tester.getSize(
      find.byKey(const ValueKey('catalog-skeleton-category-0')),
    );
    final banner = find.byKey(
      const ValueKey('catalog-fulfillment-banner-pickup'),
    );
    final loadingBannerTop = tester.getTopLeft(banner).dy;

    menuResponse.complete(_menuResponse('pickup'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('catalog-skeleton-categories')),
      findsNothing,
    );
    final loadedCardSize = tester.getSize(
      find.byKey(const ValueKey('catalog-product-image-pickup-product')),
    );
    expect(loadingCardSize.width, closeTo(loadedCardSize.width, 0.01));
    expect(tester.getTopLeft(banner).dy, closeTo(loadingBannerTop, 0.01));
    expect(tester.takeException(), isNull);
  });

  testWidgets('fulfillment banner keeps a long bakery address visible', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const bakeryAddress =
        'ЖК Акеспе, 17-й микрорайон, дом 24, вход со стороны парковки';
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'pickup',
      'selected_bakery_location_pickup': bakeryAddress,
      'selected_bakery_location_id_pickup': 'branch-one',
    });

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      if (request.url.path.endsWith('/api/guest/menu')) {
        return _menuResponse('pickup');
      }
      return http.Response(
        jsonEncode({'success': true}),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: CatalogScreen(
            api: BulkaApiClient(client: client),
            orderType: 'pickup',
            hasSelectedOrderType: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('catalog-fulfillment-banner-pickup')),
      findsOneWidget,
    );
    final addressText = tester.widget<Text>(find.textContaining(bakeryAddress));
    expect(addressText.maxLines, isNull);
    expect(addressText.overflow, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('add action becomes quantity control without a floating cart', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return selectedBakeryLocationsResponse();
      }
      final payload = request.url.path.endsWith('/api/guest/menu')
          ? {
              'success': true,
              'categories': [
                {'id': 'buns', 'name': 'Булочки', 'imageUrl': ''},
              ],
              'products': [
                {
                  'id': 'bun-1',
                  'categoryId': 'buns',
                  'name': 'Плюшка',
                  'price': 500,
                  'imageUrl': '',
                  'onlineOrderable': true,
                },
              ],
            }
          : {'success': true};
      return http.Response(
        jsonEncode(payload),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: CatalogScreen(
            api: BulkaApiClient(client: client),
            hasSelectedOrderType: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final categoryCard = find.byKey(
      const ValueKey('catalog-category-chip-Булочки'),
    );
    await tester.ensureVisible(categoryCard);
    await tester.tap(categoryCard);
    await tester.pumpAndSettle();

    final addButton = find.byKey(const ValueKey('catalog-image-add')).first;
    await tester.ensureVisible(addButton);
    await tester.tap(addButton);
    await tester.pumpAndSettle();

    final quantityControl = find.byKey(const ValueKey('catalog-quantity'));
    expect(quantityControl, findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-mini-cart')), findsNothing);
    expect(
      find.descendant(of: quantityControl, matching: find.text('1')),
      findsOneWidget,
    );

    final increase = find.descendant(
      of: quantityControl,
      matching: find.byIcon(Icons.add_rounded),
    );
    await tester.tap(increase);
    await tester.pumpAndSettle();
    expect(
      find.descendant(of: quantityControl, matching: find.text('2')),
      findsOneWidget,
    );
    expect(find.text('Перейти в корзину'), findsNothing);
  });

  testWidgets('late pickup response cannot replace the delivery catalog', (
    tester,
  ) async {
    const address = DeliveryAddress(
      id: 'delivery-home',
      house: '1',
      title: 'Дом',
      location: DeliveryLocation(
        city: 'Актау',
        address: 'Адрес',
        latitude: 43.65,
        longitude: 51.16,
      ),
    );
    SharedPreferences.setMockInitialValues({
      'selected_bakery_location_id_pickup': 'branch-one',
      'selected_bakery_location_pickup': 'Филиал',
      'selected_bakery_location_id_delivery': 'branch-one',
      'selected_bakery_location_delivery': 'Филиал',
    });
    final pickupResponse = Completer<http.Response>();
    final requestedTypes = <String>[];
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/api/guest/locations')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'locations': [
              {
                'id': 'branch-one',
                'name': 'Филиал',
                'address': 'Адрес',
                'city': 'Актау',
                'deliveryEnabled': true,
                'latitude': 43.65,
                'longitude': 51.16,
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      if (!request.url.path.endsWith('/api/guest/menu')) {
        return http.Response(
          jsonEncode({'success': true}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      final orderType = request.url.queryParameters['orderType'] ?? '';
      requestedTypes.add(orderType);
      if (orderType == 'pickup') return pickupResponse.future;
      return _menuResponse(orderType);
    });
    addTearDown(client.close);
    final api = BulkaApiClient(client: client);
    await AddressRepository(api: api).saveAddress(address);

    Widget catalog(String orderType, int revision) => MaterialApp(
      theme: buildBulkaTheme(),
      home: ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: CatalogScreen(
          api: api,
          orderType: orderType,
          selectionRevision: revision,
        ),
      ),
    );

    await tester.pumpWidget(catalog('pickup', 0));
    for (
      var attempt = 0;
      attempt < 10 && !requestedTypes.contains('pickup');
      attempt++
    ) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    expect(requestedTypes, contains('pickup'));

    await tester.pumpWidget(catalog('delivery', 1));
    await tester.pumpAndSettle();
    final categoryCard = find.byKey(
      const ValueKey('catalog-category-chip-Булочки'),
    );
    await tester.ensureVisible(categoryCard);
    await tester.tap(categoryCard);
    await tester.pumpAndSettle();
    expect(find.text('Товар delivery'), findsOneWidget);

    pickupResponse.complete(_menuResponse('pickup'));
    await tester.pumpAndSettle();
    expect(find.text('Товар delivery'), findsOneWidget);
    expect(find.text('Товар pickup'), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}

http.Response _menuResponse(String orderType) => http.Response(
  jsonEncode({
    'success': true,
    'categories': [
      {'id': 'buns', 'name': 'Булочки', 'imageUrl': ''},
    ],
    'products': [
      {
        'id': '$orderType-product',
        'categoryId': 'buns',
        'name': 'Товар $orderType',
        'price': 500,
        'imageUrl': '',
        'onlineOrderable': true,
      },
    ],
  }),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
