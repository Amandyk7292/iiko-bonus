part of '../main.dart';

class StaffContent extends StatefulWidget {
  const StaffContent({
    required this.api,
    required this.stories,
    required this.canEdit,
    super.key,
  });
  final StaffApiClient api;
  final bool stories, canEdit;
  @override
  State<StaffContent> createState() => _StaffContentState();
}

class _StaffContentState extends State<StaffContent> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = false;
  String? _error;
  late final StaffLiveRefresh _live;
  String get _path => widget.stories ? '/stories' : '/news';
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['content.updated'],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final data = await widget.api.request(_path);
      if (mounted) {
        setState(() {
          _items = staffRows(data[widget.stories ? 'stories' : 'news']);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? item]) async {
    if (!widget.canEdit) return;
    await Navigator.push(
      context,
      StaffPageRoute<void>(
        builder: (_) => _StaffContentEditor(
          api: widget.api,
          stories: widget.stories,
          item: item,
        ),
      ),
    );
    if (mounted) unawaited(_load());
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    if (!widget.canEdit) return;
    await staffEdit(
      context,
      title: staffText(
        'Удалить публикацию?',
        'Жарияланымды жою керек пе?',
        'Delete publication?',
      ),
      description: '${item['title']}',
      fields: [],
      save: (_) async {
        await widget.api.request(
          '$_path/${Uri.encodeComponent('${item['id']}')}',
          method: 'DELETE',
        );
      },
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (widget.canEdit)
          FilledButton.icon(
            onPressed: () => _edit(),
            icon: const Icon(Icons.add),
            label: Text(staffText('Добавить', 'Қосу', 'Add')),
          ),
        const SizedBox(height: 16),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (!_loading && _items.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText(
                'Публикаций нет',
                'Жарияланымдар жоқ',
                'No publications',
              ),
              textAlign: TextAlign.center,
            ),
          ),
        for (final item in _items)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 10),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if ('${item[widget.stories ? 'coverUrl' : 'imageUrl'] ?? item['imageurl'] ?? ''}'
                    .isNotEmpty)
                  Image.network(
                    '${item[widget.stories ? 'coverUrl' : 'imageUrl'] ?? item['imageurl']}',
                    height: 170,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox(
                      height: 80,
                      child: Icon(Icons.broken_image_outlined),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        '${item['title'] ?? ''}',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      Text('${item['description'] ?? ''}'),
                      if (widget.canEdit)
                        Wrap(
                          spacing: 12,
                          children: [
                            OutlinedButton(
                              onPressed: () => _edit(item),
                              child: Text(
                                staffText('Изменить', 'Өзгерту', 'Edit'),
                              ),
                            ),
                            TextButton(
                              onPressed: () => _delete(item),
                              child: Text(
                                staffText('Удалить', 'Жою', 'Delete'),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ],
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

class _StaffContentEditor extends StatefulWidget {
  const _StaffContentEditor({
    required this.api,
    required this.stories,
    this.item,
  });
  final StaffApiClient api;
  final bool stories;
  final Map<String, dynamic>? item;
  @override
  State<_StaffContentEditor> createState() => _StaffContentEditorState();
}

class _StaffContentEditorState extends State<_StaffContentEditor> {
  final _controllers = <String, TextEditingController>{};
  String _language = 'ru', _promo = 'promotion';
  bool _busy = false;
  String? _error;
  DateTime? _start, _end;
  List<String> get _localized => [
    'title',
    'description',
    if (widget.stories) 'details',
    if (widget.stories) ...['coverUrl', 'contentUrl'] else 'imageUrl',
  ];
  TextEditingController _c(String name) => _controllers[name]!;
  @override
  void initState() {
    super.initState();
    final item = widget.item ?? {};
    final i18n = item['i18n'] as Map? ?? {};
    for (final language in ['ru', 'kk', 'en']) {
      final data =
          (i18n[language] ?? (language == 'kk' ? i18n['kz'] : null)) as Map? ??
          {};
      for (final field in _localized) {
        _controllers['$language.$field'] = TextEditingController(
          text:
              '${data[field] ?? (language == 'ru' ? (item[field] ?? (field == 'imageUrl' ? item['imageurl'] : null)) : null) ?? ''}',
        );
      }
    }
    for (final entry in {
      'groupId': '',
      'duration': 15,
      'sortOrder': 0,
      'remaining': '',
      'qrValue': '',
    }.entries) {
      _controllers[entry.key] = TextEditingController(
        text: '${item[entry.key] ?? entry.value}',
      );
    }
    _promo = '${item['promoType'] ?? 'promotion'}';
    _start = DateTime.tryParse('${item['startsAt']}');
    _end = DateTime.tryParse('${item['endsAt']}');
  }

  Future<void> _image(String field) async {
    if (_busy) return;
    final target = '$_language.$field';
    try {
      final file = await ImagePicker().pickImage(source: ImageSource.gallery);
      if (file == null || !mounted) return;
      setState(() => _busy = true);
      final bytes = await file.readAsBytes();
      if (bytes.length > 8 * 1024 * 1024) {
        throw Exception(
          staffText(
            'Изображение должно быть меньше 8 МБ',
            'Сурет 8 МБ-тан кіші болуы керек',
            'Image must be below 8 MB',
          ),
        );
      }
      final result = await widget.api.request(
        '/upload',
        method: 'POST',
        body: {'imageBase64': base64Encode(bytes), 'filename': file.name},
      );
      if (mounted) setState(() => _c(target).text = '${result['url']}');
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _date(bool start) async {
    final current =
        (start ? _start : _end)?.toUtc().add(const Duration(hours: 5)) ??
        DateTime.now().toUtc().add(const Duration(hours: 5));
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      initialDate: current,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: current.hour, minute: current.minute),
    );
    if (time != null && mounted) {
      final value = DateTime.utc(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      ).subtract(const Duration(hours: 5));
      setState(() {
        if (start) {
          _start = value;
        } else {
          _end = value;
        }
      });
    }
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final i18n = <String, Map<String, dynamic>>{};
      for (final language in ['ru', 'kk', 'en']) {
        i18n[language] = {
          for (final field in _localized)
            field: _c('$language.$field').text.trim(),
        };
      }
      final ru = i18n['ru']!;
      if ('${ru['title']}'.isEmpty) {
        throw Exception(
          staffText(
            'Добавьте русский заголовок',
            'Орысша тақырып қосыңыз',
            'Add a Russian title',
          ),
        );
      }
      for (final field
          in widget.stories ? ['coverUrl', 'contentUrl'] : ['imageUrl']) {
        final uri = Uri.tryParse('${ru[field]}');
        if (uri?.scheme != 'https' || uri!.host.isEmpty) {
          throw Exception(
            staffText('Добавьте изображение', 'Сурет қосыңыз', 'Add an image'),
          );
        }
      }
      final body = <String, dynamic>{...ru, 'i18n': i18n};
      if (widget.stories) {
        int integer(String key, int minimum, int maximum) {
          final value = int.tryParse(_c(key).text);
          if (value == null || value < minimum || value > maximum) {
            throw Exception(
              staffText(
                'Проверьте длительность, порядок и остаток',
                'Ұзақтықты, реттілікті және қалдықты тексеріңіз',
                'Check duration, order and remaining count',
              ),
            );
          }
          return value;
        }

        if (_start != null && _end != null && _end!.isBefore(_start!)) {
          throw Exception(
            staffText(
              'Окончание раньше начала',
              'Аяқталу басталудан ерте',
              'End precedes start',
            ),
          );
        }
        body.addAll({
          'groupTitle': ru['title'],
          'groupId': _c('groupId').text.trim().isEmpty
              ? '${ru['title']}'.toLowerCase().replaceAll(RegExp(r'\s+'), '-')
              : _c('groupId').text.trim(),
          'duration': integer('duration', 3, 120),
          'sortOrder': integer('sortOrder', 0, 1000000),
          'promoType': _promo,
          'startsAt': _start?.toUtc().toIso8601String(),
          'endsAt': _end?.toUtc().toIso8601String(),
          'remaining': _c('remaining').text.trim().isEmpty
              ? null
              : integer('remaining', 0, 1000000000),
          'qrValue': _c('qrValue').text.trim().isEmpty
              ? null
              : _c('qrValue').text.trim(),
          'createdAt': widget.item?['createdAt'],
        });
      }
      final path = widget.stories ? '/stories' : '/news';
      await widget.api.request(
        widget.item == null
            ? path
            : '$path/${Uri.encodeComponent('${widget.item!['id']}')}',
        method: widget.item == null ? 'POST' : 'PUT',
        body: body,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: Scaffold(
      appBar: AppBar(
        title: Text(
          widget.stories
              ? staffText('История', 'Оқиға', 'Story')
              : staffText('Новость', 'Жаңалық', 'News'),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Wrap(
            spacing: 10,
            children: [
              for (final language in {
                'ru': 'Русский',
                'kk': 'Қазақша',
                'en': 'English',
              }.entries)
                ChoiceChip(
                  label: Text(language.value),
                  selected: _language == language.key,
                  onSelected: _busy
                      ? null
                      : (_) => setState(() => _language = language.key),
                ),
            ],
          ),
          const SizedBox(height: 20),
          for (final field in _localized)
            Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    key: ValueKey('$_language.$field'),
                    controller: _c('$_language.$field'),
                    enabled: !_busy,
                    minLines: field == 'description' || field == 'details'
                        ? 3
                        : 1,
                    maxLines: field == 'description' || field == 'details'
                        ? 8
                        : 1,
                    maxLength: field == 'title'
                        ? 255
                        : field == 'details'
                        ? 20000
                        : field == 'description'
                        ? 5000
                        : null,
                    decoration: InputDecoration(
                      labelText: switch (field) {
                        'title' => staffText('Заголовок', 'Тақырып', 'Title'),
                        'description' => staffText(
                          'Описание',
                          'Сипаттама',
                          'Description',
                        ),
                        'details' => staffText(
                          'Подробные условия',
                          'Толық шарттар',
                          'Full terms',
                        ),
                        'coverUrl' => staffText('Обложка', 'Мұқаба', 'Cover'),
                        'contentUrl' => staffText(
                          'Изображение истории',
                          'Оқиға суреті',
                          'Story image',
                        ),
                        _ => staffText('Изображение', 'Сурет', 'Image'),
                      },
                    ),
                  ),
                  if (field.endsWith('Url')) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _image(field),
                      icon: const Icon(Icons.photo_library_outlined),
                      label: Text(
                        staffText(
                          'Выбрать фото',
                          'Фото таңдау',
                          'Choose image',
                        ),
                      ),
                    ),
                    if (_c('$_language.$field').text.startsWith('https://'))
                      Image.network(
                        _c('$_language.$field').text,
                        height: 160,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) =>
                            const Icon(Icons.broken_image_outlined),
                      ),
                  ],
                ],
              ),
            ),
          if (widget.stories)
            ExpansionTile(
              title: Text(
                staffText(
                  'Параметры публикации',
                  'Жариялау параметрлері',
                  'Publication settings',
                ),
              ),
              children: [
                for (final field in {
                  'groupId': staffText('Группа', 'Топ', 'Group'),
                  'duration': staffText(
                    'Длительность, сек',
                    'Ұзақтық, сек',
                    'Duration, sec',
                  ),
                  'sortOrder': staffText('Порядок', 'Реті', 'Order'),
                  'remaining': staffText('Осталось', 'Қалды', 'Remaining'),
                  'qrValue': staffText(
                    'Содержимое QR',
                    'QR мазмұны',
                    'QR value',
                  ),
                }.entries)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    child: TextField(
                      controller: _c(field.key),
                      enabled: !_busy,
                      decoration: InputDecoration(labelText: field.value),
                      keyboardType:
                          [
                            'duration',
                            'sortOrder',
                            'remaining',
                          ].contains(field.key)
                          ? TextInputType.number
                          : null,
                    ),
                  ),
                StaffPicker(
                  label: staffText('Тип', 'Түрі', 'Type'),
                  value: _promo,
                  options: {
                    'promotion': staffText('Акция', 'Акция', 'Promotion'),
                    'discount': staffText('Скидка', 'Жеңілдік', 'Discount'),
                    'subscription': staffText(
                      'Подписка',
                      'Жазылым',
                      'Subscription',
                    ),
                  },
                  onChanged: (value) => setState(() => _promo = value),
                ),
                Wrap(
                  spacing: 12,
                  children: [
                    OutlinedButton(
                      onPressed: _busy ? null : () => _date(true),
                      child: Text(
                        '${staffText('Начало', 'Басталуы', 'Start')}: ${staffDate(_start?.toIso8601String())}',
                      ),
                    ),
                    OutlinedButton(
                      onPressed: _busy ? null : () => _date(false),
                      child: Text(
                        '${staffText('Окончание', 'Аяқталуы', 'End')}: ${staffDate(_end?.toIso8601String())}',
                      ),
                    ),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() {
                              _start = null;
                              _end = null;
                            }),
                      child: Text(
                        staffText('Без срока', 'Мерзімсіз', 'No dates'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
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
                : Text(staffText('Сохранить', 'Сақтау', 'Save')),
          ),
        ],
      ),
    ),
  );
  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }
}
