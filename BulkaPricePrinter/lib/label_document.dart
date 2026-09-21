import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'product.dart';

String formatLabelDate(DateTime date) =>
    '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
DateTime expiryFor(Product product, DateTime madeAt) =>
    product.expiryUnit == 'hours'
    ? madeAt.add(Duration(hours: product.expiry))
    : madeAt.add(Duration(days: product.expiry));

Future<Uint8List> buildLabelPdf(Product product, DateTime madeAt) async {
  final regular = pw.Font.ttf(
    await rootBundle.load('assets/fonts/Roboto-Regular.ttf'),
  );
  final bold = pw.Font.ttf(
    await rootBundle.load('assets/fonts/Roboto-Bold.ttf'),
  );
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  final expires = expiryFor(product, madeAt);
  final expiryText = product.expiryUnit == 'hours'
      ? '${formatLabelDate(expires)} ${expires.hour.toString().padLeft(2, '0')}:${expires.minute.toString().padLeft(2, '0')}'
      : formatLabelDate(expires);
  document.addPage(
    pw.Page(
      pageFormat: PdfPageFormat(
        70 * PdfPageFormat.mm,
        50 * PdfPageFormat.mm,
        marginAll: 0,
      ),
      build: (_) => pw.Padding(
        padding: pw.EdgeInsets.fromLTRB(
          7 * PdfPageFormat.mm,
          3 * PdfPageFormat.mm,
          6 * PdfPageFormat.mm,
          3 * PdfPageFormat.mm,
        ),
        child: pw.Column(
          children: [
            pw.SizedBox(
              height: 8 * PdfPageFormat.mm,
              child: pw.Center(
                child: pw.Text(
                  product.name,
                  textAlign: pw.TextAlign.center,
                  maxLines: 2,
                  style: pw.TextStyle(font: bold, fontSize: 14),
                ),
              ),
            ),
            pw.SizedBox(
              height: 12 * PdfPageFormat.mm,
              child: pw.Text(
                product.composition,
                maxLines: 5,
                style: const pw.TextStyle(fontSize: 6.3, lineSpacing: 0.7),
              ),
            ),
            pw.SizedBox(
              height: 13 * PdfPageFormat.mm,
              child: product.barcode.length == 13
                  ? pw.BarcodeWidget(
                      barcode: pw.Barcode.ean13(),
                      data: product.barcode,
                      drawText: true,
                      textStyle: const pw.TextStyle(fontSize: 7),
                    )
                  : pw.Center(
                      child: pw.Text(
                        product.barcode.isEmpty
                            ? 'Нет штрихкода'
                            : product.barcode,
                      ),
                    ),
            ),
            pw.Spacer(),
            pw.Row(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Expanded(
                  child: pw.Text(
                    'ИЗГОТОВЛЕНО: ${formatLabelDate(madeAt)}${product.expiryUnit == 'hours' ? ' ${madeAt.hour.toString().padLeft(2, '0')}:${madeAt.minute.toString().padLeft(2, '0')}' : ''}\nГОДЕН ДО: $expiryText',
                    style: const pw.TextStyle(fontSize: 6.8),
                  ),
                ),
                pw.Text(
                  'ЦЕНА:${product.price} ₸',
                  style: pw.TextStyle(font: bold, fontSize: 11),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  return document.save();
}
