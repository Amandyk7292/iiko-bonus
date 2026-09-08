part of '../main.dart';

/// A native collection with explicit field definitions and server operations.
/// Every editor keeps errors and draft state on screen until the server confirms.
class StaffResource extends StatefulWidget {
  const StaffResource({
    required this.api,
    required this.path,
    required this.listKey,
    required this.title,
    required this.titleKey,
    required this.fields,
    required this.canEdit,
    this.prepare,
    this.initial,
    this.defaults = const {},
    this.canCreate = true,
    this.deletePath,
    this.onExtra,
    this.facts = const {},
    super.key,
  });
  final StaffApiClient api;
  final String path, listKey, title, titleKey;
  final List<StaffField> fields;
  final bool canEdit, canCreate;
  final Map<String, dynamic> defaults;
  final Map<String, dynamic> Function(Map<String, dynamic>)? initial;
  final Map<String, String> facts;
  final Map<String, dynamic> Function(
    Map<String, dynamic>,
    Map<String, dynamic>?,
  )?
  prepare;
  final String Function(Map<String, dynamic>)? deletePath;
  final List<Widget> Function(BuildContext, Map<String, dynamic>, VoidCallback)?
  onExtra;
  @override
  State<StaffResource> createState() => _StaffResourceState();
}

class _StaffResourceState extends State<StaffResource> {
  List<Map<String, dynamic>> _rows = [];
  String _search = '';
  String? _error;
  bool _loading = false;
  int _generation = 0;
  late final StaffLiveRefresh _live;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () {
      if (!_loading) unawaited(_load());
    });
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    final generation = ++_generation;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(widget.path);
      if (mounted && generation == _generation) {
        setState(() {
          _rows = staffRows(result is List ? result : result[widget.listKey]);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = '$e');
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _edit([Map<String, dynamic>? row]) async {
    if (!widget.canEdit) return;
    final result = await staffEdit(
      context,
      title: widget.title,
      fields: widget.fields,
      initial: {
        ...widget.defaults,
        ...?row,
        if (row != null && widget.initial != null) ...widget.initial!(row),
      },
      save: (values) async {
        final body = widget.prepare?.call(values, row) ?? values;
        await widget.api.request(
          row == null
              ? widget.path
              : '${widget.path}/${Uri.encodeComponent('${row['id']}')}',
          method: row == null ? 'POST' : 'PUT',
          body: body,
        );
      },
    );
    if (result == true && mounted) unawaited(_load());
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    if (!widget.canEdit || widget.deletePath == null) return;
    final result = await staffEdit(
      context,
      title: staffText(
        'Удалить запись?',
        'Жазбаны жою керек пе?',
        'Delete record?',
      ),
      description: '${row[widget.titleKey]}',
      fields: [],
      submitLabel: staffText('Удалить', 'Жою', 'Delete'),
      save: (_) async {
        await widget.api.request(widget.deletePath!(row), method: 'DELETE');
      },
    );
    if (result == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows
        .where(
          (row) =>
              '${row[widget.titleKey]} ${widget.facts.keys.map((key) => row[key]).join(' ')}'
                  .toLowerCase()
                  .contains(_search.toLowerCase()),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (widget.canEdit && widget.canCreate)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: FilledButton.icon(
                onPressed: () => _edit(),
                icon: const Icon(Icons.add),
                label: Text(staffText('Добавить', 'Қосу', 'Add')),
              ),
            ),
          TextField(
            decoration: InputDecoration(
              labelText: staffText('Поиск', 'Іздеу', 'Search'),
              prefixIcon: const Icon(Icons.search),
            ),
            onChanged: (value) => setState(() => _search = value),
          ),
          const SizedBox(height: 16),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) _StaffError(message: _error!, onRetry: _load),
          if (!_loading && rows.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                staffText('Записей нет', 'Жазбалар жоқ', 'No records'),
                textAlign: TextAlign.center,
              ),
            ),
          for (final row in rows)
            Card(
              margin: const EdgeInsets.symmetric(vertical: 8),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      row[widget.titleKey] is Map
                          ? staffLocalized(row[widget.titleKey])
                          : '${row[widget.titleKey] ?? '—'}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    StaffFacts({
                      for (final entry in widget.facts.entries)
                        entry.value: row[entry.key] is bool
                            ? ((row[entry.key] == true)
                                  ? staffText('Да', 'Иә', 'Yes')
                                  : staffText('Нет', 'Жоқ', 'No'))
                            : '${row[entry.key] ?? '—'}',
                    }),
                    Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      children: [
                        if (widget.canEdit)
                          OutlinedButton.icon(
                            onPressed: () => _edit(row),
                            icon: const Icon(Icons.edit_outlined),
                            label: Text(
                              staffText('Изменить', 'Өзгерту', 'Edit'),
                            ),
                          ),
                        if (widget.canEdit && widget.deletePath != null)
                          TextButton(
                            onPressed: () => _delete(row),
                            child: Text(staffText('Удалить', 'Жою', 'Delete')),
                          ),
                        ...?widget.onExtra?.call(context, row, () => _load()),
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

  @override
  void dispose() {
    _generation++;
    _live.dispose();
    super.dispose();
  }
}

class StaffCouriers extends StatelessWidget {
  const StaffCouriers({required this.api, required this.canEdit, super.key});
  final StaffApiClient api;
  final bool canEdit;
  @override
  Widget build(BuildContext context) => StaffResource(
    api: api,
    path: '/couriers',
    listKey: 'couriers',
    title: staffText('Курьер', 'Курьер', 'Courier'),
    titleKey: 'name',
    canEdit: canEdit,
    defaults: const {'active': true, 'transportType': 'car', 'phone': '+7'},
    fields: [
      StaffField(
        'name',
        staffText('Имя', 'Аты', 'Name'),
        required: true,
        maxLength: 160,
      ),
      StaffField(
        'phone',
        staffText('Телефон', 'Телефон', 'Phone'),
        type: 'phone',
        required: true,
        maxLength: 32,
      ),
      StaffField(
        'vehicle',
        staffText('Машина и номер', 'Көлік пен нөмірі', 'Vehicle and plate'),
        maxLength: 80,
      ),
      StaffField(
        'transportType',
        staffText('Транспорт', 'Көлік', 'Transport'),
        options: {
          'car': staffText('Автомобиль', 'Автокөлік', 'Car'),
          'motorcycle': staffText('Мотоцикл', 'Мотоцикл', 'Motorcycle'),
          'bicycle': staffText('Велосипед', 'Велосипед', 'Bicycle'),
          'foot': staffText('Пешком', 'Жаяу', 'On foot'),
        },
      ),
      StaffField(
        'active',
        staffText('Активен', 'Белсенді', 'Active'),
        type: 'bool',
      ),
    ],
    facts: {
      'phone': staffText('Телефон', 'Телефон', 'Phone'),
      'vehicle': staffText('Машина', 'Көлік', 'Vehicle'),
      'active': staffText('Активен', 'Белсенді', 'Active'),
    },
    onExtra: (context, row, refresh) => [
      if (canEdit && '${row['accessUrl'] ?? ''}'.isNotEmpty)
        OutlinedButton.icon(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: '${row['accessUrl']}'));
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    staffText(
                      'Ссылка скопирована',
                      'Сілтеме көшірілді',
                      'Link copied',
                    ),
                  ),
                ),
              );
            }
          },
          icon: const Icon(Icons.copy),
          label: Text(
            staffText(
              'Ссылка для курьера',
              'Курьер сілтемесі',
              'Courier access link',
            ),
          ),
        ),
      OutlinedButton.icon(
        onPressed: () async {
          try {
            final result = await api.request(
              '/couriers/${Uri.encodeComponent('${row['id']}')}/activity',
            );
            if (!context.mounted) return;
            await showDialog<void>(
              context: context,
              builder: (dialogContext) => BulkaActionDialog(
                title: Text(
                  staffText(
                    'Активность курьера',
                    'Курьер белсенділігі',
                    'Courier activity',
                  ),
                ),
                content: SizedBox(
                  width: 500,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (final event in staffRows(result['activity']))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              '${event['action'] ?? event['type'] ?? '—'}',
                            ),
                            subtitle: Text(
                              staffDate(
                                event['createdAt'] ?? event['created_at'],
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: Text(staffText('Закрыть', 'Жабу', 'Close')),
                  ),
                ],
              ),
            );
          } catch (e) {
            if (context.mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text('$e')));
            }
          }
        },
        icon: const Icon(Icons.history),
        label: Text(staffText('История', 'Тарих', 'History')),
      ),
      if (canEdit)
        TextButton(
          onPressed: () async {
            await staffEdit(
              context,
              title: staffText(
                'Завершить сессии курьера?',
                'Курьер сеанстарын аяқтау керек пе?',
                'Revoke courier sessions?',
              ),
              description: '${row['name']}',
              fields: [],
              save: (_) async {
                await api.request(
                  '/couriers/${Uri.encodeComponent('${row['id']}')}/revoke-sessions',
                  method: 'POST',
                );
              },
            );
          },
          child: Text(
            staffText(
              'Завершить сессии',
              'Сеанстарды аяқтау',
              'Revoke sessions',
            ),
          ),
        ),
    ],
  );
}

