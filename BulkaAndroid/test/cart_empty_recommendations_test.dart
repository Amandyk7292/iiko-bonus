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
  testWidgets('empty cart shows clear copy and three popular products', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    var catalogOpens = 0;
    final openedProducts = <String>[];
    final client = MockClient((request) async {
      final payload = request.url.path == '/api/guest/menu'
          ? {
              'success': true,
              'products': [
                for (var index = 1; index <= 4; index++)
                  {
                    'id': 'popular-$index',
                    'name': 'Популярный товар $index',
                    'price': 100 * index,
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
    final cart = CartProvider();
    await cart.restored;

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: OrdersScreen(
            api: BulkaApiClient(client: client),
            customer: null,
            onExplore: () => catalogOpens++,
            onOpenProduct: openedProducts.add,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Корзина пока пуста'), findsOneWidget);
    expect(find.text('Ой!'), findsNothing);
    expect(find.text('Ничего не найдено!'), findsNothing);
    expect(find.byKey(const ValueKey('cart-popular-products')), findsOneWidget);
    for (var index = 1; index <= 3; index++) {
      expect(
        find.byKey(ValueKey('cart-popular-product-popular-$index')),
        findsOneWidget,
      );
    }
    expect(
      find.byKey(const ValueKey('cart-popular-product-popular-4')),
      findsNothing,
    );

    await tester.tap(
      find.byKey(const ValueKey('cart-popular-product-popular-1')),
    );
    expect(openedProducts, ['popular-1']);
    expect(catalogOpens, 0);
    await tester.tap(
      find.byKey(const ValueKey('cart-popular-product-popular-2')),
    );
    expect(openedProducts, ['popular-1', 'popular-2']);
    await tester.tap(find.text('Перейти в каталог').first);
    expect(catalogOpens, 1);
    await tester.pumpWidget(const SizedBox.shrink());
    cart.dispose();
  });
}
