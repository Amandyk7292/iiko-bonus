import 'package:flutter_test/flutter_test.dart';
import 'package:bulka_bonus/main.dart';

void main() {
  const id = '92f43875-b926-4063-8311-8b0e89c6a242';
  test('short product links retain the entire UUID and omit category', () {
    final uri = productClientUri(id);
    expect(uri.toString(), '/p/kvQ4dbkmQGODEYsOicaiQg');
    expect(productIdFromClientUri(uri), id);
    expect(uri.query, isEmpty);
    expect(uri.fragment, isEmpty);
    expect(
      productClientUri('92f43875-b926-4063-8311-8b0e89c6a243'),
      isNot(uri),
    );
  });
  test('old links and custom IDs still resolve to the same product', () {
    expect(
      productIdFromClientUri(
        Uri.parse('/catalog/product/$id?category=Блины#catalog/product/$id'),
      ),
      id,
    );
    expect(productIdFromClientUri(productClientUri('bun / 17')), 'bun / 17');
    for (final path in [
      '/p/invalid',
      '/p/**********************',
      '/p/a/b',
      '/catalog',
    ]) {
      expect(productIdFromClientUri(Uri.parse(path)), isNull);
    }
  });
  test('browser title uses only a compact product name and brand', () {
    expect(
      productPageTitle('  Плюшка   Московская '),
      'Плюшка Московская · Bulka',
    );
    expect(productPageTitle('Булочка ' * 20).length, lessThanOrEqualTo(48));
    expect(productPageTitle(''), 'Bulka');
  });
}
