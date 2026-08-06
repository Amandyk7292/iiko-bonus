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
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('catalog search stays pinned while category cards scroll', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = MockClient((request) async {
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
      const ValueKey('catalog-category-card-Категория 0'),
    );
    final search = find.byKey(const ValueKey('catalog-sticky-search'));
    final scrollView = find.byType(CustomScrollView);
    expect(firstCategory, findsOneWidget);
    expect(search, findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-category-strip')), findsNothing);

    await tester.drag(scrollView, const Offset(0, -700));
    await tester.pumpAndSettle();
    final firstSearchY = tester.getCenter(search).dy;

    await tester.drag(scrollView, const Offset(0, -500));
    await tester.pumpAndSettle();
    final secondSearchY = tester.getCenter(search).dy;

    expect(secondSearchY, moreOrLessEquals(firstSearchY, epsilon: 0.5));
    expect(firstSearchY, lessThan(150));

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('catalog renders category cards and opens category products', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = MockClient((request) async {
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

    final bunsCard = find.byKey(
      const ValueKey('catalog-category-card-Булочки'),
    );
    final drinksCard = find.byKey(
      const ValueKey('catalog-category-card-Напитки'),
    );
    expect(bunsCard, findsOneWidget);
    expect(drinksCard, findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-results-filter')), findsNothing);
    expect(find.byKey(const ValueKey('catalog-category-filter')), findsNothing);
    expect(find.byTooltip('Фильтры'), findsNothing);
    expect(
      find.byKey(const ValueKey('catalog-category-fallback-Напитки')),
      findsOneWidget,
    );
    final categoryTitle = tester.widget<Text>(
      find.byKey(const ValueKey('catalog-category-title-Булочки')),
    );
    expect(categoryTitle.style?.fontFamily, 'Montserrat');
    expect(find.text('1 товаров'), findsNothing);

    final fallbackSurface = tester.widget<ColoredBox>(
      find
          .descendant(
            of: find.byKey(const ValueKey('catalog-category-fallback-Напитки')),
            matching: find.byType(ColoredBox),
          )
          .first,
    );
    expect(fallbackSurface.color, Colors.white);

    final searchField = tester.widget<TextField>(
      find.byKey(const ValueKey('catalog-sticky-search')),
    );
    expect(searchField.autofillHints, isEmpty);
    expect(searchField.autocorrect, isFalse);
    expect(searchField.enableSuggestions, isFalse);

    await tester.enterText(
      find.byKey(const ValueKey('catalog-sticky-search')),
      'плю',
    );
    await tester.pumpAndSettle();
    expect(find.text('Результаты поиска'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('catalog-results-filter')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('catalog-fulfillment-banner-pickup')),
      findsNothing,
    );
    expect(find.byType(ActionChip), findsWidgets);
    expect(
      tester
          .widgetList<ActionChip>(find.byType(ActionChip))
          .every((chip) => chip.avatar == null),
      isTrue,
    );
    expect(find.text('1 товаров'), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('catalog-sticky-search')),
      '',
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('catalog-category-grid')), findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-results-filter')), findsNothing);
    final cardSize = tester.getSize(bunsCard);
    expect(cardSize.width, moreOrLessEquals(cardSize.height));

    await tester.ensureVisible(bunsCard);
    await tester.tap(bunsCard);
    await tester.pumpAndSettle();

    final categoryPage = find.byKey(
      const ValueKey('catalog-category-page-Булочки'),
    );
    expect(categoryPage, findsOneWidget);
    expect(tester.widget<Scaffold>(categoryPage).backgroundColor, Colors.white);
    final categoryAppBar = find.descendant(
      of: categoryPage,
      matching: find.byType(AppBar),
    );
    expect(tester.widget<AppBar>(categoryAppBar).backgroundColor, Colors.white);
    expect(
      find.byKey(const ValueKey('catalog-category-list-Булочки')),
      findsOneWidget,
    );
    expect(find.text('Плюшка'), findsOneWidget);
    expect(find.text('Слойка'), findsOneWidget);
    expect(find.text('Булочки'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('catalog-category-filter')),
      findsOneWidget,
    );
    final productPrice = tester.widget<Text>(find.text('500 ₸'));
    expect(productPrice.style?.fontFamily, 'Montserrat');
    expect(productPrice.style?.fontWeight, FontWeight.w700);
    expect(find.bySemanticsLabel('Добавить в избранное'), findsNWidgets(2));
    await tester.tap(find.byKey(const ValueKey('catalog-favorite-bun-1')));
    await tester.pump();
    expect(find.bySemanticsLabel('Удалить из избранного'), findsOneWidget);
    expect(find.text('Капучино'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('catalog-category-filter')));
    await tester.pumpAndSettle();
    expect(find.text('Сортировка'), findsOneWidget);
    expect(find.text('Наличие'), findsNothing);
    expect(find.text('Только в наличии'), findsNothing);
    await tester.tap(find.text('Применить'));
    await tester.pumpAndSettle();

    expect(find.text('Плюшка'), findsOneWidget);
    expect(find.text('Слойка'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('catalog-category-filter')),
      findsOneWidget,
    );
  });

  testWidgets('adding without an order type opens the required prompt', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var homeRequests = 0;

    final client = MockClient((request) async {
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
      const ValueKey('catalog-category-card-Булочки'),
    );
    await tester.ensureVisible(categoryCard);
    await tester.tap(categoryCard);
    await tester.pumpAndSettle();

    final addButton = find.byKey(const ValueKey('catalog-image-add')).first;
    await tester.ensureVisible(addButton);
    await tester.tap(addButton);
    await tester.pumpAndSettle();

    expect(
      find.text('Сначала выберите, пожалуйста, тип заказа'),
      findsOneWidget,
    );
    expect(find.text('ОК'), findsOneWidget);
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

  testWidgets('catalog shows category skeletons while the menu is loading', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final menuResponse = Completer<http.Response>();

    final client = MockClient((request) async {
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
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('catalog-skeleton-categories')),
      findsOneWidget,
    );
    final loadingCardSize = tester.getSize(
      find.byKey(const ValueKey('catalog-skeleton-category-0')),
    );

    menuResponse.complete(_menuResponse('pickup'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('catalog-skeleton-categories')),
      findsNothing,
    );
    final loadedCardSize = tester.getSize(
      find.byKey(const ValueKey('catalog-category-card-Булочки')),
    );
    expect(loadingCardSize.width, closeTo(loadedCardSize.width, 0.01));
    expect(loadingCardSize.height, closeTo(loadedCardSize.height, 0.01));
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
    });

    final client = MockClient((request) async {
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
      const ValueKey('catalog-category-card-Булочки'),
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
    final pickupResponse = Completer<http.Response>();
    final requestedTypes = <String>[];
    final client = MockClient((request) async {
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
      const ValueKey('catalog-category-card-Булочки'),
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
