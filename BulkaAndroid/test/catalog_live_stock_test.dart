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

class StockCatalogApi extends BulkaApiClient {
  StockCatalogApi(http.Client client) : super(client: client);
  final events = StreamController<Map<String, dynamic>>.broadcast();
  Completer<void>? locationsGate;
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    await locationsGate?.future;
    return [
      BakeryLocation(
        id: 'branch',
        name: 'Филиал',
        city: 'Актау',
        address: 'Адрес',
      ),
    ];
  }
}

void main() {
  for (final manualNavigation in [false, true]) {
    testWidgets(
      'an open product survives refresh after manual navigation: $manualNavigation',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'selected_bakery_location_id_pickup': 'branch',
          'selected_bakery_location_pickup': 'Филиал',
        });
        appLanguageNotifier.value = 'ru';
        var image = 'https://example.com/old.jpg';
        var reads = 0;
        final client = MockClient((request) async {
          if (request.url.path == '/api/guest/menu') {
            reads++;
            return http.Response(
              jsonEncode({
                'iikoProfile': 'default',
                'categories': [
                  {'id': 'buns', 'name': 'Булочки'},
                ],
                'products': [
                  {
                    'id': 'bun',
                    'name': 'Плюшка',
                    'price': 300,
                    'categoryId': 'buns',
                    'imageUrl': image,
                    'description': image.endsWith('new.jpg')
                        ? 'Новый состав'
                        : 'Состав',
                    'onlineOrderable': false,
                    'inStopList': true,
                  },
                ],
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          return http.Response(
            '{"success":true,"ready":true,"productIds":[]}',
            200,
          );
        });
        final api = StockCatalogApi(client);
        final cart = CartProvider();
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: MaterialApp(
              theme: buildBulkaTheme(),
              home: CatalogScreen(
                api: api,
                hasSelectedOrderType: true,
                initialClientUri: Uri.parse(
                  manualNavigation ? '/catalog' : '/catalog/product/bun',
                ),
              ),
            ),
          ),
        );
        for (var frame = 0; frame < 12; frame++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        if (manualNavigation) {
          await tester.tap(find.text('Булочки').first);
          await tester.pump();
          await tester.pump(const Duration(seconds: 1));
          await tester.tap(find.text('Плюшка').first);
          await tester.pump();
          await tester.pump(const Duration(seconds: 1));
        }
        expect(find.byType(ProductDetailsScreen), findsOneWidget);
        final baseline = reads;
        image = 'https://example.com/new.jpg';
        Future<void> notify(String profile) async {
          api.events.add({
            'type': 'client.data.changed',
            'data': {
              'domains': ['menu'],
              'profileKey': profile,
            },
          });
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 300));
          for (var frame = 0; frame < 12; frame++) {
            await tester.pump(const Duration(milliseconds: 100));
          }
        }

        await notify('astana');
        expect(reads, baseline);
        await notify('default');
        expect(reads, greaterThan(baseline));
        final details = tester.widget<ProductDetailsScreen>(
          find.byType(ProductDetailsScreen),
        );
        expect(details.liveProducts.value['bun']!.imageUrl, image);
        expect(find.text('Новый состав'), findsOneWidget);
        if (manualNavigation) {
          await tester.tap(find.byKey(const ValueKey('product-close')));
          for (var frame = 0; frame < 12; frame++) {
            await tester.pump(const Duration(milliseconds: 100));
          }
          expect(
            find.byKey(const ValueKey('catalog-category-page-Булочки')),
            findsOneWidget,
          );
        }
        await tester.pumpWidget(const SizedBox.shrink());
        await api.events.close();
        client.close();
        cart.dispose();
      },
    );
  }
  testWidgets('inventory events refresh the authoritative menu', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({
      'selected_bakery_location_id_pickup': 'branch',
      'selected_bakery_location_pickup': 'Филиал',
    });
    appLanguageNotifier.value = 'ru';
    var quantity = 0;
    var stopped = false;
    var menuReads = 0;
    var obsoleteStockReads = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/api/public/menu-stock') {
        obsoleteStockReads++;
        return http.Response('Not found', 404);
      }
      if (request.url.path == '/api/guest/menu') {
        menuReads++;
        return http.Response(
          jsonEncode({
            'success': true,
            'iikoProfile': 'default',
            'categories': [
              {'id': 'buns', 'name': 'Булочки'},
            ],
            'products': [
              {
                'id': 'bun',
                'name': 'Плюшка',
                'categoryId': 'buns',
                'price': 300,
                'availableQuantity': quantity,
                'onlineOrderable': quantity > 0 && !stopped,
                'inStopList': quantity <= 0 || stopped,
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      return http.Response(
        '{"success":true,"ready":true,"productIds":[]}',
        200,
      );
    });
    final api = StockCatalogApi(client);
    final cart = CartProvider();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: CatalogScreen(api: api, hasSelectedOrderType: true),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('catalog-category-card-Булочки')),
    );
    await tester.pumpAndSettle();
    expect(find.byType(CatalogStockBadge), findsNothing);
    final baseline = menuReads;

    Future<void> inventoryEvent(String branch) async {
      api.events.add({
        'type': 'client.data.changed',
        'data': {
          'domains': ['menu'],
          'inventory': true,
          'branchId': branch,
        },
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
    }

    quantity = 5;
    await inventoryEvent('different-branch');
    expect(menuReads, baseline);
    await inventoryEvent('branch');
    expect(menuReads, greaterThan(baseline));
    expect(obsoleteStockReads, 0);
    expect(
      tester.widget<CatalogStockBadge>(find.byType(CatalogStockBadge)).quantity,
      5,
    );

    stopped = true;
    await inventoryEvent('branch');
    expect(find.text('Нет в наличии'), findsWidgets);
    expect(obsoleteStockReads, 0);

    await tester.pumpWidget(const SizedBox.shrink());
    await api.events.close();
    api.dispose();
    cart.dispose();
    client.close();
  });
}
