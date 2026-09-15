import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LinkApi extends BulkaApiClient {
  LinkApi(http.Client client) : super(client: client);
  String invalid = '';
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    const BakeryLocation(id: 'a', name: 'A', city: 'Aktau', address: 'A'),
    if (invalid != 'missing')
      BakeryLocation(
        id: 'b',
        name: 'B',
        city: 'Aktau',
        address: 'B',
        active: invalid != 'inactive',
        pickupEnabled: invalid != 'unsupported',
      ),
  ];
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'pickup',
      'selected_bakery_location_id_pickup': 'a',
      'selected_bakery_location_pickup': 'A',
    });
    appLanguageNotifier.value = 'en';
  });
  http.Client menuClient(List<String?> reads) => MockClient((request) async {
    if (request.url.path == '/api/guest/menu') {
      final branch = request.url.queryParameters['branchId'];
      reads.add(branch);
      return http.Response(
        jsonEncode({
          'categories': [
            {'id': 'cakes', 'name': 'Cakes'},
          ],
          'products': [
            {
              'id': 'cake',
              'name': 'Cake',
              'categoryId': 'cakes',
              'price': branch == 'b' ? 600 : 300,
              'availableQuantity': 5,
              'onlineOrderable': true,
            },
          ],
        }),
        200,
      );
    }
    return http.Response('{"ready":true,"productIds":[]}', 200);
  });
  Widget catalog(LinkApi api, CartProvider cart) =>
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: CatalogScreen(
            api: api,
            hasSelectedOrderType: true,
            initialClientUri: Uri.parse('/catalog/product/cake?branch=b'),
          ),
        ),
      );

  for (final accept in [false, true]) {
    testWidgets('stock link preserves the existing cart, accepted=$accept', (
      tester,
    ) async {
      final reads = <String?>[];
      final api = LinkApi(menuClient(reads));
      final cart = CartProvider();
      await cart.restored;
      cart.addItem(productId: 'cake', name: 'Cake', price: 300, imageUrl: '');
      await cart.persisted;
      await tester.pumpWidget(catalog(api, cart));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(
        find.byKey(const ValueKey('catalog-link-branch-confirm')),
        findsOneWidget,
      );
      expect(
        reads,
        isEmpty,
        reason: 'Do not reprice the cart before the customer chooses',
      );
      await tester.tap(
        find.byKey(
          ValueKey(
            accept
                ? 'catalog-link-branch-confirm'
                : 'catalog-link-branch-cancel',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(cart.getQuantity('cake'), 1);
      expect(cart.totalAmount, accept ? 600 : 300);
      expect(
        (await SharedPreferences.getInstance()).getString(
          'selected_bakery_location_id_pickup',
        ),
        accept ? 'b' : 'a',
      );
      expect(reads, everyElement(accept ? 'b' : 'a'));
      expect(
        find.byType(ProductDetailsScreen),
        accept ? findsOneWidget : findsNothing,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
      cart.dispose();
    });
  }
  for (final invalid in ['missing', 'inactive', 'unsupported']) {
    testWidgets('stock link rejects $invalid bakery before changing the cart', (
      tester,
    ) async {
      final reads = <String?>[];
      final api = LinkApi(menuClient(reads))..invalid = invalid;
      final cart = CartProvider();
      await cart.restored;
      cart.addItem(productId: 'cake', name: 'Cake', price: 300, imageUrl: '');
      await tester.pumpWidget(catalog(api, cart));
      await tester.pumpAndSettle();
      expect(find.byType(ProductDetailsScreen), findsNothing);
      expect(
        find.byKey(const ValueKey('catalog-link-branch-confirm')),
        findsNothing,
      );
      expect(
        (await SharedPreferences.getInstance()).getString(
          'selected_bakery_location_id_pickup',
        ),
        'a',
      );
      expect(reads, isNot(contains('b')));
      expect(cart.getQuantity('cake'), 1);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
      cart.dispose();
    });
  }
}
