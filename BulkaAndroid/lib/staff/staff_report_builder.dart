part of '../main.dart';

Future<void> shareStaffExport(
  BuildContext context,
  Uint8List bytes,
  String filename,
) async {
  final box = context.findRenderObject();
  final origin = box is RenderBox && box.hasSize
      ? box.localToGlobal(Offset.zero) & box.size
      : null;
  await SharePlus.instance.share(
    ShareParams(
      files: [
        XFile.fromData(
          bytes,
          mimeType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ],
      fileNameOverrides: [filename],
      sharePositionOrigin: origin,
    ),
  );
}

Future<List<String>?> staffChooseFields(
  BuildContext context,
  String title,
  Map<String, String> options,
  List<String> selected, {
  int limit = 1,
}) {
  var search = '';
  final draft = selected.toSet();
  return showModalBottomSheet<List<String>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => SizedBox(
        height: MediaQuery.sizeOf(context).height * .85,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: 'close_btn'.tr,
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                decoration: InputDecoration(
                  hintText: 'search_hint'.tr,
                  prefixIcon: const Icon(Icons.search),
                ),
                onChanged: (value) =>
                    update(() => search = value.trim().toLowerCase()),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  children: [
                    for (final entry in options.entries.where(
                      (e) => e.value.toLowerCase().contains(search),
                    ))
                      CheckboxListTile(
                        controlAffinity: ListTileControlAffinity.trailing,
                        contentPadding: EdgeInsets.zero,
                        title: Text(entry.value),
                        value: draft.contains(entry.key),
                        onChanged: (value) {
                          if (limit == 1) {
                            Navigator.pop(context, [entry.key]);
                            return;
                          }
                          update(() {
                            if (value == true && draft.length < limit) {
                              draft.add(entry.key);
                            } else {
                              draft.remove(entry.key);
                            }
                          });
                        },
                      ),
                  ],
                ),
              ),
              if (limit > 1)
                Padding(
                  padding: EdgeInsets.only(
                    top: 12,
                    bottom: MediaQuery.viewInsetsOf(context).bottom,
                  ),
                  child: GradientButton(
                    onPressed: () => Navigator.pop(context, draft.toList()),
                    child: Text('${'apply_btn'.tr} (${draft.length}/$limit)'),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}

class StaffReportBuilder extends StatefulWidget {
  const StaffReportBuilder({required this.api, required this.base, super.key});
  final StaffApiClient api;
  final Map<String, dynamic> base;
  @override
  State<StaffReportBuilder> createState() => _StaffReportBuilderState();
}

class _StaffReportBuilderState extends State<StaffReportBuilder> {
  String _type = 'SALES', _dateField = '';
  Map<String, dynamic> _columns = {};
  List<String> _groups = ['Department'],
      _aggregate = ['DishDiscountSumInt', 'UniqOrderId'];
  List<Map<String, dynamic>> _filters = _staffSalesFilters
      .map((e) => Map<String, dynamic>.from(e))
      .toList();
  List<Map<String, dynamic>> _templates = [];
  Map<String, dynamic>? _report, _submitted;
  String? _error;
  bool _loading = false, _exporting = false;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    unawaited(_schema());
    unawaited(_restoreTemplates());
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  @override
  void didUpdateWidget(StaffReportBuilder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.base['serverId'] != widget.base['serverId']) {
      _report = null;
      _submitted = null;
      unawaited(_schema());
    } else if (jsonEncode(oldWidget.base) != jsonEncode(widget.base) &&
        _submitted != null) {
      unawaited(
        _run(
          query: {
            ..._submitted!,
            'from': widget.base['from'],
            'to': widget.base['to'],
            'filters': [
              ...(_submitted!['filters'] as List).where(
                (e) => e is Map && e['field'] != 'Department',
              ),
              ...(widget.base['filters'] as List? ?? []).where(
                (e) => e is Map && e['field'] == 'Department',
              ),
            ],
          },
        ),
      );
    }
  }

  Future<void> _restoreTemplates() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      final raw = staffValidateTemplates(
        jsonDecode(prefs.getString('staff_report_templates_v1') ?? '[]'),
      );
      if (mounted) {
        setState(
          () => _templates = raw
              .whereType<Map>()
              .take(50)
              .map((e) => Map<String, dynamic>.from(e))
              .toList(),
        );
      }
    } catch (_) {
      /* An invalid local preference must not prevent reporting. */
    }
  }

  Future<void> _schema() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _columns = {};
    });
    try {
      final result = await widget.api.request(
        '/iiko-dashboard/schema?${Uri(queryParameters: {'serverId': '${widget.base['serverId']}', 'reportType': _type}).query}',
      );
      if (!mounted || generation != _generation) return;
      setState(() {
        _columns = Map<String, dynamic>.from(result['columns'] as Map);
        _dateField = '${result['dateField']}';
        _groups = _groups
            .where((e) => _columns[e]?['groupingAllowed'] == true)
            .toList();
        _aggregate = _aggregate
            .where((e) => _columns[e]?['aggregationAllowed'] == true)
            .toList();
        _filters = _filters
            .where(
              (e) =>
                  e['field'] != _dateField &&
                  _columns[e['field']]?['filteringAllowed'] == true,
            )
            .toList();
      });
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _error = '$error');
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _run({Map<String, dynamic>? query}) async {
    if (_aggregate.isEmpty && query == null) return;
    final submitted =
        query ??
        {
          ...widget.base,
          'reportType': _type,
          'groupBy': [..._groups],
          'aggregate': [..._aggregate],
          'filters': [
            ..._filters,
            ...(widget.base['filters'] as List? ?? []).where(
              (e) =>
                  e is Map &&
                  e['field'] == 'Department' &&
                  !_filters.any((f) => f['field'] == 'Department'),
            ),
          ],
        };
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _report = null;
      _submitted = submitted;
    });
    try {
      final result = await widget.api.report(
        '/iiko-dashboard/report',
        submitted,
        isCancelled: () => !mounted || generation != _generation,
      );
      if (mounted && generation == _generation) {
        setState(() => _report = result);
      }
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _error = '$error');
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  String _label(String key) =>
      staffFieldLabel(key, '${_columns[key]?['name'] ?? key}');
  Future<void> _choose(bool groups) async {
    final values = await staffChooseFields(
      context,
      groups
          ? staffText('Группировка', 'Топтау', 'Grouping')
          : staffText('Показатели', 'Көрсеткіштер', 'Metrics'),
      {
        for (final entry in _columns.entries.where(
          (e) =>
              e.value[groups ? 'groupingAllowed' : 'aggregationAllowed'] ==
              true,
        ))
          entry.key: _label(entry.key),
      },
      groups ? _groups : _aggregate,
      limit: groups ? 5 : 12,
    );
    if (values != null && mounted) {
      setState(() {
        if (groups) {
          _groups = values;
        } else {
          _aggregate = values;
        }
      });
    }
  }

  Future<void> _addFilter() async {
    if (_filters.length >= 15) return;
    final fields = await staffChooseFields(
      context,
      staffText('Поле фильтра', 'Сүзгі өрісі', 'Filter field'),
      {
        for (final entry in _columns.entries.where(
          (e) => e.key != _dateField && e.value['filteringAllowed'] == true,
        ))
          entry.key: _label(entry.key),
      },
      [],
    );
    if (fields == null || fields.isEmpty || !mounted) return;
    final controller = TextEditingController();
    var exclude = false;
    final route = DialogRoute<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => BulkaActionDialog(
          title: Text(_label(fields.first)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: controller,
                maxLines: 4,
                maxLength: 5000,
                decoration: InputDecoration(
                  labelText: staffText(
                    'По одному значению на строку',
                    'Әр жолға бір мән',
                    'One value per line',
                  ),
                ),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(staffText('Исключить', 'Алып тастау', 'Exclude')),
                value: exclude,
                onChanged: (v) => update(() => exclude = v ?? false),
              ),
            ],
          ),
          actions: [
            FilledButton(
              onPressed: () {
                final values = controller.text
                    .split('\n')
                    .map((e) => e.trim())
                    .where((e) => e.isNotEmpty)
                    .take(100)
                    .toList();
                if (values.isNotEmpty) {
                  Navigator.pop(context, {
                    'field': fields.first,
                    'values': values,
                    'exclude': exclude,
                  });
                }
              },
              child: Text('apply_btn'.tr),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text('cancel_btn'.tr),
            ),
          ],
        ),
      ),
    );
    final value = await Navigator.of(context).push(route);
    unawaited(route.completed.then((_) => controller.dispose()));
    if (value != null && mounted) {
      setState(() {
        _filters.removeWhere((e) => e['field'] == fields.first);
        _filters.add(value);
      });
    }
  }

  Future<void> _saveTemplate() async {
    final controller = TextEditingController();
    final route = DialogRoute<String>(
      context: context,
      builder: (context) => BulkaActionDialog(
        title: Text(
          staffText('Сохранить шаблон', 'Үлгіні сақтау', 'Save template'),
        ),
        content: TextField(
          controller: controller,
          maxLength: 80,
          decoration: InputDecoration(
            labelText: staffText('Название', 'Атауы', 'Name'),
          ),
        ),
        actions: [
          FilledButton(
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                Navigator.pop(context, controller.text.trim());
              }
            },
            child: Text('save_btn'.tr),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('cancel_btn'.tr),
          ),
        ],
      ),
    );
    final name = await Navigator.of(context).push(route);
    unawaited(route.completed.then((_) => controller.dispose()));
    if (name == null || !mounted) return;
    final template = {
      'name': name,
      'reportType': _type,
      'groupBy': List<String>.of(_groups),
      'aggregate': List<String>.of(_aggregate),
      'filters': jsonDecode(jsonEncode(_filters)),
    };
    final next = [
      ..._templates.where((e) => e['name'] != name).take(49),
      template,
    ];
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('staff_report_templates_v1', jsonEncode(next));
      if (mounted) setState(() => _templates = next);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _export() async {
    if (_submitted == null || _exporting) return;
    setState(() => _exporting = true);
    try {
      final query = Map<String, dynamic>.from(_submitted!);
      final bytes = await widget.api.exportFile(
        '/iiko-dashboard/export',
        body: query,
      );
      if (mounted) {
        await shareStaffExport(
          context,
          bytes,
          'iiko-${query['from']}-${query['to']}.xlsx',
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final type in {
            'SALES': staffText('Продажи', 'Сатылымдар', 'Sales'),
            'TRANSACTIONS': staffText('Проводки', 'Өткізбелер', 'Transactions'),
            'DELIVERIES': staffText('Доставка', 'Жеткізу', 'Deliveries'),
          }.entries)
            ChoiceChip(
              label: Text(type.value),
              selected: _type == type.key,
              onSelected: _loading
                  ? null
                  : (_) {
                      setState(() {
                        _type = type.key;
                        _submitted = null;
                        _report = null;
                      });
                      unawaited(_schema());
                    },
            ),
        ],
      ),
      const SizedBox(height: 12),
      if (_templates.isNotEmpty)
        OutlinedButton.icon(
          icon: const Icon(Icons.bookmark_outline),
          label: Text(
            staffText('Мои шаблоны', 'Менің үлгілерім', 'My templates'),
          ),
          onPressed: () async {
            final value = await staffChooseFields(
              context,
              staffText('Шаблоны', 'Үлгілер', 'Templates'),
              {
                for (var i = 0; i < _templates.length; i++)
                  '$i': '${_templates[i]['name']}',
              },
              [],
            );
            if (value == null || value.isEmpty || !mounted) return;
            final template = _templates[int.parse(value.first)];
            setState(() {
              _type = '${template['reportType']}';
              _groups = List<String>.from(template['groupBy'] as List);
              _aggregate = List<String>.from(template['aggregate'] as List);
              _filters = (template['filters'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList();
              _submitted = null;
              _report = null;
            });
            await _schema();
          },
        ),
      if (_templates.isNotEmpty)
        TextButton.icon(
          onPressed: () async {
            await Navigator.push(
              context,
              StaffPageRoute<void>(
                builder: (_) => StaffTemplates(
                  templates: _templates,
                  save: (items) async {
                    final prefs = await SharedPreferences.getInstance();
                    await prefs.setString(
                      'staff_report_templates_v1',
                      jsonEncode(staffValidateTemplates(items)),
                    );
                    if (mounted) setState(() => _templates = items);
                  },
                ),
              ),
            );
          },
          icon: const Icon(Icons.bookmarks_outlined),
          label: Text(
            staffText(
              'Управление шаблонами',
              'Үлгілерді басқару',
              'Manage templates',
            ),
          ),
        ),
      OutlinedButton(
        onPressed: _loading ? null : () => _choose(true),
        child: Text(
          '${staffText('Группировка', 'Топтау', 'Grouping')}: ${_groups.map(_label).join(', ')}',
          textAlign: TextAlign.center,
        ),
      ),
      const SizedBox(height: 10),
      OutlinedButton(
        onPressed: _loading ? null : () => _choose(false),
        child: Text(
          '${staffText('Показатели', 'Көрсеткіштер', 'Metrics')}: ${_aggregate.map(_label).join(', ')}',
          textAlign: TextAlign.center,
        ),
      ),
      const SizedBox(height: 10),
      for (final filter in _filters)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(_label('${filter['field']}')),
          subtitle: Text(
            '${filter['exclude'] == true ? '≠' : '='} ${(filter['values'] as List).join(', ')}',
          ),
          trailing: IconButton(
            tooltip: 'delete_btn'.tr,
            icon: const Icon(Icons.close),
            onPressed: _loading
                ? null
                : () => setState(() => _filters.remove(filter)),
          ),
        ),
      TextButton.icon(
        onPressed: _loading ? null : _addFilter,
        icon: const Icon(Icons.add),
        label: Text(staffText('Добавить фильтр', 'Сүзгі қосу', 'Add filter')),
      ),
      const SizedBox(height: 12),
      GradientButton(
        loading: _loading,
        onPressed: _aggregate.isEmpty ? null : () => _run(),
        child: Text(
          staffText('Сформировать отчёт', 'Есеп құру', 'Build report'),
        ),
      ),
      const SizedBox(height: 12),
      Wrap(
        spacing: 12,
        runSpacing: 8,
        children: [
          TextButton.icon(
            onPressed: _loading || _aggregate.isEmpty ? null : _saveTemplate,
            icon: const Icon(Icons.bookmark_add_outlined),
            label: Text(
              staffText('Сохранить шаблон', 'Үлгіні сақтау', 'Save template'),
            ),
          ),
          if (_report != null)
            OutlinedButton.icon(
              onPressed: _exporting ? null : _export,
              icon: const Icon(Icons.ios_share),
              label: Text(_exporting ? '…' : 'Excel'),
            ),
        ],
      ),
      if (_error != null)
        _StaffError(
          message: _error!,
          onRetry: _columns.isEmpty ? _schema : () => _run(),
        ),
      if (_report != null) StaffReport(report: _report!),
    ],
  );
}
