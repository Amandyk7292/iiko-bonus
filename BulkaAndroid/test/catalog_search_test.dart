import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

const products = [
  CatalogProduct(
    id: 'croissant',
    title: 'Круассан миндальный',
    price: 1800,
    category: 'Выпечка',
    imageUrl: '',
    inStockCount: 8,
    preparationMinutes: 12,
    description: 'Слоёное тесто и миндальный крем',
    ingredients: 'Мука, масло, миндаль',
    allergens: ['глютен', 'орехи'],
    dietaryTags: ['вегетарианское'],
    searchKeywords: ['завтрак', 'слойка'],
    weightGrams: 140,
    caloriesKcal: 420,
  ),
  CatalogProduct(
    id: 'pie',
    title: 'Вишнёвый пирог',
    price: 4500,
    category: 'Пироги',
    imageUrl: '',
    inStockCount: null,
    preparationMinutes: 20,
    ingredients: 'Вишня, мука, сахар',
    allergens: ['глютен'],
    dietaryTags: ['без орехов'],
    searchKeywords: ['ягоды'],
  ),
];

void main() {
  test('catalog search tolerates a realistic typo', () {
    final result = rankCatalogProducts(products, 'круасан');
    expect(result.first.id, 'croissant');
  });

  test('catalog search uses ingredients, dietary tags and synonyms', () {
    expect(rankCatalogProducts(products, 'миндаль').first.id, 'croissant');
    expect(rankCatalogProducts(products, 'ягоды').first.id, 'pie');
    expect(
      rankCatalogProducts(products, 'вегетарианское').first.id,
      'croissant',
    );
  });

  test('search suggestions return a corrected product title', () {
    expect(catalogSearchSuggestions(products, 'круасан'), [
      'Круассан миндальный',
    ]);
  });

  test('edit distance handles adjacent transposition', () {
    expect(catalogEditDistance('пирог', 'пиорг', maximum: 1), 1);
  });

  test('stop-listed products move to the end without reordering others', () {
    const stopped = CatalogProduct(
      id: 'stopped',
      title: 'Нет в наличии',
      price: 100,
      category: 'Выпечка',
      imageUrl: '',
      inStockCount: 0,
      preparationMinutes: 15,
      isStopListed: true,
    );
    final sorted = catalogProductsWithStopListLast([
      stopped,
      products[0],
      products[1],
    ]);

    expect(sorted.map((product) => product.id), [
      'croissant',
      'pie',
      'stopped',
    ]);
  });

  test('catalog products sort A-Z before stop-listed products', () {
    const stopped = CatalogProduct(
      id: 'stopped',
      title: 'Абрикосовый рулет',
      price: 100,
      category: 'Выпечка',
      imageUrl: '',
      inStockCount: 0,
      preparationMinutes: 15,
      isStopListed: true,
    );
    final sorted = catalogProductsWithStopListLast(
      catalogProductsAlphabetically([products[0], stopped, products[1]]),
    );

    expect(sorted.map((product) => product.id), [
      'pie',
      'croissant',
      'stopped',
    ]);
  });

  test('alphabetical comparison follows the Kazakh Cyrillic alphabet', () {
    final categories = ['Өнімдер', 'Булочки', 'Әзір тағам']
      ..sort(catalogAlphabeticalCompare);

    expect(categories, ['Әзір тағам', 'Булочки', 'Өнімдер']);
  });
}
