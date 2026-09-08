part of '../main.dart';

String staffLocalized(dynamic value) {
  if (value is! Map) return '${value ?? ''}';
  final language = staffText('ru', 'kk', 'en');
  return '${value[language] ?? value['ru'] ?? ''}';
}

class StaffContactsTiers extends StatefulWidget {
  const StaffContactsTiers({required this.api, this.tiers = false, super.key});
  final StaffApiClient api;
  final bool tiers;
  @override
  State<StaffContactsTiers> createState() => _StaffContactsTiersState();
}

class _StaffContactsTiersState extends State<StaffContactsTiers> {
  List<Map<String, dynamic>> _rows = [];
  String? _error;
  bool _loading = false;
  late final StaffLiveRefresh _live;
  String get _path => widget.tiers ? '/loyalty-tiers' : '/contact-cards';
  String get _names => widget.tiers ? 'names' : 'titles';
  final _icons = {
    'bulka': 'Bulka',
    'phone': '☎',
    'whatsapp': 'WhatsApp',
    'telegram': 'Telegram',
    'instagram': 'Instagram',
    'vk': 'VK',
    'email': 'E-mail',
    'website': 'Web',
    'chat': 'Chat',
    'link': 'Link',
  };
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _loading);
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(_path);
      if (mounted) {
        setState(() {
          _rows = staffRows(
            result is List
                ? result
                : widget.tiers
                ? (result['tiers'] ?? result['data'])
                : result['cards'],
          );
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String?> _image() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return null;
    final result = await widget.api.uploadImage(
      '/loyalty-tiers/upload-image',
      await file.readAsBytes(),
      file.name,
    );
    if (result['imageUrl'] is! String) {
      throw Exception(
        staffText(
          'Изображение не загружено',
          'Сурет жүктелмеді',
          'Image upload failed',
        ),
      );
    }
    return result['imageUrl'] as String;
  }

  Future<void> _edit([Map<String, dynamic>? row]) async {
    final result = await staffEdit(
      context,
      title: widget.tiers
          ? staffText('Уровень лояльности', 'Адалдық деңгейі', 'Loyalty tier')
          : staffText('Карточка контактов', 'Байланыс картасы', 'Contact card'),
      fields: [
        if (widget.tiers)
          StaffField(
            'code',
            staffText('Код', 'Код', 'Code'),
            required: true,
            maxLength: 64,
          ),
        ...staffLocaleFields(
          _names,
          staffText('Название', 'Атауы', 'Title'),
          required: true,
        ),
        if (widget.tiers) ...[
          ...staffLocaleFields(
            'descriptions',
            staffText('Описание', 'Сипаттама', 'Description'),
            multiline: true,
          ),
          StaffField(
            'minSpend',
            staffText(
              'Порог покупок, ₸',
              'Сатып алу шегі, ₸',
              'Minimum spend, ₸',
            ),
            type: 'number',
            required: true,
            minimum: 0,
          ),
          StaffField(
            'cashbackPercent',
            staffText('Кешбэк, %', 'Кешбэк, %', 'Cashback, %'),
            type: 'number',
            required: true,
            minimum: 0,
            maximum: 100,
          ),
          StaffField(
            'backgroundImageUrl',
            staffText('Фон карточки', 'Карта фоны', 'Card background'),
            pick: _image,
          ),
        ] else ...[
          StaffField(
            'displayMode',
            staffText('Вид', 'Көрініс', 'Display'),
            options: {
              'standard': staffText('Обычный', 'Қалыпты', 'Standard'),
              'compact': staffText('Компактный', 'Ықшам', 'Compact'),
            },
          ),
          StaffField(
            'iconKey',
            staffText('Иконка', 'Белгіше', 'Icon'),
            options: _icons,
          ),
        ],
        StaffField(
          'sortOrder',
          staffText('Порядок', 'Реті', 'Sort order'),
          type: 'number',
          required: true,
          minimum: 0,
        ),
        StaffField(
          'isActive',
          staffText('Активна', 'Белсенді', 'Active'),
          type: 'bool',
        ),
      ],
      initial: {
        'sortOrder': _rows.length,
        'isActive': true,
        'minSpend': 0,
        'cashbackPercent': 0,
        ...?row,
        ...staffLocaleInitial(row ?? {}, [
          _names,
          if (widget.tiers) 'descriptions',
        ]),
      },
      save: (values) async {
        final body = staffPackLocales(values, [
          _names,
          if (widget.tiers) 'descriptions',
        ]);
        // Match the existing editor fallback for translations while retaining all supplied languages.
        for (final key in [_names, if (widget.tiers) 'descriptions']) {
          final texts = body[key] as Map;
          for (final language in ['kk', 'en']) {
            if (texts[language] == '') texts[language] = texts['ru'];
          }
        }
        if (widget.tiers && body['backgroundImageUrl'] == '') {
          body['backgroundImageUrl'] = null;
        }
        await widget.api.request(
          row == null ? _path : '$_path/${Uri.encodeComponent('${row['id']}')}',
          method: row == null ? 'POST' : 'PUT',
          body: body,
        );
      },
    );
    if (result == true && mounted) unawaited(_load());
  }

  Future<void> _remove(Map row, {bool action = false}) async {
    final result = await staffEdit(
      context,
      title: staffText('Удалить?', 'Жою керек пе?', 'Delete?'),
      description: staffLocalized(row[action ? 'labels' : _names]),
      fields: [],
      submitLabel: staffText('Удалить', 'Жою', 'Delete'),
      save: (_) async {
        await widget.api.request(
          '${action ? '/contact-actions' : _path}/${Uri.encodeComponent('${row['id']}')}',
          method: 'DELETE',
        );
      },
    );
    if (result == true && mounted) unawaited(_load());
  }

  Future<void> _move(
    List<Map<String, dynamic>> rows,
    int index,
    int offset, {
    String? cardId,
  }) async {
    final target = index + offset;
    if (target < 0 || target >= rows.length) return;
    final ordered = List<Map<String, dynamic>>.from(rows);
    final row = ordered.removeAt(index);
    ordered.insert(target, row);
    try {
      await widget.api.request(
        cardId == null
            ? '$_path/reorder'
            : '/contact-cards/${Uri.encodeComponent(cardId)}/actions/reorder',
        method: 'PUT',
        body: {'ids': ordered.map((r) => r['id']).toList()},
      );
      if (mounted) unawaited(_load());
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _action(Map card, [Map<String, dynamic>? action]) async {
    final result = await staffEdit(
      context,
      title: staffText(
        'Кнопка контакта',
        'Байланыс батырмасы',
        'Contact action',
      ),
      fields: [
        StaffField(
          'type',
          staffText('Тип', 'Түрі', 'Type'),
          options: {
            'phone': staffText('Телефон', 'Телефон', 'Phone'),
            'whatsapp': 'WhatsApp',
            'telegram': 'Telegram',
            'instagram': 'Instagram',
            'vk': 'VK',
            'email': 'E-mail',
            'website': staffText('Сайт', 'Сайт', 'Website'),
            'online_chat': staffText(
              'Чат поддержки',
              'Қолдау чаты',
              'Support chat',
            ),
            'custom_url': staffText('Ссылка', 'Сілтеме', 'Link'),
          },
        ),
        ...staffLocaleFields(
          'labels',
          staffText('Название', 'Атауы', 'Label'),
          required: true,
        ),
        StaffField(
          'target',
          staffText(
            'Номер или адрес ссылки',
            'Нөмір немесе сілтеме',
            'Phone number or destination',
          ),
          required: true,
          maxLength: 500,
        ),
        StaffField(
          'iconKey',
          staffText('Иконка', 'Белгіше', 'Icon'),
          options: _icons,
        ),
        StaffField(
          'sortOrder',
          staffText('Порядок', 'Реті', 'Sort order'),
          type: 'number',
          minimum: 0,
          required: true,
        ),
        StaffField(
          'isActive',
          staffText('Активна', 'Белсенді', 'Active'),
          type: 'bool',
        ),
      ],
      initial: {
        'sortOrder': (card['actions'] as List?)?.length ?? 0,
        'isActive': true,
        'iconKey': 'phone',
        ...?action,
        ...staffLocaleInitial(action ?? {}, ['labels']),
      },
      save: (values) async {
        final body = staffPackLocales(values, ['labels']);
        for (final language in ['kk', 'en']) {
          if ((body['labels'] as Map)[language] == '') {
            (body['labels'] as Map)[language] = (body['labels'] as Map)['ru'];
          }
        }
        await widget.api.request(
          action == null
              ? '/contact-cards/${Uri.encodeComponent('${card['id']}')}/actions'
              : '/contact-actions/${Uri.encodeComponent('${action['id']}')}',
          method: action == null ? 'POST' : 'PUT',
          body: body,
        );
      },
    );
    if (result == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        FilledButton.icon(
          onPressed: () => _edit(),
          icon: const Icon(Icons.add),
          label: Text(staffText('Добавить', 'Қосу', 'Add')),
        ),
        const SizedBox(height: 18),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        for (final (index, row) in _rows.indexed)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 8),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (widget.tiers && row['backgroundImageUrl'] is String)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: Image.network(
                        '${row['backgroundImageUrl']}',
                        height: 140,
                        fit: BoxFit.cover,
                        errorBuilder: (_, e, stack) => const SizedBox.shrink(),
                      ),
                    ),
                  Text(
                    staffLocalized(row[_names]),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (widget.tiers) ...[
                    Text(staffLocalized(row['descriptions'])),
                    StaffFacts({
                      staffText('Порог', 'Шек', 'Minimum spend'): staffMoney(
                        row['minSpend'],
                      ),
                      staffText('Кешбэк', 'Кешбэк', 'Cashback'):
                          '${staffNumber(row['cashbackPercent'])}%',
                    }),
                  ],
                  Text(
                    row['isActive'] == true
                        ? staffText('Активна', 'Белсенді', 'Active')
                        : staffText('Скрыта', 'Жасырылған', 'Hidden'),
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      TextButton.icon(
                        onPressed: () => _edit(row),
                        icon: const Icon(Icons.edit_outlined),
                        label: Text(staffText('Изменить', 'Өзгерту', 'Edit')),
                      ),
                      IconButton(
                        onPressed: index == 0
                            ? null
                            : () => _move(_rows, index, -1),
                        tooltip: staffText('Выше', 'Жоғары', 'Move up'),
                        icon: const Icon(Icons.arrow_upward),
                      ),
                      IconButton(
                        onPressed: index == _rows.length - 1
                            ? null
                            : () => _move(_rows, index, 1),
                        tooltip: staffText('Ниже', 'Төмен', 'Move down'),
                        icon: const Icon(Icons.arrow_downward),
                      ),
                      IconButton(
                        onPressed: () => _remove(row),
                        tooltip: staffText('Удалить', 'Жою', 'Delete'),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                  if (!widget.tiers) ...[
                    for (final (ai, action) in staffRows(
                      row['actions'],
                    ).indexed)
                      ExpansionTile(
                        title: Text(staffLocalized(action['labels'])),
                        subtitle: Text('${action['target']}'),
                        children: [
                          Wrap(
                            spacing: 8,
                            children: [
                              TextButton(
                                onPressed: () => _action(row, action),
                                child: Text(
                                  staffText('Изменить', 'Өзгерту', 'Edit'),
                                ),
                              ),
                              IconButton(
                                onPressed: ai == 0
                                    ? null
                                    : () => _move(
                                        staffRows(row['actions']),
                                        ai,
                                        -1,
                                        cardId: '${row['id']}',
                                      ),
                                tooltip: staffText('Выше', 'Жоғары', 'Move up'),
                                icon: const Icon(Icons.arrow_upward),
                              ),
                              IconButton(
                                onPressed:
                                    ai == staffRows(row['actions']).length - 1
                                    ? null
                                    : () => _move(
                                        staffRows(row['actions']),
                                        ai,
                                        1,
                                        cardId: '${row['id']}',
                                      ),
                                tooltip: staffText(
                                  'Ниже',
                                  'Төмен',
                                  'Move down',
                                ),
                                icon: const Icon(Icons.arrow_downward),
                              ),
                              IconButton(
                                onPressed: () => _remove(action, action: true),
                                tooltip: staffText('Удалить', 'Жою', 'Delete'),
                                icon: const Icon(Icons.delete_outline),
                              ),
                            ],
                          ),
                        ],
                      ),
                    TextButton.icon(
                      onPressed: () => _action(row),
                      icon: const Icon(Icons.add),
                      label: Text(
                        staffText(
                          'Добавить кнопку',
                          'Батырма қосу',
                          'Add action',
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
      ],
    ),
  );
  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }
}
