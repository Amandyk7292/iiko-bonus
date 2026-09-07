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
        await tester.tap(find.byKey(const ValueKey('catalog-image-add')).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Выбрать тип заказа'));
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
                .height,
            160,
          );
        } else {
          expect(find.byType(ProductDetailsScreen), findsNothing);
          expect(
            find.textContaining('сейчас недоступен в этой пекарне'),
            findsOneWidget,
          );
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('declining fulfillment selection keeps the open product', (
    tester,
  ) async {
    final client = MockClient(
      (request) async => _response(
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
    await tester.tap(find.byKey(const ValueKey('catalog-image-add')));
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
