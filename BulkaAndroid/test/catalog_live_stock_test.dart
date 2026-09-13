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
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    BakeryLocation(
      id: 'branch',
      name: 'Филиал',
      city: 'Актау',
      address: 'Адрес',
    ),
  ];
}

void main() {
  for (final legacyMenu in [false, true]) {
    testWidgets(
      'offline sale updates counts without menu reload; legacy cache: $legacyMenu',
      (tester) async {
        tester.view.physicalSize = const Size(800, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        SharedPreferences.setMockInitialValues({
          'selected_bakery_location_id_pickup': 'branch',
          'selected_bakery_location_pickup': 'Филиал',
        });
        appLanguageNotifier.value = 'ru';
        var quantity = 10, menuReads = 0, stockReads = 0;
        var menuUnavailable = false;
        Completer<void>? blocked;
        final client = MockClient((request) async {
          Object payload = {'success': true};
          if (request.url.path == '/api/guest/menu') {
            menuReads++;
            if (menuUnavailable) {
              return http.Response('{"success":false}', 503);
            }
            payload = {
              'categories': [
                {'id': 'buns', 'name': 'Булочки'},
              ],
              'products': [
                {
                  'id': 'bun',
                  'name': 'Плюшка',
                  'categoryId': 'buns',
                  'price': 300,
                  'availableQuantity': 10,
                  'onlineOrderable': true,
                  if (!legacyMenu) 'catalogAvailable': true,
                },
                {
                  'id': 'stopped',
                  'name': 'Временно убрана',
                  'categoryId': 'buns',
                  'price': 400,
                  'availableQuantity': 10,
                  'inStopList': true,
                  if (!legacyMenu) 'catalogAvailable': false,
                },
              ],
            };
          }
          if (request.url.path == '/api/public/menu-stock') {
            stockReads++;
            final captured = quantity;
            await blocked?.future;
            payload = {
              'success': true,
              'branchId': 'branch',
              'orderType': 'pickup',
              'enabled': true,
              'products': [
                for (final id in ['bun', 'stopped'])
                  {
                    'id': id,
                    'availableQuantity': captured,
                    'isAvailable': captured > 0,
                    'quantityStep': 1,
                    'unit': 'шт.',
                  },
              ],
            };
          }
          return http.Response(
            jsonEncode(payload),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
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
        final baselineReads = menuReads;
        menuUnavailable = true;
        expect(find.byType(CatalogStockBadge), findsOneWidget);
        expect(
          tester
              .widget<CatalogStockBadge>(find.byType(CatalogStockBadge))
              .quantity,
          10,
        );
        Future<void> change(String branch) async {
          api.events.add({
            'type': 'client.data.changed',
            'data': {
              'domains': ['menu'],
              'inventory': true,
              'branchId': branch,
            },
          });
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 300));
        }

        quantity = 5;
        await change('another-branch');
        expect(stockReads, 0);
        await change('branch');
        await tester.pumpAndSettle();
        expect(menuReads, baselineReads);
        expect(
          tester
              .widget<CatalogStockBadge>(find.byType(CatalogStockBadge))
              .quantity,
          5,
        );
        expect(
          find.byType(CatalogStockBadge),
          findsOneWidget,
          reason: 'global stop must not be cleared by a stock refresh',
        );
        // A second sale while the first stock request is pending must run again.
        blocked = Completer<void>();
        quantity = 3;
        await change('branch');
        quantity = 2;
        await change('branch');
        final pending = blocked;
        blocked = null;
        pending.complete();
        await tester.pumpAndSettle();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<CatalogStockBadge>(find.byType(CatalogStockBadge))
              .quantity,
          2,
        );
        quantity = 0;
        await change('branch');
        await tester.pumpAndSettle();
        expect(find.byType(CatalogStockBadge), findsNothing);
        expect(menuReads, baselineReads);
        expect(tester.takeException(), isNull);
        // Continuous events must not keep postponing the refresh indefinitely.
        final readsBeforeBurst = stockReads;
        quantity = 5;
        for (var i = 0; i < 8; i++) {
          api.events.add({
            'type': 'client.data.changed',
            'data': {
              'domains': ['menu'],
              'inventory': true,
              'branchId': 'branch',
            },
          });
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(stockReads, greaterThan(readsBeforeBurst));
        await tester.pumpAndSettle();
        expect(menuReads, baselineReads);
        expect(
          find.byType(CatalogStockBadge),
          legacyMenu ? findsNothing : findsOneWidget,
          reason: 'unknown global availability cannot clear an existing stop',
        );
        await tester.pumpWidget(const SizedBox());
        await api.events.close();
        api.dispose();
        cart.dispose();
        client.close();
      },
    );
  }
}
