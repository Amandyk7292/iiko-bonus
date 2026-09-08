part of '../main.dart';

Future<String?> staffPickImage(StaffApiClient api, {bool tier = false}) async {
  final file = await ImagePicker().pickImage(
    source: ImageSource.gallery,
    imageQuality: 92,
    maxWidth: 2048,
    maxHeight: 2048,
  );
  if (file == null) return null;
  final result = await api.uploadImage(
    tier ? '/loyalty-tiers/upload-image' : '/menu/upload-image',
    await file.readAsBytes(),
    file.name,
  );
  if (result['imageUrl'] == null) {
    throw Exception(
      staffText(
        'Не удалось загрузить изображение',
        'Суретті жүктеу мүмкін болмады',
        'Image upload failed',
      ),
    );
  }
  return '${result['imageUrl']}';
}

Map<String, String> staffFulfillmentTypes() => {
  'pickup': staffText('Самовывоз', 'Өзімен алып кету', 'Pickup'),
  'delivery': staffText('Доставка', 'Жеткізу', 'Delivery'),
  'preorder': staffText('Предзаказ', 'Алдын ала тапсырыс', 'Preorder'),
};

class StaffMenu extends StatefulWidget {
  const StaffMenu({required this.api, required this.role, super.key});
  final StaffApiClient api;
  final String role;
  @override
  State<StaffMenu> createState() => _StaffMenuState();
}

