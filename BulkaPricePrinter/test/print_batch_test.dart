import 'dart:typed_data';
import 'package:bulka_price_printer/label_template.dart';
import 'package:bulka_price_printer/printer_service.dart';
import 'package:bulka_price_printer/print_batch_status.dart';
import 'package:bulka_price_printer/product.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';
import 'package:printing/src/interface.dart';
import 'package:printing/src/method_channel.dart';

class FakeSpooler extends MethodChannelPrinting {
  int calls = 0, accepted = 0;
  int? failAt;
  bool uncertain = false;
  final documents = <Uint8List>[];
  @override
  Future<bool> layoutPdf(
    Printer? printer,
    LayoutCallback onLayout,
    String name,
    PdfPageFormat format,
    bool dynamicLayout,
    bool usePrinterSettings,
    OutputType outputType,
    bool forceCustomPrintPaper,
  ) async {
    calls++;
    if (calls == failAt) {
      if (uncertain) throw StateError('Connection lost after submission');
      return false;
    }
    documents.add(await onLayout(format));
    accepted++;
    return true;
  }
}

LabelPrintBatch batch([int copies = 5]) => LabelPrintBatch(
  printer: Printer(url: 'isolated-test-printer', name: 'Test printer'),
  product: const Product(
    id: 'test',
    name: 'Хот дог',
    composition: 'Мука, молоко',
    price: '600',
    expiry: 1,
    expiryUnit: 'days',
    barcode: '2101430000016',
  ),
  madeAt: DateTime(2026, 9, 22, 12),
  copies: copies,
  template: LabelTemplate.defaults,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late PrintingPlatform original;
  late FakeSpooler spooler;
  setUp(() {
    original = PrintingPlatform.instance;
    spooler = FakeSpooler();
    PrintingPlatform.instance = spooler;
  });
  tearDown(() => PrintingPlatform.instance = original);

  test(
    'partial rejection continues remaining copies using the same PDF',
    () async {
      final job = batch();
      spooler.failAt = 3;
      final service = PrinterService();
      await service.printBatch(job);
      expect(job.accepted, 2);
      expect(job.remaining, 3);
      expect(job.outcomeUnknown, false);
      await service.printBatch(job);
      await service.printBatch(job);
      expect(job.complete, true);
      expect(spooler.accepted, 5);
      expect(spooler.calls, 6);
      expect(
        spooler.documents.every(
          (pdf) => identical(pdf, spooler.documents.first),
        ),
        true,
      );
    },
  );

  test(
    'unknown response cannot repeat a possibly printed copy without reconciliation',
    () async {
      final job = batch();
      spooler.failAt = 3;
      spooler.uncertain = true;
      final service = PrinterService();
      await service.printBatch(job);
      expect(job.accepted, 2);
      expect(job.outcomeUnknown, true);
      await expectLater(service.printBatch(job), throwsStateError);
      expect(spooler.calls, 3);
      job.resolveUnknown(printed: true);
      await service.printBatch(job);
      expect(job.accepted, 5);
      expect(spooler.calls, 5);
    },
  );

  test(
    'an operator-confirmed missing copy is included when continuing',
    () async {
      final job = batch();
      spooler.failAt = 1;
      spooler.uncertain = true;
      final service = PrinterService();
      await service.printBatch(job);
      job.resolveUnknown(printed: false);
      await service.printBatch(job);
      expect(spooler.accepted, 5);
      expect(job.complete, true);
    },
  );

  test('a batch of 130 keeps an exact count and reports progress', () async {
    final job = batch(130);
    final progress = <int>[];
    await PrinterService().printBatch(
      job,
      onProgress: () => progress.add(job.accepted),
    );
    expect(spooler.accepted, 130);
    expect(progress, List.generate(130, (i) => i + 1));
    expect(job.remaining, 0);
  });

  testWidgets(
    'partial status shows actual count and asks about an uncertain copy',
    (tester) async {
      final job = batch();
      spooler.failAt = 3;
      spooler.uncertain = true;
      await tester.runAsync(() => PrinterService().printBatch(job));
      bool? resolved;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PrintBatchStatus(
              batch: job,
              printing: false,
              onFinish: () {},
              onResolveUnknown: (value) => resolved = value,
            ),
          ),
        ),
      );
      expect(find.text('Отправлено: 2 из 5'), findsOneWidget);
      expect(find.text('Этикетка вышла'), findsOneWidget);
      await tester.tap(find.text('Этикетка не вышла'));
      expect(resolved, false);
      expect(tester.takeException(), isNull);
    },
  );
}
