part of '../main.dart';

const staffDashboardMetricIds = {
  'revenue': 'DishDiscountSumInt',
  'checks': 'UniqOrderId',
  'average': 'AverageCheck',
  'discount': 'DiscountSum',
  'cost': 'ProductCostBase.ProductCost',
  'guests': 'GuestNum',
  'items': 'DishAmountInt',
};
List<Map<String, dynamic>> staffValidateTemplates(dynamic input) {
  final bad = FormatException(
    staffText(
      'Неверный файл настроек отчётов',
      'Есеп баптаулары файлы жарамсыз',
      'Invalid report settings file',
    ),
  );
  if (input is! List || input.length > 50) throw bad;
  bool field(dynamic value) =>
      value is String && RegExp(r'^[a-zA-Z0-9_.-]{1,120}$').hasMatch(value);
  final templates = <Map<String, dynamic>>[];
  for (final item in input) {
    if (item is! Map ||
        item['name'] is! String ||
        '${item['name']}'.trim().isEmpty ||
        '${item['name']}'.length > 80 ||
        !['SALES', 'TRANSACTIONS', 'DELIVERIES'].contains(item['reportType'])) {
      throw bad;
    }
    for (final key in ['aggregate', 'groupBy']) {
      if (item[key] is! List ||
          (item[key] as List).length > (key == 'aggregate' ? 12 : 5) ||
          !(item[key] as List).every(field)) {
        throw bad;
      }
    }
    if (item['filters'] is! List || (item['filters'] as List).length > 15) {
      throw bad;
    }
    for (final filter in item['filters'] as List) {
      if (filter is! Map ||
          !field(filter['field']) ||
          filter['exclude'] is! bool ||
          filter['values'] is! List ||
          (filter['values'] as List).length > 100 ||
          (filter['values'] as List).any(
            (value) =>
                !(value is String || value is num || value is bool) ||
                '$value'.length > 250 ||
                (value is num && !value.isFinite),
          )) {
        throw bad;
      }
    }
    templates.add({
      for (final key in [
        'name',
        'reportType',
        'groupBy',
        'aggregate',
        'filters',
      ])
        key: item[key],
    });
  }
  return templates;
}

Map<String, dynamic> staffParseDashboardPreferences(String raw) {
  if (raw.length > 200000) {
    throw const FormatException('Settings file exceeds 200 KB');
  }
  final value = jsonDecode(raw);
  if (value is! Map || value['cards'] is! List || value['auto'] is! bool) {
    throw const FormatException('Invalid settings');
  }
  final cards = value['cards'] as List;
  if (cards.isEmpty ||
      cards.length > staffDashboardMetricIds.length ||
      cards.toSet().length != cards.length ||
      !cards.every(staffDashboardMetricIds.containsKey)) {
    throw const FormatException('Invalid metric cards');
  }
  return {
    'cards': cards,
    'templates': staffValidateTemplates(value['templates']),
    'auto': value['auto'],
  };
}

Future<Map<String, dynamic>?> staffImportDashboardPreferences() async {
  final file = await file_selector.openFile(
    acceptedTypeGroups: [
      const file_selector.XTypeGroup(
        label: 'JSON',
        extensions: ['json'],
        uniformTypeIdentifiers: ['public.json'],
      ),
    ],
  );
  if (file == null) return null;
  if (await file.length() > 200000) {
    throw const FormatException('Settings file exceeds 200 KB');
  }
  return staffParseDashboardPreferences(await file.readAsString());
}

Future<void> staffShareJson(
  BuildContext context,
  Map<String, dynamic> data,
  String filename,
) async {
  final box = context.findRenderObject();
  await SharePlus.instance.share(
    ShareParams(
      files: [
        XFile.fromData(
          Uint8List.fromList(
            utf8.encode(const JsonEncoder.withIndent('  ').convert(data)),
          ),
          mimeType: 'application/json',
        ),
      ],
      fileNameOverrides: [filename],
      sharePositionOrigin: box is RenderBox && box.hasSize
          ? box.localToGlobal(Offset.zero) & box.size
          : null,
    ),
  );
}

class StaffTemplates extends StatefulWidget {
  const StaffTemplates({
    required this.templates,
    required this.save,
    super.key,
  });
  final List<Map<String, dynamic>> templates;
  final Future<void> Function(List<Map<String, dynamic>>) save;
  @override
  State<StaffTemplates> createState() => _StaffTemplatesState();
}

class _StaffTemplatesState extends State<StaffTemplates> {
  late List<Map<String, dynamic>> _templates = List.from(widget.templates);
  bool _busy = false;
  String? _error;
  Future<void> _change(List<Map<String, dynamic>> next) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.save(next);
      if (mounted) {
        setState(() {
          _templates = next;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(int index) async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(
          staffText(
            'Удалить шаблон?',
            'Үлгіні жою керек пе?',
            'Delete template?',
          ),
        ),
        content: Text('${_templates[index]['name']}'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(c, true),
            child: Text(staffText('Удалить', 'Жою', 'Delete')),
          ),
        ],
      ),
    );
    if (accepted == true) await _change(List.from(_templates)..removeAt(index));
  }

  void _move(int index, int offset) {
    final next = List<Map<String, dynamic>>.from(_templates);
    final item = next.removeAt(index);
    next.insert(index + offset, item);
    unawaited(_change(next));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(staffText('Мои шаблоны', 'Менің үлгілерім', 'My templates')),
    ),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_busy) const LinearProgressIndicator(),
        if (_error != null) Text(_error!),
        for (final (index, item) in _templates.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${item['name']}',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Wrap(
                    spacing: 8,
                    children: [
                      IconButton(
                        tooltip: staffText('Выше', 'Жоғары', 'Move up'),
                        onPressed: _busy || index == 0
                            ? null
                            : () => _move(index, -1),
                        icon: const Icon(Icons.arrow_upward),
                      ),
                      IconButton(
                        tooltip: staffText('Ниже', 'Төмен', 'Move down'),
                        onPressed: _busy || index == _templates.length - 1
                            ? null
                            : () => _move(index, 1),
                        icon: const Icon(Icons.arrow_downward),
                      ),
                      IconButton(
                        tooltip: staffText('Удалить', 'Жою', 'Delete'),
                        onPressed: _busy ? null : () => _remove(index),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    ),
  );
}