class _StaffMenuState extends State<StaffMenu> {
  List<Map<String, dynamic>> _products = [], _groups = [], _custom = [];
  Map<String, Map<String, dynamic>> _productOverrides = {},
      _categoryOverrides = {};
  String _tab = 'products', _search = '', _category = '';
  bool _loading = false;
  String? _error;
  int _visible = 50;
  late final StaffLiveRefresh _live;
  bool get _canEdit =>
      ['owner', 'admin', 'branch_manager', 'editor'].contains(widget.role);
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['menu.updated', 'inventory.updated'],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request('/menu');
      final raw = result['rawMenu'] as Map? ?? {};
      final overrides = result['overrides'] as Map? ?? {};
      if (mounted) {
        setState(() {
          _products = staffRows(raw['products']);
          _groups = staffRows(raw['groups']);
          _custom = staffRows(overrides['customProducts']);
          _productOverrides = {
            for (final row in staffRows(overrides['products']))
              '${row['iiko_product_id']}': row,
          };
          _categoryOverrides = {
            for (final row in staffRows(overrides['categories']))
              '${row['iiko_category_id']}': row,
          };
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, dynamic> _override(Map<String, dynamic> row) =>
      _tab == 'categories'
      ? (_categoryOverrides['${row['id']}'] ?? {})
      : (_productOverrides['${row['id']}'] ?? {});
  String _name(Map<String, dynamic> row) =>
      '${_override(row)['custom_name'] ?? row['name'] ?? '—'}';
  Future<void> _sync() async {
    if (!_canEdit) return;
    final saved = await staffEdit(
      context,
      title: staffText(
        'Синхронизировать меню iiko?',
        'iiko мәзірін синхрондау керек пе?',
        'Synchronize iiko menu?',
      ),
      fields: [],
      save: (_) async {
        await widget.api.request('/menu/sync', method: 'POST', body: {});
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  List<StaffField> _localizedFields(
    String prefix,
    String label,
    int length,
  ) => [
    for (final language in ['ru', 'kk', 'en'])
      StaffField(
        '$prefix.$language',
        '$label · ${language.toUpperCase()}',
        type: prefix.contains('description') || prefix.contains('ingredients')
            ? 'multiline'
            : 'text',
        maxLength: length,
        translateFrom: language == 'ru' ? null : '$prefix.ru',
        translate: language == 'ru'
            ? null
            : (text) async {
                final result = await widget.api.request(
                  '/translate',
                  method: 'POST',
                  body: {'text': text, 'targetLang': language},
                );
                return '${result['translated'] ?? ''}';
              },
      ),
  ];
  Future<void> _edit(Map<String, dynamic> row) async {
    if (!_canEdit) return;
    final category = _tab == 'categories';
    final override = _override(row);
    final fields = [
      StaffField(
        'custom_name',
        staffText('Название', 'Атауы', 'Name'),
        maxLength: 160,
      ),
      ..._localizedFields(
        'name_translations',
        staffText('Название', 'Атауы', 'Name'),
        160,
      ),
      if (!category) ...[
        StaffField(
          'custom_description',
          staffText('Описание', 'Сипаттама', 'Description'),
          type: 'multiline',
          maxLength: 2000,
        ),
        ..._localizedFields(
          'description_translations',
          staffText('Описание', 'Сипаттама', 'Description'),
          2000,
        ),
        StaffField(
          'custom_price',
          staffText('Своя цена, ₸', 'Жеке баға, ₸', 'Price override, ₸'),
          type: 'number',
          minimum: 1,
          maximum: 10000000,
          hint: staffText(
            'Пусто — цена iiko',
            'Бос — iiko бағасы',
            'Empty uses iiko price',
          ),
        ),
        StaffField(
          'preparation_minutes',
          staffText('Приготовление, мин', 'Дайындау, мин', 'Preparation, min'),
          type: 'number',
          minimum: 1,
          maximum: 240,
        ),
        StaffField(
          'is_stop_listed',
          staffText('Стоп-лист', 'Стоп-тізім', 'Stop list'),
          type: 'bool',
        ),
        StaffField(
          'fulfillment_types',
          staffText('Способы получения', 'Алу тәсілдері', 'Fulfillment types'),
          type: 'multi',
          options: staffFulfillmentTypes(),
        ),
      ],
      StaffField(
        'custom_image_url',
        staffText('Изображение', 'Сурет', 'Image'),
        pick: () => staffPickImage(widget.api),
      ),
      StaffField(
        'sort_order',
        staffText('Порядок', 'Реті', 'Order'),
        type: 'number',
        minimum: 0,
        maximum: 1000000,
        required: true,
      ),
      StaffField(
        'is_hidden',
        staffText(
          'Скрыть от клиентов',
          'Клиенттерден жасыру',
          'Hide from customers',
        ),
        type: 'bool',
      ),
    ];
    final initial = <String, dynamic>{
      ...override,
      'sort_order': override['sort_order'] ?? 0,
      'fulfillment_types':
          override['fulfillment_types'] ?? ['pickup', 'delivery', 'preorder'],
    };
    for (final prefix in ['name_translations', 'description_translations']) {
      for (final language in ['ru', 'kk', 'en']) {
        initial['$prefix.$language'] =
            (override[prefix] as Map?)?[language] ?? '';
      }
    }
    final saved = await staffEdit(
      context,
      title: _name(row),
      fields: fields,
      initial: initial,
      save: (values) async {
        for (final prefix in [
          'name_translations',
          if (!category) 'description_translations',
        ]) {
          values[prefix] = {
            for (final language in ['ru', 'kk', 'en'])
              language: values.remove('$prefix.$language'),
          };
        }
        for (final key in [
          'custom_name',
          'custom_description',
          'custom_image_url',
        ]) {
          if (values[key] == '') values[key] = null;
        }
        if (category) values.remove('custom_description');
        await widget.api.request(
          '/menu/${category ? 'category' : 'product'}/override',
          method: 'POST',
          body: {
            category ? 'iikoCategoryId' : 'iikoProductId': row['id'],
            'overrides': values,
          },
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  List<StaffField> _factsFields() => [
    StaffField(
      'ingredients',
      staffText('Состав', 'Құрамы', 'Ingredients'),
      type: 'multiline',
      maxLength: 3000,
    ),
    ..._localizedFields(
      'ingredients_translations',
      staffText('Состав', 'Құрамы', 'Ingredients'),
      3000,
    ),
    for (final entry in {
      'allergens': staffText(
        'Аллергены через запятую',
        'Аллергендер үтір арқылы',
        'Allergens, comma separated',
      ),
      'dietary_tags': staffText(
        'Метки питания через запятую',
        'Тағам белгілері үтір арқылы',
        'Dietary tags, comma separated',
      ),
      'search_keywords': staffText(
        'Поисковые слова через запятую',
        'Іздеу сөздері үтір арқылы',
        'Search keywords, comma separated',
      ),
    }.entries)
      StaffField(entry.key, entry.value, type: 'multiline'),
    for (final entry in {
      'weight_grams': staffText('Вес, г', 'Салмағы, г', 'Weight, g'),
      'calories_kcal': staffText(
        'Калории, ккал',
        'Калория, ккал',
        'Calories, kcal',
      ),
      'protein_grams': staffText('Белки, г', 'Ақуыз, г', 'Protein, g'),
      'fat_grams': staffText('Жиры, г', 'Май, г', 'Fat, g'),
      'carbs_grams': staffText('Углеводы, г', 'Көмірсу, г', 'Carbohydrates, g'),
    }.entries)
      StaffField(
        entry.key,
        entry.value,
        type: 'number',
        minimum: entry.key == 'weight_grams' ? 1 : 0,
        maximum: 100000,
      ),
    for (var i = 0; i < 2; i) ...[
      StaffField(
        'storage$i.temperature',
        '${staffText('Температура хранения', 'Сақтау температурасы', 'Storage temperature')} ${i + 1}',
        maxLength: 40,
      ),
      StaffField(
        'storage$i.duration_value',
        '${staffText('Срок хранения', 'Сақтау мерзімі', 'Storage duration')} ${i + 1}',
        type: 'number',
        minimum: 1,
        maximum: 10000,
      ),
      StaffField(
        'storage$i.duration_unit',
        staffText('Единица срока', 'Мерзім бірлігі', 'Duration unit'),
        options: {
          'days': staffText('Дни', 'Күндер', 'Days'),
          'hours': staffText('Часы', 'Сағат', 'Hours'),
          'months': staffText('Месяцы', 'Айлар', 'Months'),
        },
      ),
    ],
  ];
  Map<String, dynamic> _factsInitial(Map<String, dynamic> row) {
    final initial = Map<String, dynamic>.from(row);
    for (final key in ['allergens', 'dietary_tags', 'search_keywords']) {
      if (row[key] is List) initial[key] = (row[key] as List).join(', ');
    }
    for (final language in ['ru', 'kk', 'en']) {
      initial['ingredients_translations.$language'] =
          (row['ingredients_translations'] as Map?)?[language] ?? '';
    }
    final conditions = staffRows(row['storage_conditions']);
    for (var i = 0; i < 2; i++) {
      for (final field in ['temperature', 'duration_value', 'duration_unit']) {
        initial['storage$i.$field'] = i < conditions.length
            ? conditions[i][field]
            : null;
      }
    }
    return initial;
  }

  Map<String, dynamic> _factsValues(Map<String, dynamic> values) {
    values['ingredients_translations'] = {
      for (final language in ['ru', 'kk', 'en'])
        language: values.remove('ingredients_translations.$language'),
    };
    for (final key in ['allergens', 'dietary_tags', 'search_keywords']) {
      values[key] = '${values[key] ?? ''}'
          .split(',')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
    }
    final conditions = <Map<String, dynamic>>[];
    for (var i = 0; i < 2; i++) {
      final temperature = values.remove('storage$i.temperature');
      final duration = values.remove('storage$i.duration_value');
      final unit = values.remove('storage$i.duration_unit');
      if ('$temperature'.trim().isNotEmpty &&
          temperature != null &&
          duration != null) {
        conditions.add({
          'temperature': temperature,
          'duration_value': duration,
          'duration_unit': unit,
        });
      }
    }
    values['storage_conditions'] = conditions;
    return values;
  }

  Future<void> _facts(Map<String, dynamic> row) async {
    if (!_canEdit) return;
    final override = _override(row);
    final saved = await staffEdit(
      context,
      title: staffText(
        'Состав и хранение',
        'Құрамы мен сақталуы',
        'Ingredients and storage',
      ),
      fields: _factsFields(),
      initial: _factsInitial(override),
      save: (values) async {
        await widget.api.request(
          '/menu/product/override',
          method: 'POST',
          body: {'iikoProductId': row['id'], 'overrides': _factsValues(values)},
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _customEdit([Map<String, dynamic>? row]) async {
    if (!_canEdit) return;
    final saved = await staffEdit(
      context,
      title: staffText('Свой товар', 'Жеке тауар', 'Custom product'),
      fields: [
        StaffField(
          'name',
          staffText('Название', 'Атауы', 'Name'),
          required: true,
          maxLength: 160,
        ),
        StaffField(
          'description',
          staffText('Описание', 'Сипаттама', 'Description'),
          type: 'multiline',
          maxLength: 2000,
        ),
        StaffField(
          'price',
          staffText('Цена, ₸', 'Баға, ₸', 'Price, ₸'),
          type: 'number',
          required: true,
          minimum: 1,
          maximum: 10000000,
        ),
        StaffField(
          'category_name',
          staffText('Категория', 'Санат', 'Category'),
          required: true,
          maxLength: 160,
        ),
        StaffField(
          'image_url',
          staffText('Изображение', 'Сурет', 'Image'),
          pick: () => staffPickImage(widget.api),
        ),
        StaffField(
          'is_available',
          staffText('В продаже', 'Сатылымда', 'Available'),
          type: 'bool',
        ),
        StaffField(
          'sort_order',
          staffText('Порядок', 'Реті', 'Order'),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 1000000,
        ),
        StaffField(
          'preparation_minutes',
          staffText('Приготовление, мин', 'Дайындау, мин', 'Preparation, min'),
          type: 'number',
          minimum: 1,
          maximum: 240,
        ),
        StaffField(
          'fulfillment_types',
          staffText('Способы получения', 'Алу тәсілдері', 'Fulfillment types'),
          type: 'multi',
          options: staffFulfillmentTypes(),
        ),
        ..._factsFields(),
      ],
      initial: {
        'is_available': true,
        'sort_order': 0,
        'fulfillment_types': ['pickup', 'delivery', 'preorder'],
        ..._factsInitial(row ?? {}),
      },
      save: (values) async {
        final body = _factsValues(values);
        if (row != null) body['id'] = row['id'];
        if (body['image_url'] == '') body['image_url'] = null;
        await widget.api.request(
          '/menu/custom-product',
          method: 'POST',
          body: body,
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    if (widget.role == 'cashier') {
      return StaffInventory(api: widget.api, role: widget.role);
    }
    final source = _tab == 'categories'
        ? _groups
        : _tab == 'custom'
        ? _custom
        : _products;
    final rows = source
        .where(
          (row) =>
              (_tab == 'custom' ? '${row['name']}' : _name(row))
                  .toLowerCase()
                  .contains(_search.toLowerCase()) &&
              (_category.isEmpty ||
                  _tab != 'products' ||
                  row['parentGroup'] == _category),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              for (final tab in {
                'products': staffText('Товары', 'Тауарлар', 'Products'),
                'categories': staffText('Категории', 'Санаттар', 'Categories'),
                'custom': staffText(
                  'Свои товары',
                  'Жеке тауарлар',
                  'Custom products',
                ),
              }.entries)
                ChoiceChip(
                  label: Text(tab.value),
                  selected: _tab == tab.key,
                  onSelected: (_) => setState(() {
                    _tab = tab.key;
                    _visible = 50;
                  }),
                ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            decoration: InputDecoration(
              labelText: staffText(
                'Поиск товара',
                'Тауар іздеу',
                'Search product',
              ),
              prefixIcon: const Icon(Icons.search),
            ),
            onChanged: (value) => setState(() {
              _search = value;
              _visible = 50;
            }),
          ),
          if (_tab == 'products')
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: StaffPicker(
                label: staffText('Категория', 'Санат', 'Category'),
                value: _category,
                options: {
                  '': staffText('Все', 'Барлығы', 'All'),
                  for (final group in _groups)
                    '${group['id']}':
                        '${_categoryOverrides['${group['id']}']?['custom_name'] ?? group['name']}',
                },
                onChanged: (value) => setState(() {
                  _category = value;
                  _visible = 50;
                }),
              ),
            ),
          if (_canEdit)
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _sync,
                  icon: const Icon(Icons.sync),
                  label: Text(
                    staffText(
                      'Обновить из iiko',
                      'iiko арқылы жаңарту',
                      'Sync from iiko',
                    ),
                  ),
                ),
                if (_tab == 'custom')
                  FilledButton.icon(
                    onPressed: () => _customEdit(),
                    icon: const Icon(Icons.add),
                    label: Text(staffText('Добавить', 'Қосу', 'Add')),
                  ),
              ],
            ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) _StaffError(message: _error!, onRetry: _load),
          for (final row in rows.take(_visible))
            Card(
              margin: const EdgeInsets.symmetric(vertical: 8),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _tab == 'custom' ? '${row['name']}' : _name(row),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (_tab != 'categories')
                      Text(
                        staffMoney(
                          _tab == 'custom'
                              ? row['price']
                              : _override(row)['custom_price'] ??
                                    row['price'] ??
                                    ((staffRows(
                                          row['sizePrices'],
                                        ).firstOrNull?['price']
                                        as Map?)?['currentPrice']),
                        ),
                      ),
                    if (_override(row)['is_hidden'] == true)
                      Text(
                        staffText(
                          'Скрыт от клиентов',
                          'Клиенттерден жасырылған',
                          'Hidden from customers',
                        ),
                      ),
                    if (_override(row)['is_stop_listed'] == true)
                      Text(
                        staffText('В стоп-листе', 'Стоп-тізімде', 'Stopped'),
                      ),
                    if (_canEdit)
                      Wrap(
                        spacing: 10,
                        runSpacing: 8,
                        children: [
                          OutlinedButton(
                            onPressed: () => _tab == 'custom'
                                ? _customEdit(row)
                                : _edit(row),
                            child: Text(
                              staffText('Изменить', 'Өзгерту', 'Edit'),
                            ),
                          ),
                          if (_tab == 'products') ...[
                            TextButton(
                              onPressed: () => _facts(row),
                              child: Text(
                                staffText(
                                  'Состав и хранение',
                                  'Құрамы мен сақталуы',
                                  'Ingredients and storage',
                                ),
                              ),
                            ),
                            TextButton(
                              onPressed: () => Navigator.push(
                                context,
                                StaffPageRoute<void>(
                                  builder: (_) => StaffProductOptions(
                                    api: widget.api,
                                    id: '${row['id']}',
                                    name: _name(row),
                                  ),
                                ),
                              ),
                              child: Text(
                                staffText(
                                  'Опции и модификаторы',
                                  'Опциялар мен модификаторлар',
                                  'Options and modifiers',
                                ),
                              ),
                            ),
                          ],
                          if (_tab == 'custom')
                            TextButton(
                              onPressed: () async {
                                final saved = await staffEdit(
                                  context,
                                  title: staffText(
                                    'Удалить товар?',
                                    'Тауарды жою керек пе?',
                                    'Delete product?',
                                  ),
                                  description: '${row['name']}',
                                  fields: [],
                                  save: (_) async {
                                    await widget.api.request(
                                      '/menu/custom-product/${Uri.encodeComponent('${row['id']}')}',
                                      method: 'DELETE',
                                    );
                                  },
                                );
                                if (saved == true && mounted) {
                                  unawaited(_load());
                                }
                              },
                              child: Text(
                                staffText('Удалить', 'Жою', 'Delete'),
                              ),
                            ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          if (rows.length > _visible)
            OutlinedButton(
              onPressed: () => setState(() => _visible += 50),
              child: Text(
                staffText('Показать ещё', 'Тағы көрсету', 'Show more'),
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
