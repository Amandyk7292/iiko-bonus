import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';
import 'product.dart';
import 'label_document.dart';

class PrinterService {
  Future<List<Printer>> printers() => Printing.listPrinters();
  Future<bool> printLabel({
    required Printer printer,
    required Product product,
    required DateTime madeAt,
    required int copies,
  }) async {
    var success = true;
    for (var i = 0; i < copies; i++) {
      final result = await Printing.directPrintPdf(
        printer: printer,
        name: 'Bulka — ${product.name}',
        format: const PdfPageFormat(
          70 * PdfPageFormat.mm,
          50 * PdfPageFormat.mm,
          marginAll: 0,
        ),
        dynamicLayout: false,
        usePrinterSettings: false,
        forceCustomPrintPaper: true,
        onLayout: (_) => buildLabelPdf(product, madeAt),
      );
      success = success && result;
      if (!result) break;
    }
    return success;
  }
}
