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
      'selected_bakery_location_id_pickup': 'branch-preview',
      'selected_bakery_location_pickup': 'Пекарня',
    });
  });

  for (final details in [false, true]) {
    testWidgets('guest add asks for sign-in (details: $details)', (
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
        if (request.url.path.endsWith('/api/public/product-options')) {
          return http.Response(
            jsonEncode({
              'products': {
                'bun': {'configuration': null, 'modifierGroups': []},
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        final body = request.url.path.endsWith('/api/guest/menu')
            ? {
                'success': true,
                'categories': [
                  {'id': 'buns', 'name': 'Булочки'},
                ],
                'products': [
                  {
                    'id': 'bun',
                    'categoryId': 'buns',
                    'name': 'Плюшка',
                    'price': 500,
                    'onlineOrderable': true,
                  },
                ],
              }
            : {'success': true, 'productIds': []};
        return http.Response(
          jsonEncode(body),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      addTearDown(client.close);
      final api = BulkaApiClient(client: client);
      final cart = CartProvider();
      await cart.restored;
      var prompts = 0;
      var allowLogin = false;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: CatalogScreen(
              api: api,
              hasSelectedOrderType: true,
              initialClientUri: details
                  ? Uri.parse('/catalog/product/bun')
                  : null,
              onRequireAuth: () async {
                prompts++;
                if (allowLogin) {
                  api.setSession(accessToken: 'fixture-token');
                }
                return allowLogin;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final add = find
          .byKey(const ValueKey('catalog-image-add'))
          .hitTestable()
          .last;
      expect(add, findsOneWidget);
      await tester.tap(add);
      await tester.pumpAndSettle();
      expect(prompts, 1);
      expect(cart.getQuantity('bun'), 0);
      allowLogin = true;
      await tester.tap(add);
      await tester.pumpAndSettle();
      expect(prompts, 2);
      expect(cart.getQuantity('bun'), 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      cart.dispose();
    });
  }
}
