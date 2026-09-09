part of '../main.dart';

Future<Uint8List> buildPaymentReceiptPdf(PaymentReceipt receipt) async {
  final regularData = await rootBundle.load(
    'assets/fonts/Montserrat-Regular-subset.ttf',
  );
  final boldData = await rootBundle.load(
    'assets/fonts/Montserrat-Bold-subset.ttf',
  );
  final doc = pw.Document();
  final logoData = await rootBundle.load('assets/brand/bulka_logo.png');
  final logo = pw.MemoryImage(
    logoData.buffer.asUint8List(logoData.offsetInBytes, logoData.lengthInBytes),
  );
  final base = pw.Font.ttf(regularData);
  final bold = pw.Font.ttf(boldData);
  final labels = [
    'receipt_item',
    'receipt_quantity',
    'receipt_price',
    'receipt_amount',
  ].map((key) => key.tr).toList();
  pw.Widget row(String label, String value) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 5),
    child: pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: [
        pw.Expanded(child: pw.Text(label)),
        pw.SizedBox(width: 16),
        pw.Text(value),
      ],
    ),
  );
  doc.addPage(
    pw.MultiPage(
      pageFormat: pdf.PdfPageFormat.a4,
      theme: pw.ThemeData.withFont(base: base, bold: bold),
      margin: const pw.EdgeInsets.all(36),
      build: (_) => [
        pw.Image(logo, width: 105, height: 62, fit: pw.BoxFit.contain),
        pw.SizedBox(height: 18),
        pw.Text(
          'receipt_title'.tr,
          style: pw.TextStyle(font: bold, fontSize: 18),
        ),
        pw.Text('order_details_title'.trArgs({'number': receipt.orderNumber})),
        pw.SizedBox(height: 18),
        row('receipt_document'.tr, receipt.documentNumber),
        row('receipt_date'.tr, formatDateTime(receipt.transactionAt)),
        if (receipt.isRefund) row('receipt_payment'.tr, 'orders_refund'.tr),
        pw.SizedBox(height: 16),
        pw.TableHelper.fromTextArray(
          headers: labels,
          data: receipt.items
              .map(
                (item) => [
                  localizedOrderItemName(item),
                  '${_asInt(item['quantity'], fallback: 1)}',
                  receipt.money(_asDouble(item['unitPrice'])),
                  receipt.money(_asDouble(item['lineTotal'])),
                ],
              )
              .toList(),
          border: null,
          headerAlignments: {
            0: pw.Alignment.centerLeft,
            1: pw.Alignment.center,
            2: pw.Alignment.center,
            3: pw.Alignment.center,
          },
          cellAlignments: {
            0: pw.Alignment.centerLeft,
            1: pw.Alignment.center,
            2: pw.Alignment.center,
            3: pw.Alignment.center,
          },
          headerStyle: pw.TextStyle(font: bold),
          headerDecoration: const pw.BoxDecoration(
            color: pdf.PdfColors.grey100,
          ),
          cellPadding: const pw.EdgeInsets.all(8),
          columnWidths: {
            0: const pw.FlexColumnWidth(3.5),
            1: const pw.FlexColumnWidth(1.5),
            2: const pw.FlexColumnWidth(2),
            3: const pw.FlexColumnWidth(2),
          },
        ),
        pw.SizedBox(height: 18),
        row('receipt_goods'.tr, receipt.money(receipt.goodsSubtotal)),
        if (receipt.discount > 0)
          row('receipt_discount'.tr, '-${receipt.money(receipt.discount)}'),
        if (receipt.bonusSpent > 0)
          row(
            'checkout_bonus_spent'.tr,
            '-${receipt.money(receipt.bonusSpent)}',
          ),
        if (receipt.hasDelivery)
          row('checkout_delivery_fee'.tr, receipt.money(receipt.deliveryFee)),
        row('receipt_total'.tr, receipt.money(receipt.amount)),
        pw.Divider(),
        pw.Text(receipt.paymentLabel),
      ],
    ),
  );
  return doc.save();
}
