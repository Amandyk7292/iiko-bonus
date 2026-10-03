import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

CartItem item(String id, {num quantity = 1, num step = 1}) => CartItem(
  id: id,
  name: id,
  price: 100,
  imageUrl: '',
  quantity: quantity,
  quantityStep: step,
  unit: step < 1 ? 'кг' : 'шт.',
);

CartProductSnapshot product(String id, {num step = 1, String unit = 'шт.'}) =>
    CartProductSnapshot(
      id: id,
      name: id,
      price: 250,
      imageUrl: '',
      isStopListed: false,
      quantityStep: step,
      unit: unit,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final weighted in [true, false]) {
    test(
      'changing ${weighted ? 'kg to pieces' : 'pieces to kg'} requires reselecting the item',
      () async {
        final cart = CartProvider();
        await cart.restored;
        cart.addItem(
          productId: 'changed',
          name: 'Бауырсак',
          price: 1490,
          imageUrl: '',
          quantityStep: weighted ? .001 : 1,
          unit: weighted ? 'кг' : 'шт.',
          quantity: weighted ? .375 : 2,
        );
        cart.addItem(
          productId: 'unchanged',
          name: 'Хлеб',
          price: 100,
          imageUrl: '',
          quantity: 3,
        );
        cart.reconcileMenu([
          product(
            'changed',
            step: weighted ? 1 : .001,
            unit: weighted ? 'шт' : 'кг',
          ),
          product('unchanged'),
        ]);
        expect(cart.items.keys, ['unchanged']);
        expect(cart.items['unchanged']!.quantity, 3);
        await cart.persisted;
        final restored = CartProvider();
        await restored.restored;
        expect(restored.items.keys, ['unchanged']);
        restored.dispose();

        cart.addItem(
          productId: 'changed',
          name: 'Бауырсак',
          price: 250,
          imageUrl: '',
          quantityStep: weighted ? 1 : .001,
          unit: weighted ? 'шт' : 'кг',
        );
        final selected = cart.items['changed']!;
        expect(selected.quantity, weighted ? 1 : .5);
        cart.setQuantity('changed', selected.quantity + selected.increment);
        expect(selected.quantity, weighted ? 2 : 1);
        await cart.persisted;
        cart.dispose();
      },
    );
  }

  test(
    'configured item also requires reselecting when its unit changes',
    () async {
      final cart = CartProvider();
      await cart.restored;
      cart.addConfiguredItem(
        productId: 'changed',
        name: 'Бауырсак',
        basePrice: 100,
        unitPrice: 100,
        imageUrl: '',
        configuration: {'size': 'large'},
        quantity: .375,
        quantityStep: .001,
        unit: 'кг',
      );
      cart.reconcileMenu([product('changed')]);
      expect(cart.items, isEmpty);
      await cart.persisted;
      cart.dispose();
    },
  );

  test('price and cosmetic piece unit changes preserve quantity', () async {
    final cart = CartProvider();
    await cart.restored;
    cart.addItem(
      productId: 'bread',
      name: 'Хлеб',
      price: 100,
      imageUrl: '',
      quantity: 3,
    );
    cart.reconcileMenu([product('bread', unit: 'шт')]);
    expect(cart.items['bread']!.quantity, 3);
    expect(cart.items['bread']!.unit, 'шт');
    expect(cart.items['bread']!.total, 750);
    await cart.persisted;
    cart.dispose();
  });

  test(
    'restore skips fractional pieces and preserves valid weighed items',
    () async {
      SharedPreferences.setMockInitialValues({
        'bulka_cart_v1': jsonEncode([
          item('invalid-piece', quantity: .375).toJson(),
          item('valid-weight', quantity: .375, step: .001).toJson(),
          item('valid-piece', quantity: 2).toJson(),
        ]),
      });
      final cart = CartProvider();
      await cart.restored;
      expect(cart.items.keys, ['valid-weight', 'valid-piece']);
      expect(cart.items['valid-weight']!.quantity, .375);
      cart.dispose();
    },
  );

  test('reorder and edits cannot import fractional piece quantities', () async {
    final cart = CartProvider();
    await cart.restored;
    cart.replaceWithItems([
      item('invalid', quantity: 1.375),
      item('valid', quantity: 2),
    ]);
    expect(cart.items.keys, ['valid']);
    cart.mergeItems([item('invalid', quantity: .375)]);
    expect(cart.items.keys, ['valid']);
    cart.setQuantity('valid', 1.375);
    expect(cart.items['valid']!.quantity, 2);
    cart.addItem(
      productId: 'invalid-add',
      name: 'Хлеб',
      price: 100,
      imageUrl: '',
      quantity: 1.375,
    );
    cart.addConfiguredItem(
      productId: 'invalid-configured',
      name: 'Хлеб',
      basePrice: 100,
      unitPrice: 100,
      imageUrl: '',
      quantity: 1.375,
    );
    expect(cart.items.keys, ['valid']);
    await cart.persisted;
    cart.dispose();
  });
}
