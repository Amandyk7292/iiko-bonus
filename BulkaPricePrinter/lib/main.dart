import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'catalog_service.dart';
import 'printer_service.dart';
import 'product.dart';

void main() => runApp(const BulkaPrinterApp());

class BulkaPrinterApp extends StatelessWidget {
  const BulkaPrinterApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Bulka — печать этикеток',
    theme: ThemeData(
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
  Product? _selected;
  Printer? _printer;
  String _city = 'aktau';
  int _copies = 1;
  bool _loading = true, _printing = false;
  String? _error;

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
      final products = await _catalog.load(_city);
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
    if (_selected == null || _printer == null || _printing) return;
    setState(() => _printing = true);
    try {
      final ok = await _printerService.printLabel(
        printer: _printer!,
        product: _selected!,
        madeAt: DateTime.now(),
        copies: _copies,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ok
                ? 'Этикетка отправлена на ${_printer!.name}'
                : 'Принтер не принял задание',
          ),
          backgroundColor: ok ? Colors.green.shade700 : Colors.red.shade700,
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
          onPressed: _loading ? null : _reload,
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
          onSelectionChanged: (v) async {
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
                onTap: () => setState(() => _selected = item),
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
          onChanged: (p) async {
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
            child: Container(
              constraints: const BoxConstraints(maxWidth: 630),
              padding: const EdgeInsets.all(30),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: const Color(0xffead9bd)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x14000000),
                    blurRadius: 24,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              child: _selected == null
                  ? const Text('Выберите товар слева')
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _selected!.name,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _selected!.composition,
                          maxLines: 5,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16),
                        ),
                        const SizedBox(height: 24),
                        const Icon(Icons.view_week, size: 70),
                        Text(
                          _selected!.barcode,
                          style: const TextStyle(
                            fontSize: 20,
                            letterSpacing: 4,
                          ),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Годен: ${_selected!.expiry} ${_selected!.expiryUnit == 'hours' ? 'ч.' : 'дн.'}',
                            ),
                            Text(
                              'ЦЕНА: ${_selected!.price} ₸',
                              style: const TextStyle(
                                fontSize: 23,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
            ),
          ),
        ),
        const SizedBox(height: 22),
        Row(
          children: [
            const Text(
              'Количество:',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(width: 12),
            IconButton.filledTonal(
              onPressed: _copies > 1 ? () => setState(() => _copies--) : null,
              icon: const Icon(Icons.remove),
            ),
            SizedBox(
              width: 54,
              child: Text(
                '$_copies',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            IconButton.filledTonal(
              onPressed: _copies < 99 ? () => setState(() => _copies++) : null,
              icon: const Icon(Icons.add),
            ),
            const Spacer(),
            SizedBox(
              height: 58,
              width: 270,
              child: FilledButton.icon(
                onPressed: _printer == null || _selected == null || _printing
                    ? null
                    : _print,
                icon: _printing
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.print),
                label: Text(
                  _printing ? 'Печатаю…' : 'Печатать сразу',
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
