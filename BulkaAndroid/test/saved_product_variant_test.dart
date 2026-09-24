import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const product = CatalogProduct(
  id: 'bun',
  title: 'Булочка',
  price: 300,
  category: 'Выпечка',
  imageUrl: '',
  inStockCount: 10,
  preparationMinutes: 10,
);

class VariantApi extends BulkaApiClient {
  bool failQuote = false;
  String? quotedBranch;
  Map<String, dynamic>? savedConfiguration;
  List<Map<String, dynamic>>? savedModifiers;
  @override
  bool get isAuthenticated => true;
  @override
  Future<void> recordProductView(String productId) async {}
  @override
  Future<List<String>> getBoughtTogetherProductIds(
    String productId, {
    String? branchId,
    bool Function()? isActive,
  }) async => const [];
  @override
  Future<Map<String, dynamic>> getProductOptions(
    String productId, {
    bool forceRefresh = false,
  }) async => {
    'configuration': {'enabled': false},
    'modifierGroups': [
      {
        'id': 'pack',
        'title': {'ru': 'Упаковка'},
        'minSelected': 0,
        'options': [
          {
            'id': 'box',
            'title': {'ru': 'Коробка'},
            'priceDelta': 50,
          },
        ],
      },
    ],
  };
  @override
  Future<List<Map<String, dynamic>>> getSavedVariants(String productId) async =>
      [
        {
          'id': '11111111-1111-4111-8111-111111111111',
          'name': 'Булочка в коробке',
          'productId': 'bun',
          'configuration': {},
          'modifiers': [
            {
              'groupId': 'pack',
              'optionIds': ['box'],
            },
          ],
        },
      ];
  @override
  Future<Map<String, dynamic>> saveVariant({
    required String productId,
    required String name,
    required String branchId,
    required String orderType,
    required Map<String, dynamic> configuration,
    required List<Map<String, dynamic>> modifiers,
  }) async {
    savedConfiguration = configuration;
    savedModifiers = modifiers;
    return {'id': 'new', 'productId': productId, 'name': name};
  }

  @override
  Future<Map<String, dynamic>> quoteSavedVariant({
    required String id,
    required String branchId,
    required String orderType,
    required num quantity,
  }) async {
    quotedBranch = branchId;
    if (failQuote) throw ApiException('Вариант больше недоступен');
    return {
      'id': 'bun',
      'name': 'Булочка',
      'basePrice': 300,
      'price': 350,
      'configuration': {},
      'modifiers': [
        {
          'groupId': 'pack',
          'optionIds': ['box'],
        },
      ],
    };
  }
}

void main() {
  for (final available in [true, false]) {
    testWidgets(
      'saved version ${available ? 'rechecks current price' : 'keeps cart if unavailable'}',
      (tester) async {
        appLanguageNotifier.value = 'ru';
        SharedPreferences.setMockInitialValues({});
        final api = VariantApi()..failQuote = !available;
        final cart = CartProvider();
        await cart.restored;
        final live = ValueNotifier<Map<String, CatalogProduct>>({
          'bun': product,
        });
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: MaterialApp(
              theme: buildBulkaTheme(),
              home: ProductDetailsScreen(
                api: api,
                product: product,
                liveProducts: live,
                initialQuantity: 0,
                onQuantityChanged: (product, quantity) {},
                branchId: '22222222-2222-4222-8222-222222222222',
                orderType: 'pickup',
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final button = find.byKey(
          const ValueKey('variant-add-11111111-1111-4111-8111-111111111111'),
        );
        expect(button, findsOneWidget);
        await tester.ensureVisible(button);
        await tester.tap(button);
        await tester.pumpAndSettle();
        expect(api.quotedBranch, '22222222-2222-4222-8222-222222222222');
        expect(cart.getQuantity('bun'), available ? 1 : 0);
        if (available) expect(cart.items.values.single.price, 350);
        await tester.pumpWidget(const SizedBox.shrink());
        live.dispose();
      },
    );
  }
  testWidgets('selected modifier can be saved with a name', (tester) async {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    final api = VariantApi();
    final cart = CartProvider();
    await cart.restored;
    final live = ValueNotifier<Map<String, CatalogProduct>>({'bun': product});
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: ProductDetailsScreen(
            api: api,
            product: product,
            liveProducts: live,
            initialQuantity: 0,
            onQuantityChanged: (product, quantity) {},
            branchId: '22222222-2222-4222-8222-222222222222',
            orderType: 'pickup',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final choice = find.text('Коробка');
    await tester.ensureVisible(choice);
    await tester.tap(choice);
    await tester.pumpAndSettle();
    final save = find.byKey(const ValueKey('save-product-variant'));
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('variant-name-input')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('variant-confirm-save')));
    await tester.pumpAndSettle();
    expect(api.savedModifiers?.single['optionIds'], ['box']);
    expect(cart.getQuantity('bun'), 0);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    live.dispose();
  });
}
