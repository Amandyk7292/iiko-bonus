part of '../main.dart';

class StaffProductOptions extends StatefulWidget {
  const StaffProductOptions({
    required this.api,
    required this.id,
    required this.name,
    super.key,
  });
  final StaffApiClient api;
  final String id, name;
  @override
  State<StaffProductOptions> createState() => _StaffProductOptionsState();
}

class _StaffProductOptionsState extends State<StaffProductOptions> {
  Map<String, dynamic> _configuration = {
    'productKind': 'standard',
    'enabled': false,
    'allowInscription': false,
    'inscriptionMaxLength': 80,
    'allowCandles': false,
    'allowReferenceUpload': false,
    'minLeadHours': 24,
    'maxAdvanceDays': 30,
    'weightOptions': <Map<String, dynamic>>[],
    'fillingOptions': <Map<String, dynamic>>[],
    'designOptions': <Map<String, dynamic>>[],
  };
  List<Map<String, dynamic>> _groups = [];
  bool _loading = true, _busy = false;
  String? _error;
  String? _baseline;
  bool _allowClose = false;
  String get _snapshot => jsonEncode([_configuration, _groups]);
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final result = await widget.api.request(
        '/menu/product-options?ids=${Uri.encodeQueryComponent(widget.id)}',
      );
      final data = (result['products'] as Map?)?[widget.id] as Map? ?? {};
      if (mounted) {
        setState(() {
          _configuration = {
            ..._configuration,
            ...Map<String, dynamic>.from((data['configuration'] as Map?) ?? {}),
          };
          _groups = staffRows(data['modifierGroups']);
          _baseline = _snapshot;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _configurationEdit() async {
    await staffEdit(
      context,
      title: staffText(
        'Конструктор товара',
        'Тауар конструкторы',
        'Product builder',
      ),
      fields: [
        StaffField(
          'productKind',
          staffText('Тип товара', 'Тауар түрі', 'Product kind'),
          options: {
            'standard': staffText('Обычный', 'Қалыпты', 'Standard'),
            'cake': staffText('Торт', 'Торт', 'Cake'),
            'bakery': staffText('Выпечка', 'Пісірме', 'Bakery'),
          },
        ),
        for (final field in {
          'enabled': staffText(
            'Конструктор включён',
            'Конструктор қосылған',
            'Builder enabled',
          ),
          'allowInscription': staffText(
            'Разрешить надпись',
            'Жазуға рұқсат',
            'Allow inscription',
          ),
          'allowCandles': staffText(
            'Предлагать свечи',
            'Шамдар ұсыну',
            'Offer candles',
          ),
          'allowReferenceUpload': staffText(
            'Разрешить фото-пример',
            'Үлгі фотоға рұқсат',
            'Allow reference image',
          ),
        }.entries)
          StaffField(field.key, field.value, type: 'bool'),
        StaffField(
          'inscriptionMaxLength',
          staffText(
            'Максимум символов надписи',
            'Жазу таңбаларының шегі',
            'Inscription character limit',
          ),
          type: 'number',
          required: true,
          minimum: 1,
          maximum: 500,
        ),
        StaffField(
          'minLeadHours',
          staffText(
            'Заказать заранее, часов',
            'Алдын ала тапсырыс, сағат',
            'Minimum lead time, hours',
          ),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 8760,
        ),
        StaffField(
          'maxAdvanceDays',
          staffText(
            'Максимум заранее, дней',
            'Алдын ала ең көп, күн',
            'Maximum advance, days',
          ),
          type: 'number',
          required: true,
          minimum: 1,
          maximum: 365,
        ),
      ],
      initial: _configuration,
      save: (values) async {
        setState(() => _configuration = {..._configuration, ...values});
      },
    );
  }

  Map<String, dynamic> _localizedInitial(Map<String, dynamic> value) => {
    ...value,
    for (final language in ['ru', 'kk', 'en'])
      'title.$language':
          (value['title'] as Map?)?[language] ?? value['name'] ?? '',
  };
  Map<String, dynamic> _localizedValues(Map<String, dynamic> values) {
    values['title'] = {
      for (final language in ['ru', 'kk', 'en'])
        language: values.remove('title.$language'),
    };
    return values;
  }

  List<StaffField> get _titles => [
    for (final language in ['ru', 'kk', 'en'])
      StaffField(
        'title.$language',
        '${staffText('Название', 'Атауы', 'Title')} · ${language.toUpperCase()}',
        required: true,
        maxLength: 160,
      ),
  ];
  Future<void> _group([int? index]) async {
    final row = index == null
        ? <String, dynamic>{
            'code': staffRequestId(),
            'selectionType': 'single',
            'required': false,
            'minSelected': 0,
            'maxSelected': 1,
            'active': true,
            'sortOrder': _groups.length,
            'options': <Map<String, dynamic>>[],
          }
        : _groups[index];
    await staffEdit(
      context,
      title: staffText(
        'Группа модификаторов',
        'Модификаторлар тобы',
        'Modifier group',
      ),
      fields: [
        StaffField(
          'code',
          staffText('Код группы', 'Топ коды', 'Group code'),
          required: true,
        ),
        ..._titles,
        StaffField(
          'selectionType',
          staffText('Выбор', 'Таңдау', 'Selection'),
          options: {
            'single': staffText('Один вариант', 'Бір нұсқа', 'Single'),
            'multiple': staffText('Несколько', 'Бірнеше', 'Multiple'),
          },
        ),
        StaffField(
          'required',
          staffText('Обязательно', 'Міндетті', 'Required'),
          type: 'bool',
        ),
        StaffField(
          'active',
          staffText('Активна', 'Белсенді', 'Active'),
          type: 'bool',
        ),
        StaffField(
          'minSelected',
          staffText(
            'Минимум вариантов',
            'Ең аз нұсқалар',
            'Minimum selections',
          ),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 100,
        ),
        StaffField(
          'maxSelected',
          staffText(
            'Максимум вариантов',
            'Ең көп нұсқалар',
            'Maximum selections',
          ),
          type: 'number',
          required: true,
          minimum: 1,
          maximum: 100,
        ),
        StaffField(
          'sortOrder',
          staffText('Порядок', 'Реті', 'Order'),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 1000000,
        ),
      ],
      initial: _localizedInitial(row),
      save: (values) async {
        if ((values['minSelected'] as num) > (values['maxSelected'] as num)) {
          throw Exception(
            staffText(
              'Минимум больше максимума',
              'Минимум максимумнан үлкен',
              'Minimum exceeds maximum',
            ),
          );
        }
        final next = {...row, ..._localizedValues(values)}
          ..removeWhere(
            (key, _) => !{
              'id',
              'groupId',
              'code',
              'title',
              'name',
              'priceDelta',
              'isDefault',
              'active',
              'sortOrder',
            }.contains(key),
          );
        setState(() {
          if (index == null) {
            _groups.add(next);
          } else {
            _groups[index] = next;
          }
        });
      },
    );
  }

  Future<void> _option(
    String? configurationKey,
    int? groupIndex, [
    int? index,
  ]) async {
    final options = staffRows(
      configurationKey != null
          ? _configuration[configurationKey]
          : _groups[groupIndex!]['options'],
    );
    final row = index == null
        ? <String, dynamic>{
            'code': staffRequestId(),
            'priceDelta': 0,
            'isDefault': false,
            'active': true,
            'sortOrder': options.length,
          }
        : options[index];
    await staffEdit(
      context,
      title: staffText('Вариант', 'Нұсқа', 'Option'),
      fields: [
        StaffField(
          'code',
          staffText('Код варианта', 'Нұсқа коды', 'Option code'),
          required: true,
        ),
        ..._titles,
        StaffField(
          'priceDelta',
          staffText('Доплата, ₸', 'Қосымша төлем, ₸', 'Extra charge, ₸'),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 10000000,
        ),
        StaffField(
          'isDefault',
          staffText(
            'Выбран по умолчанию',
            'Әдепкі бойынша таңдалған',
            'Selected by default',
          ),
          type: 'bool',
        ),
        StaffField(
          'active',
          staffText('Активен', 'Белсенді', 'Active'),
          type: 'bool',
        ),
        StaffField(
          'sortOrder',
          staffText('Порядок', 'Реті', 'Order'),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 1000000,
        ),
      ],
      initial: _localizedInitial(row),
      save: (values) async {
        final next = {...row, ..._localizedValues(values)}
          ..removeWhere(
            (key, _) => !{
              'id',
              'groupId',
              'code',
              'title',
              'name',
              'priceDelta',
              'isDefault',
              'active',
              'sortOrder',
            }.contains(key),
          );
        if (index == null) {
          options.add(next);
        } else {
          options[index] = next;
        }
        setState(() {
          if (configurationKey != null) {
            _configuration[configurationKey] = options;
          } else {
            _groups[groupIndex!]['options'] = options;
          }
        });
      },
    );
  }

  Widget _options(String? key, int? group) => Column(
    children: [
      for (final (index, row) in staffRows(
        key != null ? _configuration[key] : _groups[group!]['options'],
      ).indexed)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            '${(row['title'] as Map?)?[AppLang.current] ?? (row['title'] as Map?)?['ru'] ?? row['name'] ?? row['code']}',
          ),
          subtitle: Text('+ ${staffMoney(row['priceDelta'])}'),
          onTap: _busy ? null : () => _option(key, group, index),
          trailing: IconButton(
            tooltip: staffText(
              'Удалить вариант',
              'Нұсқаны жою',
              'Delete option',
            ),
            onPressed: _busy
                ? null
                : () => setState(() {
                    final options = staffRows(
                      key != null
                          ? _configuration[key]
                          : _groups[group!]['options'],
                    )..removeAt(index);
                    if (key != null) {
                      _configuration[key] = options;
                    } else {
                      _groups[group!]['options'] = options;
                    }
                  }),
            icon: const Icon(Icons.delete_outline),
          ),
        ),
      OutlinedButton.icon(
        onPressed: _busy ? null : () => _option(key, group),
        icon: const Icon(Icons.add),
        label: Text(staffText('Добавить вариант', 'Нұсқа қосу', 'Add option')),
      ),
    ],
  );
  Future<void> _save() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      for (final group in _groups) {
        if (staffRows(group['options']).isEmpty) {
          throw Exception(
            staffText(
              'Добавьте вариант в каждую группу',
              'Әр топқа нұсқа қосыңыз',
              'Add an option to each group',
            ),
          );
        }
      }
      await widget.api.request(
        '/menu/product-options/${Uri.encodeComponent(widget.id)}',
        method: 'PUT',
        body: {'configuration': _configuration, 'modifierGroups': _groups},
      );
      if (mounted) {
        setState(() {
          _allowClose = true;
          _baseline = _snapshot;
        });
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop:
        !_busy && (_allowClose || _baseline == null || _baseline == _snapshot),
    onPopInvokedWithResult: (didPop, result) async {
      if (didPop || _busy) return;
      if (await staffConfirmDiscard(context) && mounted) {
        setState(() => _allowClose = true);
        await Future<void>.delayed(Duration.zero);
        if (context.mounted) Navigator.pop(context);
      }
    },
    child: Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (!_loading) ...[
            OutlinedButton(
              onPressed: _busy ? null : _configurationEdit,
              child: Text(
                staffText(
                  'Настроить конструктор',
                  'Конструкторды баптау',
                  'Configure product builder',
                ),
              ),
            ),
            for (final entry in {
              'weightOptions': staffText('Вес', 'Салмақ', 'Weight'),
              'fillingOptions': staffText('Начинка', 'Салма', 'Filling'),
              'designOptions': staffText('Оформление', 'Безендіру', 'Design'),
            }.entries)
              Card(
                child: ExpansionTile(
                  title: Text(entry.value),
                  childrenPadding: const EdgeInsets.all(16),
                  children: [_options(entry.key, null)],
                ),
              ),
            const SizedBox(height: 20),
            Text(
              staffText('Модификаторы', 'Модификаторлар', 'Modifiers'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            for (final (index, group) in _groups.indexed)
              Card(
                child: ExpansionTile(
                  title: Text(
                    '${(group['title'] as Map?)?[AppLang.current] ?? (group['title'] as Map?)?['ru'] ?? group['code']}',
                  ),
                  childrenPadding: const EdgeInsets.all(16),
                  children: [
                    Wrap(
                      spacing: 12,
                      children: [
                        TextButton(
                          onPressed: _busy ? null : () => _group(index),
                          child: Text(
                            staffText(
                              'Настройки группы',
                              'Топ баптаулары',
                              'Group settings',
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => setState(() => _groups.removeAt(index)),
                          child: Text(
                            staffText(
                              'Удалить группу',
                              'Топты жою',
                              'Delete group',
                            ),
                          ),
                        ),
                      ],
                    ),
                    _options(null, index),
                  ],
                ),
              ),
            if (_groups.length < 50)
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _group(),
                icon: const Icon(Icons.add),
                label: Text(
                  staffText('Добавить группу', 'Топ қосу', 'Add group'),
                ),
              ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      staffText(
                        'Сохранить изменения',
                        'Өзгерістерді сақтау',
                        'Save changes',
                      ),
                    ),
            ),
          ],
        ],
      ),
    ),
  );
}
