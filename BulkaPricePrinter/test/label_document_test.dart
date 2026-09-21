import 'package:bulka_price_printer/label_document.dart';
import 'package:bulka_price_printer/product.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const product = Product(
    id: '1',
    name: 'Тест',
    composition: '',
    price: '100',
    expiry: 24,
    expiryUnit: 'hours',
    barcode: '2101430000016',
  );
  test('expiry respects hours across a day boundary', () {
    expect(
      expiryFor(product, DateTime(2026, 9, 21, 12)),
      DateTime(2026, 9, 22, 12),
    );
  });
  test('date uses label format', () {
    expect(formatLabelDate(DateTime(2026, 9, 21)), '21.09.2026');
  });
}
