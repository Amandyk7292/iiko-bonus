import 'package:pdf/pdf.dart';
import 'dart:typed_data';
import 'package:printing/printing.dart';
import 'product.dart';
import 'label_document.dart';
import 'label_template.dart';

class LabelPrintBatch {
  LabelPrintBatch({
    required this.printer,
    required this.product,
    required this.madeAt,
    required this.copies,
    required this.template,
  }) {
    if (copies < 1 || copies > 999) throw ArgumentError.value(copies, 'copies');
  }
  final Printer printer;
  final Product product;
  final DateTime madeAt;
  final int copies;
  final LabelTemplate template;
  Uint8List? _pdf;
  int _accepted = 0;
  bool _running = false, _unknown = false;
  String? _error;
  int get accepted => _accepted;
  int get remaining => copies - _accepted;
  bool get complete => remaining == 0;
  bool get outcomeUnknown => _unknown;
  String? get error => _error;

  void resolveUnknown({required bool printed}) {
    if (!_unknown || _running) throw StateError('No uncertain copy to resolve');
    if (printed) _accepted++;
    _unknown = false;
    _error = null;
  }
}

class PrinterService {
  Future<List<Printer>> printers() => Printing.listPrinters();
  Future<void> printBatch(
    LabelPrintBatch batch, {
    void Function()? onProgress,
  }) async {
    if (batch._running || batch.outcomeUnknown) {
      throw StateError(
        'Resolve the current printing attempt before continuing',
      );
    }
    if (batch.complete) return;
    batch._running = true;
    batch._error = null;
    try {
      // Keep the exact label/date/template when continuing a partial batch.
      batch._pdf ??= await buildLabelPdf(
        batch.product,
        batch.madeAt,
        batch.template,
      );
      while (!batch.complete) {
        bool accepted;
        try {
          accepted = await Printing.directPrintPdf(
            printer: batch.printer,
            name:
                'Bulka — ${batch.product.name} (${batch.accepted + 1}/${batch.copies})',
            format: PdfPageFormat(
              batch.template.width * PdfPageFormat.mm,
              batch.template.height * PdfPageFormat.mm,
              marginAll: 0,
            ),
            dynamicLayout: false,
            usePrinterSettings: false,
            forceCustomPrintPaper: true,
            onLayout: (_) async => batch._pdf!,
          );
        } catch (_) {
          batch._unknown = true;
          batch._error =
              'Статус ещё одной этикетки неизвестен. Проверьте принтер перед продолжением.';
          break;
        }
        if (!accepted) {
          batch._error =
              'Печать остановлена. Можно продолжить с оставшихся копий.';
          break;
        }
        batch._accepted++;
        onProgress?.call();
      }
    } finally {
      batch._running = false;
    }
  }
}
