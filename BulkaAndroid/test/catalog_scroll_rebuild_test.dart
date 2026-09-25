import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'helpers/selected_bakery_locations.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({
      'selected_bakery_location_id_pickup': 'branch-one',
      'selected_bakery_location_pickup': 'Филиал',
    });
  });

  testWidgets('category scrolling keeps existing product widgets', (
    tester,
  ) async {
    await _pumpCategory(tester);
    final firstImage = _productImage(0);
    final before = tester.widget(firstImage);
    final beforeY = tester.getTopLeft(firstImage).dy;

    _categoryScrollPosition(tester).jumpTo(48);
    await tester.pump();

    expect(tester.getTopLeft(firstImage).dy, closeTo(beforeY - 48, 0.01));
    expect(
      tester.widget(firstImage),
      same(before),
      reason: 'Scrolling must lay out existing rows without rebuilding cards.',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('category rows adapt when the viewport width changes', (
    tester,
  ) async {
    await _pumpCategory(tester);
    final narrowSize = tester.getSize(_productImage(0));
    expect(narrowSize.width, closeTo((390 - 32 - 14) / 2, 0.01));
    expect(_imageTop(tester, 1), closeTo(_imageTop(tester, 0), 0.01));
    expect(_imageTop(tester, 2), greaterThan(_imageTop(tester, 0)));

    tester.view.physicalSize = const Size(700, 844);
    await tester.pumpAndSettle();

    expect(
      tester.getSize(_productImage(0)).width,
      closeTo((700 - 32 - 28) / 3, 0.01),
    );
    expect(_imageTop(tester, 2), closeTo(_imageTop(tester, 0), 0.01));
    expect(_imageTop(tester, 3), greaterThan(_imageTop(tester, 0)));

    tester.view.physicalSize = const Size(1050, 844);
    await tester.pumpAndSettle();

    expect(
      tester.getSize(_productImage(0)).width,
      closeTo((1050 - 32 - 42) / 4, 0.01),
    );
    expect(_imageTop(tester, 3), closeTo(_imageTop(tester, 0), 0.01));
    expect(_imageTop(tester, 4), greaterThan(_imageTop(tester, 0)));
    expect(tester.takeException(), isNull);
  });

  testWidgets('category cards still update after favorite and cart changes', (
    tester,
  ) async {
    final cart = await _pumpCategory(tester);
    final favorite = find.byKey(const ValueKey('catalog-favorite-bun-0'));
    expect(tester.widget<IconButton>(favorite).tooltip, 'Добавить в избранное');

    await tester.tap(favorite);
    await tester.pumpAndSettle();
    expect(
      tester.widget<IconButton>(favorite).tooltip,
      'Удалить из избранного',
    );

    cart.addItem(
      productId: 'bun-0',
      name: 'Булочка 00',
      price: 500,
      imageUrl: '',
      quantity: 2,
    );
    await tester.pumpAndSettle();

    final quantity = find.byKey(const ValueKey('catalog-quantity-bun-0'));
    expect(
      find.descendant(of: quantity, matching: find.text('2')),
      findsOneWidget,
    );
    final updatedImage = tester.widget(_productImage(0));
    _categoryScrollPosition(tester).jumpTo(48);
    await tester.pump();
    expect(tester.widget(_productImage(0)), same(updatedImage));
    expect(tester.takeException(), isNull);
  });
}

Finder _productImage(int index) =>
    find.byKey(ValueKey('catalog-product-image-bun-$index'));

double _imageTop(WidgetTester tester, int index) =>
    tester.getTopLeft(_productImage(index)).dy;

ScrollPosition _categoryScrollPosition(WidgetTester tester) => tester
    .state<ScrollableState>(
      find.descendant(
        of: find.byKey(const ValueKey('catalog-category-list-Булочки')),
        matching: find.byType(Scrollable),
      ),
    )
    .position;

Future<CartProvider> _pumpCategory(WidgetTester tester) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final client = MockClient((request) async {
    if (request.url.path == '/api/guest/locations') {
      return selectedBakeryLocationsResponse();
    }
    return http.Response(
      jsonEncode(
        request.url.path == '/api/guest/menu'
            ? {
                'success': true,
                'categories': [
                  {'id': 'buns', 'name': 'Булочки', 'imageUrl': ''},
                ],
                'products': List.generate(
                  40,
                  (index) => {
                    'id': 'bun-$index',
                    'categoryId': 'buns',
                    'name': 'Булочка ${index.toString().padLeft(2, '0')}',
                    'price': 500 + index,
                    'imageUrl': '',
                    'onlineOrderable': true,
                  },
                ),
              }
            : {'success': true},
      ),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
  final api = BulkaApiClient(client: client);
  final cart = CartProvider();
  addTearDown(() {
    api.dispose();
    cart.dispose();
  });
  addTearDown(() async => tester.pumpWidget(const SizedBox.shrink()));
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: ChangeNotifierProvider.value(
        value: cart,
        child: CatalogScreen(api: api, hasSelectedOrderType: true),
      ),
    ),
  );
  await tester.pumpAndSettle();
  final category = find.byKey(const ValueKey('catalog-category-card-Булочки'));
  await tester.ensureVisible(category);
  await tester.tap(category);
  await tester.pumpAndSettle();
  return cart;
}
