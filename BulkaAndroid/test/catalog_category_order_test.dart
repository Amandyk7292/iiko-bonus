import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

CatalogProduct product(String id, String category, {bool stopped = false}) =>
    CatalogProduct(
      id: id,
      title: id,
      price: 100,
      category: category,
      imageUrl: '',
      inStockCount: stopped ? 0 : 1,
      preparationMinutes: 10,
      isStopListed: stopped,
    );

void main() {
  test('uses the configured menu order for category sections', () {
    final categories = catalogCategoriesAvailableFirst(
      [
        MapEntry('Десерты', [product('cake', 'Десерты', stopped: true)]),
        MapEntry('Круассаны', [product('croissant', 'Круассаны')]),
        MapEntry('Булочки', [product('bun', 'Булочки')]),
      ],
      categoryOrder: ['Булочки', 'Десерты', 'Круассаны'],
    );

    expect(categories.map((entry) => entry.key), [
      'Булочки',
      'Десерты',
      'Круассаны',
    ]);
  });

  test(
    'categories with available products come first and stay alphabetical',
    () {
      final categories = catalogCategoriesAvailableFirst([
        MapEntry('Десерты', [product('cake', 'Десерты', stopped: true)]),
        MapEntry('Круассаны', [product('croissant', 'Круассаны')]),
        MapEntry('Булочки', [product('bun', 'Булочки')]),
        MapEntry('Блины', [product('pancake', 'Блины', stopped: true)]),
      ]);

      expect(categories.map((entry) => entry.key), [
        'Булочки',
        'Круассаны',
        'Блины',
        'Десерты',
      ]);
    },
  );
}
