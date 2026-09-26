import 'package:pdf/pdf.dart';
import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'catalog_service.dart';
import 'printer_service.dart';
import 'print_batch_status.dart';
import 'label_document.dart';
import 'product.dart';
import 'label_template.dart';

void main() => runApp(const BulkaPrinterApp());

class BulkaPrinterApp extends StatelessWidget {
  const BulkaPrinterApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Bulka — печать этикеток',
    theme: ThemeData(
      fontFamily: 'Segoe UI',
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xffffb300),
        primary: const Color(0xff782b0e),
      ),
      scaffoldBackgroundColor: const Color(0xfffffbf4),
      useMaterial3: true,
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        filled: true,
        fillColor: Colors.white,
      ),
    ),
    home: const PrinterHome(),
  );
}

class PrinterHome extends StatefulWidget {
  const PrinterHome({super.key});
  @override
  State<PrinterHome> createState() => _PrinterHomeState();
}

class _PrinterHomeState extends State<PrinterHome> {
  final _catalog = CatalogService();
  final _printerService = PrinterService();
  final _search = TextEditingController();
  List<Product> _products = const [];
  List<Printer> _printers = const [];
  LabelTemplate _template = LabelTemplate.defaults;
  Product? _selected;
  Printer? _printer;
  String _city = 'aktau';
  int _copies = 1;
  bool _loading = true, _printing = false;
  String? _error;
  LabelPrintBatch? _batch;
  bool get _hasActiveBatch => _batch != null && !_batch!.complete;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    final prefs = await SharedPreferences.getInstance();
    _city = prefs.getString('city') ?? 'aktau';
    await _reload(savedPrinter: prefs.getString('printer'));
  }

  Future<void> _reload({String? savedPrinter}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final loaded = await Future.wait([
        _catalog.load(_city),
        _catalog.loadTemplate(_city),
      ]);
      final products = loaded[0] as List<Product>;
      final template = loaded[1] as LabelTemplate;
      final printers = await _printerService.printers();
      final wanted =
          savedPrinter ??
          (await SharedPreferences.getInstance()).getString('printer');
      Printer? chosen;
      for (final p in printers) {
        if (p.url == wanted || p.name == wanted) chosen = p;
      }
      chosen ??= printers
          .where((p) => p.name.toLowerCase().contains('365'))
          .firstOrNull;
      chosen ??= printers.where((p) => p.isDefault).firstOrNull;
      chosen ??= printers.firstOrNull;
      if (!mounted) return;
      setState(() {
        _products = products;
        _template = template;
        _selected = products.firstOrNull;
        _printers = printers;
        _printer = chosen;
      });
    } catch (e) {
      if (mounted) {
        setState(
          () => _error =
              'Не удалось загрузить данные. Проверьте интернет и нажмите «Повторить».\n$e',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Product> get _visible {
    final q = _search.text.trim().toLowerCase();
    return (q.isEmpty
            ? _products
            : _products.where(
                (p) => '${p.name} ${p.barcode}'.toLowerCase().contains(q),
              ))
        .toList();
  }

  Future<void> _print() async {
    if (_selected == null ||
        _printer == null ||
        _printing ||
        _batch?.outcomeUnknown == true) {
      return;
    }
    if (!_hasActiveBatch) {
      _batch = LabelPrintBatch(
        printer: _printer!,
        product: _selected!,
        madeAt: DateTime.now(),
        copies: _copies,
        template: _template,
      );
    }
    final batch = _batch!;
    setState(() => _printing = true);
    try {
      await _printerService.printBatch(
        batch,
        onProgress: () {
          if (mounted) setState(() {});
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            batch.complete
                ? 'Отправлено ${batch.accepted} этикеток на ${batch.printer.name}'
                : 'Отправлено ${batch.accepted} из ${batch.copies}. ${batch.error}',
          ),
          backgroundColor: batch.complete
              ? Colors.green.shade700
              : Colors.red.shade700,
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ошибка печати: $e'),
            backgroundColor: Colors.red.shade700,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _printing = false);
    }
  }

  Widget _templatePreview(Product product) => AspectRatio(
    aspectRatio: _template.width / _template.height,
    child: PdfPreview(
      key: ValueKey('${product.id}:${_template.hashCode}'),
      build: (_) => buildLabelPdf(product, DateTime.now(), _template),
      initialPageFormat: PdfPageFormat(
        _template.width * PdfPageFormat.mm,
        _template.height * PdfPageFormat.mm,
        marginAll: 0,
      ),
      allowPrinting: false,
      allowSharing: false,
      canChangePageFormat: false,
      canChangeOrientation: false,
      canDebug: false,
      useActions: false,
      dynamicLayout: false,
      padding: EdgeInsets.zero,
      previewPageMargin: EdgeInsets.zero,
      pdfPreviewPageDecoration: const BoxDecoration(color: Colors.white),
      scrollViewDecoration: const BoxDecoration(color: Color(0xfffffbf4)),
    ),
  );
  Future<void> _editCopies() async {
    var value = '$_copies';
    final selected = await showDialog<int>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) {
          void digit(String digit) => update(() {
            final next = value == '0' ? digit : '$value$digit';
            if ((int.tryParse(next) ?? 0) <= 999) value = next;
          });
          return AlertDialog(
            title: const Text('Количество этикеток'),
            content: SizedBox(
              width: 330,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    decoration: BoxDecoration(
                      color: const Color(0xfffff3d1),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      value,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 36,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  GridView.count(
                    shrinkWrap: true,
                    crossAxisCount: 3,
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                    childAspectRatio: 1.7,
                    children: [
                      for (final number in [
                        '1',
                        '2',
                        '3',
                        '4',
                        '5',
                        '6',
                        '7',
                        '8',
                        '9',
                      ])
                        FilledButton.tonal(
                          onPressed: () => digit(number),
                          child: Text(
                            number,
                            style: const TextStyle(fontSize: 24),
                          ),
                        ),
                      FilledButton.tonal(
                        onPressed: () => update(() => value = ''),
                        child: const Text('C', style: TextStyle(fontSize: 22)),
                      ),
                      FilledButton.tonal(
                        onPressed: () => digit('0'),
                        child: const Text('0', style: TextStyle(fontSize: 24)),
                      ),
                      FilledButton.tonalIcon(
                        onPressed: () => update(() {
                          if (value.isNotEmpty) {
                            value = value.substring(0, value.length - 1);
                          }
                        }),
                        icon: const Icon(Icons.backspace_outlined),
                        label: const SizedBox.shrink(),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Отмена'),
              ),
              FilledButton(
                onPressed: (int.tryParse(value) ?? 0) > 0
                    ? () => Navigator.pop(context, int.parse(value))
                    : null,
                child: const Text('Готово'),
              ),
            ],
          );
        },
      ),
    );
    if (selected != null && mounted) setState(() => _copies = selected);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Row(
        children: [
          CircleAvatar(
            backgroundColor: Color(0xffffb300),
            child: Text(
              'B',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                color: Color(0xff782b0e),
              ),
            ),
          ),
          SizedBox(width: 12),
          Text(
            'Bulka · Печать этикеток',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Обновить',
          onPressed: _loading || _hasActiveBatch || _printing ? null : _reload,
          icon: const Icon(Icons.refresh),
        ),
        const SizedBox(width: 12),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _errorView()
        : Row(
            children: [
              SizedBox(width: 420, child: _catalogPanel()),
              const VerticalDivider(width: 1),
              Expanded(child: _printPanel()),
            ],
          ),
  );

  Widget _errorView() => Center(
    child: SizedBox(
      width: 520,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 52, color: Color(0xffffb300)),
              const SizedBox(height: 16),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: _reload,
                icon: const Icon(Icons.refresh),
                label: const Text('Повторить'),
              ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _catalogPanel() => Padding(
    padding: const EdgeInsets.all(20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'aktau', label: Text('Актау')),
            ButtonSegment(value: 'astana', label: Text('Астана')),
          ],
          selected: {_city},
          onSelectionChanged: _hasActiveBatch || _printing
              ? null
              : (v) async {
                  _batch = null;
                  _city = v.first;
                  await (await SharedPreferences.getInstance()).setString(
                    'city',
                    _city,
                  );
                  _reload();
                },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Название или штрихкод',
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Товары · ${_visible.length}',
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: _visible.length,
            separatorBuilder: (_, index) => const SizedBox(height: 6),
            itemBuilder: (_, i) {
              final item = _visible[i], active = item.id == _selected?.id;
              return ListTile(
                selected: active,
                selectedTileColor: const Color(0xffffedbd),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                title: Text(
                  item.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text('${item.price} ₸ · ${item.barcode}'),
                trailing: active
                    ? const Icon(Icons.check_circle, color: Color(0xff782b0e))
                    : null,
                onTap: _hasActiveBatch || _printing
                    ? null
                    : () => setState(() {
                        _selected = item;
                        _batch = null;
                      }),
              );
            },
          ),
        ),
      ],
    ),
  );

  Widget _printPanel() => Padding(
    padding: const EdgeInsets.all(28),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Печать без диалога',
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 6),
        const Text(
          'Выберите принтер один раз. Следующие этикетки сразу уходят в очередь Windows.',
        ),
        const SizedBox(height: 24),
        DropdownButtonFormField<Printer>(
          initialValue: _printer,
          decoration: const InputDecoration(
            labelText: 'Принтер',
            prefixIcon: Icon(Icons.print),
          ),
          items: _printers
              .map(
                (p) => DropdownMenuItem(
                  value: p,
                  child: Text(
                    '${p.name}${p.isDefault ? ' · по умолчанию' : ''}',
                  ),
                ),
              )
              .toList(),
          onChanged: _hasActiveBatch || _printing
              ? null
              : (p) async {
                  _batch = null;
                  setState(() => _printer = p);
                  if (p != null) {
                    await (await SharedPreferences.getInstance()).setString(
                      'printer',
                      p.url,
                    );
                  }
                },
        ),
        if (_printers.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'Принтеры не найдены. Установите драйвер XP-365B и подключите USB.',
              style: TextStyle(color: Colors.red),
            ),
          ),
        const SizedBox(height: 22),
        Expanded(
          child: Center(
            child: _selected == null
                ? const Text('Выберите товар слева')
                : SizedBox(width: 630, child: _templatePreview(_selected!)),
          ),
        ),
        const SizedBox(height: 22),
        if (_batch != null)
          PrintBatchStatus(
            batch: _batch!,
            printing: _printing,
            onFinish: () => setState(() => _batch = null),
            onResolveUnknown: (printed) =>
                setState(() => _batch!.resolveUnknown(printed: printed)),
          ),
        Row(
          children: [
            const Text(
              'Количество:',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(width: 12),
            IconButton.filledTonal(
              onPressed: !_hasActiveBatch && !_printing && _copies > 1
                  ? () => setState(() => _copies--)
                  : null,
              icon: const Icon(Icons.remove),
            ),
            InkWell(
              onTap: _hasActiveBatch || _printing ? null : _editCopies,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: 72,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xffd9bc86)),
                  borderRadius: BorderRadius.circular(12),
                  color: Colors.white,
                ),
                child: Text(
                  '$_copies',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
            IconButton.filledTonal(
              onPressed: !_hasActiveBatch && !_printing && _copies < 999
                  ? () => setState(() => _copies++)
                  : null,
              icon: const Icon(Icons.add),
            ),
            const Spacer(),
            SizedBox(
              height: 58,
              width: 270,
              child: FilledButton.icon(
                onPressed:
                    _printer == null ||
                        _selected == null ||
                        _printing ||
                        _batch?.outcomeUnknown == true
                    ? null
                    : _print,
                icon: _printing
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.print),
                label: Text(
                  _printing
                      ? 'Печатаю…'
                      : _hasActiveBatch
                      ? 'Продолжить: ${_batch!.remaining}'
                      : 'Печатать сразу',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

extension FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
