import 'dart:io';
import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'label_template.dart';
import 'product.dart';

String formatLabelDate(DateTime date) =>
    '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
DateTime expiryFor(Product product, DateTime madeAt) =>
    product.expiryUnit == 'hours'
    ? madeAt.add(Duration(hours: product.expiry))
    : madeAt.add(Duration(days: product.expiry));

Future<Uint8List> buildLabelPdf(
  Product product,
  DateTime madeAt,
  LabelTemplate template,
) async {
  final regular = await _font(
    r'C:\Windows\Fonts\segoeui.ttf',
    'assets/fonts/Roboto-Regular.ttf',
  );
  final bold = await _font(
    r'C:\Windows\Fonts\segoeuib.ttf',
    'assets/fonts/Roboto-Bold.ttf',
  );
  final semibold = await _font(
    r'C:\Windows\Fonts\seguisb.ttf',
    'assets/fonts/Roboto-Bold.ttf',
  );
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  final expires = expiryFor(product, madeAt);
  String time(DateTime value) =>
      '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  final withTime = product.expiryUnit == 'hours';
  final dates =
      'ИЗГОТОВЛЕНО: ${formatLabelDate(madeAt)}${withTime ? ' ${time(madeAt)}' : ''}\nГОДЕН ДО: ${formatLabelDate(expires)}${withTime ? ' ${time(expires)}' : ''}';
  final composition = template.fields['composition']!.breakLanguages
      ? product.composition.replaceFirst(
          RegExp(r'\s+(Состав:)', caseSensitive: false),
          '\nСостав:',
        )
      : product.composition;
  final content = <String, String>{
    'name': product.name,
    'composition': composition,
    'dates': dates,
    'price': 'ЦЕНА:${product.price} ₸',
  };
  final pageWidth = template.width * PdfPageFormat.mm;
  final pageHeight = template.height * PdfPageFormat.mm;
  document.addPage(
    pw.Page(
      pageFormat: PdfPageFormat(pageWidth, pageHeight, marginAll: 0),
      build: (_) => pw.Container(
        width: pageWidth,
        height: pageHeight,
        decoration: pw.BoxDecoration(
          color: PdfColor.fromHex(template.background),
          borderRadius: pw.BorderRadius.circular(
            template.radius * PdfPageFormat.mm,
          ),
        ),
        child: pw.Transform.translate(
          offset: PdfPoint(
            template.offsetX * PdfPageFormat.mm,
            -template.offsetY * PdfPageFormat.mm,
          ),
          child: pw.Stack(
            children: [
              for (final entry in template.fields.entries)
                if (entry.value.visible)
                  _field(
                    entry.key,
                    entry.value,
                    content[entry.key] ?? '',
                    product.barcode,
                    regular,
                    bold,
                    semibold,
                    template.foreground,
                  ),
            ],
          ),
        ),
      ),
    ),
  );
  return document.save();
}

pw.Widget _field(
  String key,
  LabelField field,
  String text,
  String barcode,
  pw.Font regular,
  pw.Font bold,
  pw.Font semibold,
  String color,
) => pw.Positioned(
  left: field.x * PdfPageFormat.mm,
  top: field.y * PdfPageFormat.mm,
  child: pw.SizedBox(
    width: field.width * PdfPageFormat.mm,
    height: field.height * PdfPageFormat.mm,
    child: key == 'barcode' && barcode.length == 13
        ? pw.BarcodeWidget(
            barcode: pw.Barcode.ean13(),
            data: barcode,
            drawText: true,
            color: PdfColor.fromHex(color),
            textStyle: pw.TextStyle(font: regular, fontSize: field.fontSize),
          )
        : pw.LayoutBuilder(
            builder: (context, _) {
              final maxWidth = field.width * PdfPageFormat.mm;
              final maxHeight = field.height * PdfPageFormat.mm;
              for (var size = field.fontSize; size >= 3; size -= 0.25) {
                final fitted = _textWidget(
                  key,
                  field,
                  text,
                  barcode,
                  regular,
                  bold,
                  semibold,
                  color,
                  size,
                );
                // Measure all lines without a height cap so text cannot disappear
                // silently inside a small label field.
                fitted.layout(
                  context,
                  pw.BoxConstraints(maxWidth: maxWidth),
                );
                if (fitted.box!.height <= maxHeight + 0.01 &&
                    fitted.box!.width <= maxWidth + 0.01) {
                  return pw.Align(
                    alignment: _alignment(field.align),
                    child: fitted,
                  );
                }
              }
              throw StateError(
                'Текст поля «$key» не помещается. Увеличьте поле в шаблоне.',
              );
            },
          ),
  ),
);

pw.Widget _textWidget(
  String key,
  LabelField field,
  String text,
  String barcode,
  pw.Font regular,
  pw.Font bold,
  pw.Font semibold,
  String color,
  double fontSize,
) => pw.Text(
  key == 'barcode' && barcode.isEmpty
      ? 'Нет штрихкода'
      : (key == 'barcode' ? barcode : text),
  textAlign: _textAlign(field.align),
  style: pw.TextStyle(
    font: field.weight >= 700
        ? bold
        : field.weight >= 600
        ? semibold
        : regular,
    fontSize: fontSize,
    color: PdfColor.fromHex(color),
    lineSpacing: fontSize * (field.lineHeight - 1),
  ),
);

Future<pw.Font> _font(String systemPath, String fallbackAsset) async {
  try {
    final bytes = await File(systemPath).readAsBytes();
    return pw.Font.ttf(ByteData.sublistView(bytes));
  } catch (_) {
    return pw.Font.ttf(await rootBundle.load(fallbackAsset));
  }
}

pw.Alignment _alignment(String value) => switch (value) {
  'center' => pw.Alignment.center,
  'right' => pw.Alignment.centerRight,
  _ => pw.Alignment.centerLeft,
};
pw.TextAlign _textAlign(String value) => switch (value) {
  'center' => pw.TextAlign.center,
  'right' => pw.TextAlign.right,
  _ => pw.TextAlign.left,
};