class StaffInventory extends StatefulWidget {
  const StaffInventory({required this.api, required this.role, super.key});
  final StaffApiClient api;
  final String role;
  @override
  State<StaffInventory> createState() => _StaffInventoryState();
}

class _StaffInventoryState extends State<StaffInventory> {
  List<Map<String, dynamic>> _rows = [];
  String _search = '';
  bool _stopped = false, _loading = false;
  String? _error;
  late final StaffLiveRefresh _live;
  bool get _cashier => widget.role == 'cashier';
  bool get _canEdit =>
      _cashier ||
      ['owner', 'admin', 'branch_manager', 'editor'].contains(widget.role);
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['inventory.updated', 'menu.updated'],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(
        _cashier ? '/staff/catalog' : '/inventory',
      );
      if (mounted) {
        setState(() {
          _rows = staffRows(result[_cashier ? 'products' : 'inventory']);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit(Map<String, dynamic> row) async {
    if (!_canEdit) return;
    final saved = await staffEdit(
      context,
      title:
          '${row[_cashier ? 'name' : 'product_name'] ?? row['productName'] ?? '—'}',
      fields: [
        StaffField(
          'sourceQuantity',
          staffText('Доступно, шт.', 'Қолжетімді, дана', 'Available quantity'),
          type: 'number',
          minimum: 0,
          maximum: 100000,
          hint: staffText(
            'Пусто — без ограничения',
            'Бос — шектеусіз',
            'Empty means unlimited',
          ),
        ),
        StaffField(
          'manualStop',
          staffText('В стоп-листе', 'Стоп-тізімде', 'Stop selling'),
          type: 'bool',
        ),
        if (!_cashier)
          StaffField(
            'preparationMinutes',
            staffText(
              'Приготовление, мин',
              'Дайындау, мин',
              'Preparation, min',
            ),
            type: 'number',
            minimum: 1,
            maximum: 240,
          ),
      ],
      initial: {
        'sourceQuantity': row['source_quantity'] ?? row['sourceQuantity'],
        'manualStop': row['manual_stop'] ?? row['manualStop'],
        'preparationMinutes': row['preparation_minutes'],
      },
      save: (values) async {
        for (final key in ['sourceQuantity', 'preparationMinutes']) {
          final value = values[key];
          if (value is num && value != value.roundToDouble()) {
            throw Exception(
              staffText(
                'Введите целое число',
                'Бүтін сан енгізіңіз',
                'Enter a whole number',
              ),
            );
          }
        }
        await widget.api.request(
          _cashier
              ? '/staff/catalog/${Uri.encodeComponent('${row['id']}')}'
              : '/inventory/${Uri.encodeComponent('${row['branch_id']}')}/${Uri.encodeComponent('${row['product_id']}')}',
          method: _cashier ? 'PATCH' : 'PUT',
          body: values,
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows
        .where(
          (row) =>
              '${row['product_name'] ?? row['name'] ?? row['productName']}'
                  .toLowerCase()
                  .contains(_search.toLowerCase()) &&
              (!_stopped ||
                  row['manual_stop'] == true ||
                  row['manualStop'] == true),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          TextField(
            decoration: InputDecoration(
              labelText: staffText(
                'Найти товар',
                'Тауар іздеу',
                'Find product',
              ),
              prefixIcon: const Icon(Icons.search),
            ),
            onChanged: (value) => setState(() => _search = value),
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: Text(
              staffText(
                'Только стоп-лист',
                'Тек стоп-тізім',
                'Stopped products only',
              ),
            ),
            value: _stopped,
            onChanged: (value) => setState(() => _stopped = value),
          ),
          if (_canEdit && !_cashier)
            OutlinedButton.icon(
              onPressed: () async {
                final saved = await staffEdit(
                  context,
                  title: staffText(
                    'Обновить остатки из iiko?',
                    'iiko қалдықтарын жаңарту керек пе?',
                    'Sync inventory from iiko?',
                  ),
                  fields: [],
                  save: (_) async {
                    await widget.api.request('/inventory/sync', method: 'POST');
                  },
                );
                if (saved == true && mounted) unawaited(_load());
              },
              icon: const Icon(Icons.sync),
              label: Text(
                staffText('Синхронизировать', 'Синхрондау', 'Synchronize'),
              ),
            ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) _StaffError(message: _error!, onRetry: _load),
          for (final row in rows)
            Card(
              child: ListTile(
                isThreeLine: true,
                title: Text(
                  '${row['product_name'] ?? row['name'] ?? row['productName'] ?? '—'}',
                ),
                subtitle: Text(
                  '${(row['bulka_locations'] as Map?)?['name'] ?? ''}\n${staffText('Остаток', 'Қалдық', 'Quantity')}: ${row['source_quantity'] ?? row['sourceQuantity'] ?? '∞'} · ${(row['manual_stop'] == true || row['manualStop'] == true) ? staffText('Стоп', 'Стоп', 'Stopped') : staffText('В продаже', 'Сатылымда', 'Available')}',
                ),
                trailing: _canEdit ? const Icon(Icons.edit_outlined) : null,
                onTap: _canEdit ? () => _edit(row) : null,
              ),
            ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }
}
