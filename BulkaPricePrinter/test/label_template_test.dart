import 'package:bulka_price_printer/label_template.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('admin label size and field positions are preserved', () {
    final template = LabelTemplate.fromJson({
      'label': {
        'width': 58,
        'height': 40,
        'radius': 4,
        'background': '#ffffff',
        'foreground': '#222222',
        'offsetX': 1.5,
        'offsetY': -1,
      },
      'layout': {
        'barcode': {
          'x': 9.31,
          'y': 22.81,
          'w': 39.38,
          'h': 10.37,
          'font': 5,
          'weight': 400,
          'lineHeight': 1.15,
          'align': 'center',
          'visible': true,
        },
      },
    });
    expect(template.width, 58);
    expect(template.height, 40);
    expect(template.offsetX, 1.5);
    expect(template.fields['barcode']!.x, closeTo(9.31, 0.001));
    expect(template.fields['barcode']!.width, closeTo(39.38, 0.001));
  });
}
