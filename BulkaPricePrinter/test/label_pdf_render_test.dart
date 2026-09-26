import 'dart:convert';
import 'dart:io';
import 'package:bulka_price_printer/label_document.dart';
import 'package:bulka_price_printer/label_template.dart';
import 'package:bulka_price_printer/product.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'unprintably long composition is rejected instead of being silently clipped',
    () async {
      final product = Product(
        id: 'long',
        name: 'Тест',
        composition: List.filled(600, 'Мука молоко сыр').join(' '),
        price: '600',
        expiry: 1,
        expiryUnit: 'days',
        barcode: '2101430000016',
      );
      await expectLater(
        buildLabelPdf(product, DateTime(2026, 9, 22), LabelTemplate.defaults),
        throwsStateError,
      );
    },
  );
  test(
    'saved 58x40 template produces a printable PDF with Kazakh and Russian text',
    () async {
      final template = LabelTemplate.fromJson(
        jsonDecode(File('test/fixtures/label-58x40.json').readAsStringSync())
            as Map<String, dynamic>,
      );
      const product = Product(
        id: 'qa',
        name: 'Хот дог',
        composition:
            'Құрамы: хот-дог бөлкесі, сосиска, кетчуп, сарымсақ соусы, қияр, ірімшік соусы. Состав: булочка для хот-дога, сосиска, кетчуп, чесночный соус, свежий огурцы, сырный соус.',
        price: '600',
        expiry: 1,
        expiryUnit: 'days',
        barcode: '2101430000016',
      );
      final bytes = await buildLabelPdf(
        product,
        DateTime(2026, 9, 22, 12),
        template,
      );
      expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
      expect(bytes.length, greaterThan(1000));
      final target = Platform.environment['BULKA_LABEL_QA_DIR'];
      if (target != null) {
        Directory(target).createSync(recursive: true);
        File('$target/label-58x40.pdf').writeAsBytesSync(bytes);
      }
    },
  );
}
