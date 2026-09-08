part of '../main.dart';

class StaffTaplink extends StatefulWidget {
  const StaffTaplink({required this.api, super.key});
  final StaffApiClient api;
  @override
  State<StaffTaplink> createState() => _StaffTaplinkState();
}

class _StaffTaplinkState extends State<StaffTaplink> {
  Map<String, dynamic>? _document;
  int _revision = 0, _published = 0;
  bool _busy = false, _dirty = false;
  String? _error;
  String _locale = 'ru';
  List<Map<String, dynamic>> get _blocks => staffRows(_document?['blocks']);
  Map<String, String> get _styles => {
    'soft': staffText('Мягкий', 'Жұмсақ', 'Soft'),
    'outlined': staffText('Контур', 'Жиек', 'Outlined'),
    'solid': staffText('Заливка', 'Толтыру', 'Solid'),
  };
  Map<String, String> get _effects => {
    'none': staffText('Нет', 'Жоқ', 'None'),
    'lift': staffText('Подъём', 'Көтерілу', 'Lift'),
    'glow': staffText('Свечение', 'Жарқырау', 'Glow'),
    'shine': staffText('Блик', 'Жылтыр', 'Shine'),
  };
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final result = await widget.api.request('/taplink');
      if (mounted) {
        setState(() {
          _apply(result);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _apply(dynamic result) {
    final page = result['page'] as Map;
    _document = Map<String, dynamic>.from(
      jsonDecode(jsonEncode(page['draft'])) as Map,
    );
    _revision = (page['draftRevision'] as num).toInt();
    _published = (page['publishedRevision'] as num).toInt();
    _dirty = false;
  }

  Future<bool> _save() async {
    if (_busy || _document == null) return false;
    setState(() => _busy = true);
    try {
      final result = await widget.api.request(
        '/taplink/draft',
        method: 'PUT',
        body: {'config': _document, 'expectedRevision': _revision},
      );
      if (mounted) {
        setState(() {
          _apply(result);
          _error = null;
        });
      }
      return true;
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _publish() async {
    if (_dirty && !await _save()) return;
    if (!mounted) return;
    final saved = await staffEdit(
      context,
      title: staffText(
        'Опубликовать страницу?',
        'Бетті жариялау керек пе?',
        'Publish page?',
      ),
      description: staffText(
        'Изменения увидят посетители страницы.',
        'Өзгерістерді бетке кірушілер көреді.',
        'Visitors will see these changes.',
      ),
      fields: [],
      submitLabel: staffText('Опубликовать', 'Жариялау', 'Publish'),
      save: (_) async {
        final result = await widget.api.request(
          '/taplink/publish',
          method: 'POST',
          body: {'expectedRevision': _revision},
        );
        if (mounted) setState(() => _apply(result));
      },
    );
    if (saved == true && mounted) setState(() => _error = null);
  }

  List<StaffField> _texts(String key, String label, {bool long = false}) => [
    for (final locale in ['ru', 'kk'])
      StaffField(
        '${key}_$locale',
        '$label · ${locale.toUpperCase()}',
        type: long ? 'multiline' : 'text',
        required: key != 'subtitles' && key != 'ariaLabels',
      ),
  ];
  Map<String, dynamic> _initial(Map row, List<String> keys) => {
    for (final key in keys)
      for (final locale in ['ru', 'kk'])
        '${key}_$locale': (row[key] as Map?)?[locale] ?? '',
  };
  Map<String, dynamic> _pack(Map<String, dynamic> row, List<String> keys) {
    final result = Map<String, dynamic>.from(row);
    for (final key in keys) {
      result[key] = {
        for (final locale in ['ru', 'kk'])
          locale: result.remove('${key}_$locale'),
      };
    }
    return result;
  }

  Future<String?> _image() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    if (bytes.length > 8 * 1024 * 1024) {
      throw Exception(
        staffText(
          'Файл больше 8 МБ',
          'Файл 8 МБ-тан үлкен',
          'File exceeds 8 MB',
        ),
      );
    }
    final result = await widget.api.request(
      '/upload',
      method: 'POST',
      body: {'imageBase64': base64Encode(bytes), 'filename': file.name},
    );
    if (result['url'] is! String) {
      throw Exception(
        staffText(
          'Изображение не загружено',
          'Сурет жүктелмеді',
          'Image upload failed',
        ),
      );
    }
    return result['url'] as String;
  }

  Future<void> _profile(bool seo) async {
    final key = seo ? 'seo' : 'profile';
    final initial = Map<String, dynamic>.from(_document![key] as Map);
    final keys = ['title', 'description', if (!seo) 'footer'];
    await staffEdit(
      context,
      title: seo
          ? 'SEO'
          : staffText('Профиль страницы', 'Бет профилі', 'Page profile'),
      fields: [
        ..._texts('title', staffText('Заголовок', 'Тақырып', 'Title')),
        ..._texts(
          'description',
          staffText('Описание', 'Сипаттама', 'Description'),
          long: true,
        ),
        if (!seo)
          ..._texts('footer', staffText('Подвал', 'Төменгі мәтін', 'Footer')),
        StaffField(
          seo ? 'ogImageUrl' : 'logoUrl',
          seo
              ? staffText(
                  'Изображение для ссылки',
                  'Сілтеме суреті',
                  'Link preview image',
                )
              : staffText('Логотип', 'Логотип', 'Logo'),
          pick: _image,
        ),
        if (!seo) ...[
          StaffField(
            'defaultLocale',
            staffText('Основной язык', 'Негізгі тіл', 'Default language'),
            options: {'ru': 'Русский', 'kk': 'Қазақша'},
          ),
          StaffField(
            'enabledLocales',
            staffText('Языки страницы', 'Бет тілдері', 'Page languages'),
            type: 'multi',
            options: {'ru': 'Русский', 'kk': 'Қазақша'},
          ),
        ],
      ],
      initial: {
        ...initial,
        ..._initial(initial, keys),
        'defaultLocale': _document!['defaultLocale'],
        'enabledLocales': _document!['enabledLocales'],
      },
      save: (values) async {
        final body = _pack(values, keys);
        if (body[seo ? 'ogImageUrl' : 'logoUrl'] == '') {
          body.remove(seo ? 'ogImageUrl' : 'logoUrl');
        }
        if (!seo) {
          final enabled = body.remove('enabledLocales') as List;
          final locale = body.remove('defaultLocale');
          if (!enabled.contains(locale)) {
            throw Exception(
              staffText(
                'Основной язык должен быть включён',
                'Негізгі тіл қосулы болуы керек',
                'Default language must be enabled',
              ),
            );
          }
          _document!['enabledLocales'] = enabled;
          _document!['defaultLocale'] = locale;
        }
        if (mounted) {
          setState(() {
            _document![key] = body;
            _dirty = true;
          });
        }
      },
    );
  }

  Future<void> _theme() async {
    final theme = Map<String, dynamic>.from(_document!['theme'] as Map);
    final colors = {
      'backgroundColor': staffText('Фон', 'Фон', 'Background'),
      'gradientFrom': staffText(
        'Градиент: начало',
        'Градиент: басы',
        'Gradient start',
      ),
      'gradientTo': staffText(
        'Градиент: конец',
        'Градиент: соңы',
        'Gradient end',
      ),
      'backgroundOverlayColor': staffText('Наложение', 'Қабат', 'Overlay'),
      'textColor': staffText('Текст', 'Мәтін', 'Text'),
      'mutedTextColor': staffText(
        'Вторичный текст',
        'Қосымша мәтін',
        'Secondary text',
      ),
      'surfaceColor': staffText('Поверхность', 'Беткі қабат', 'Surface'),
      'buttonBackgroundColor': staffText(
        'Фон кнопок',
        'Батырма фоны',
        'Button background',
      ),
      'buttonTextColor': staffText(
        'Текст кнопок',
        'Батырма мәтіні',
        'Button text',
      ),
      'primaryButtonBackgroundColor': staffText(
        'Главная кнопка: фон',
        'Негізгі батырма: фон',
        'Primary button background',
      ),
      'primaryButtonTextColor': staffText(
        'Главная кнопка: текст',
        'Негізгі батырма: мәтін',
        'Primary button text',
      ),
    };
    await staffEdit(
      context,
      title: staffText('Оформление', 'Безендіру', 'Appearance'),
      fields: [
        StaffField(
          'backgroundMode',
          staffText('Тип фона', 'Фон түрі', 'Background mode'),
          options: {
            'brand': 'Bulka',
            'solid': staffText('Однотонный', 'Біртүсті', 'Solid'),
            'gradient': staffText('Градиент', 'Градиент', 'Gradient'),
            'image': staffText('Изображение', 'Сурет', 'Image'),
          },
        ),
        StaffField(
          'backgroundImageUrl',
          staffText('Изображение фона', 'Фон суреті', 'Background image'),
          pick: _image,
        ),
        for (final c in colors.entries)
          StaffField(
            c.key,
            '${c.value} · #RRGGBB',
            required: true,
            maxLength: 7,
          ),
        StaffField(
          'gradientDirection',
          staffText(
            'Направление градиента',
            'Градиент бағыты',
            'Gradient direction',
          ),
          options: {
            'top': '↑',
            'top-right': '↗',
            'right': '→',
            'bottom-right': '↘',
            'bottom': '↓',
            'bottom-left': '↙',
            'left': '←',
            'top-left': '↖',
          },
        ),
        StaffField(
          'backgroundOverlayOpacity',
          staffText('Наложение, %', 'Қабат, %', 'Overlay, %'),
          type: 'number',
          minimum: 0,
          maximum: 70,
          required: true,
        ),
        StaffField(
          'radius',
          staffText('Скругление', 'Дөңгелектеу', 'Corner radius'),
          type: 'number',
          minimum: 12,
          maximum: 32,
          required: true,
        ),
        StaffField(
          'buttonStyle',
          staffText('Кнопки', 'Батырмалар', 'Buttons'),
          options: _styles,
        ),
        StaffField(
          'buttonEffect',
          staffText('Эффект кнопок', 'Батырма әсері', 'Button effect'),
          options: _effects,
        ),
        StaffField(
          'animation',
          staffText('Анимация', 'Анимация', 'Animation'),
          options: {
            'none': staffText('Нет', 'Жоқ', 'None'),
            'fade': staffText('Появление', 'Пайда болу', 'Fade'),
            'rise': staffText('Подъём', 'Көтерілу', 'Rise'),
            'stagger': staffText('По очереди', 'Кезекпен', 'Stagger'),
          },
        ),
      ],
      initial: theme,
      save: (values) async {
        for (final key in colors.keys) {
          if (!RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch('${values[key]}')) {
            throw Exception('${colors[key]}: #RRGGBB');
          }
        }
        if (values['backgroundImageUrl'] == '') {
          values.remove('backgroundImageUrl');
        }
        if (mounted) {
          setState(() {
            _document!['theme'] = {'preset': 'bulka', ...values};
            _dirty = true;
          });
        }
      },
    );
  }

  Future<void> _block([Map<String, dynamic>? row]) async {
    String type = 'link';
    if (row == null) {
      final choice = await staffChooseFields(
        context,
        staffText('Новый блок', 'Жаңа блок', 'New block'),
        {
          'link': staffText('Кнопка', 'Батырма', 'Link'),
          'section': staffText(
            'Заголовок раздела',
            'Бөлім тақырыбы',
            'Section heading',
          ),
        },
        [],
      );
      if (choice == null || !mounted) return;
      type = choice.first;
    } else {
      type = '${row['type']}';
    }
    final keys = [
      'labels',
      if (type == 'link') ...['subtitles', 'ariaLabels'],
    ];
    await staffEdit(
      context,
      title: staffText('Блок страницы', 'Бет блогы', 'Page block'),
      fields: [
        ..._texts('labels', staffText('Название', 'Атауы', 'Label')),
        if (type == 'link') ...[
          ..._texts('subtitles', staffText('Подпись', 'Жазу', 'Subtitle')),
          ..._texts(
            'ariaLabels',
            staffText(
              'Описание для чтения с экрана',
              'Экраннан оқу сипаттамасы',
              'Screen reader label',
            ),
          ),
          StaffField(
            'style',
            staffText('Вид', 'Көрініс', 'Style'),
            options: {
              'primary': staffText('Главная', 'Негізгі', 'Primary'),
              'standard': staffText('Обычная', 'Қалыпты', 'Standard'),
              'city': staffText('Город', 'Қала', 'City'),
            },
          ),
          StaffField(
            'icon',
            staffText('Иконка', 'Белгіше', 'Icon'),
            options: {
              'phone': '☎',
              'whatsapp': 'WhatsApp',
              '2gis': '2GIS',
              'instagram': 'Instagram',
              'telegram': 'Telegram',
              'globe': 'Web',
              'location': staffText('Адрес', 'Мекенжай', 'Location'),
              'none': staffText('Нет', 'Жоқ', 'None'),
            },
          ),
          StaffField(
            'targetType',
            staffText('Действие', 'Әрекет', 'Target'),
            options: {
              'whatsapp': 'WhatsApp',
              'phone': staffText('Звонок', 'Қоңырау', 'Phone'),
              'email': 'E-mail',
              'url': staffText('Ссылка', 'Сілтеме', 'URL'),
            },
          ),
          StaffField(
            'targetValue',
            staffText(
              'Номер или ссылка',
              'Нөмір немесе сілтеме',
              'Phone number or URL',
            ),
            required: true,
          ),
        ],
        StaffField(
          'enabled',
          staffText('Показывать', 'Көрсету', 'Visible'),
          type: 'bool',
        ),
      ],
      initial: {
        'enabled': true,
        'style': 'standard',
        'icon': 'none',
        ...?row,
        ..._initial(row ?? {}, keys),
        'targetType': (row?['target'] as Map?)?['type'] ?? 'url',
        'targetValue': (row?['target'] as Map?)?['value'] ?? '',
      },
      save: (values) async {
        final body = _pack(values, keys);
        body['id'] = row?['id'] ?? staffRequestId();
        body['type'] = type;
        if (type == 'link') {
          body['target'] = {
            'type': body.remove('targetType'),
            'value': body.remove('targetValue'),
          };
          if (row?['appearance'] != null) {
            body['appearance'] = row!['appearance'];
          }
        }
        final blocks = _blocks;
        final index = blocks.indexWhere((b) => b['id'] == body['id']);
        if (index < 0) {
          if (blocks.length >= 40) {
            throw Exception(
              staffText(
                'Максимум 40 блоков',
                'Ең көбі 40 блок',
                'Maximum 40 blocks',
              ),
            );
          }
          blocks.add(body);
        } else {
          blocks[index] = body;
        }
        if (mounted) {
          setState(() {
            _document!['blocks'] = blocks;
            _dirty = true;
          });
        }
      },
    );
  }

  Future<void> _buttonAppearance(Map<String, dynamic> block) async {
    final theme = _document!['theme'] as Map;
    final initial = {
      'buttonStyle': theme['buttonStyle'],
      'backgroundColor': theme['buttonBackgroundColor'],
      'textColor': theme['buttonTextColor'],
      'radius': theme['radius'],
      'buttonEffect': theme['buttonEffect'],
      ...?block['appearance'] as Map?,
    };
    await staffEdit(
      context,
      title: staffText(
        'Оформление кнопки',
        'Батырманы безендіру',
        'Button appearance',
      ),
      fields: [
        StaffField(
          'custom',
          staffText('Своё оформление', 'Жеке безендіру', 'Custom appearance'),
          type: 'bool',
        ),
        StaffField(
          'buttonStyle',
          staffText('Стиль', 'Стиль', 'Style'),
          options: _styles,
        ),
        StaffField(
          'backgroundColor',
          staffText('Фон #RRGGBB', 'Фон #RRGGBB', 'Background #RRGGBB'),
          required: true,
        ),
        StaffField(
          'textColor',
          staffText('Текст #RRGGBB', 'Мәтін #RRGGBB', 'Text #RRGGBB'),
          required: true,
        ),
        StaffField(
          'radius',
          staffText('Скругление', 'Дөңгелектеу', 'Corner radius'),
          type: 'number',
          minimum: 12,
          maximum: 32,
          required: true,
        ),
        StaffField(
          'buttonEffect',
          staffText('Эффект', 'Әсер', 'Effect'),
          options: _effects,
        ),
      ],
      initial: {...initial, 'custom': block['appearance'] != null},
      save: (values) async {
        final custom = values.remove('custom') == true;
        final blocks = _blocks;
        final target = blocks.firstWhere((b) => b['id'] == block['id']);
        if (custom) {
          target['appearance'] = values;
        } else {
          target.remove('appearance');
        }
        if (mounted) {
          setState(() {
            _document!['blocks'] = blocks;
            _dirty = true;
          });
        }
      },
    );
  }

  void _move(int index, int offset) {
    final blocks = _blocks;
    final target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    final row = blocks.removeAt(index);
    blocks.insert(target, row);
    setState(() {
      _document!['blocks'] = blocks;
      _dirty = true;
    });
  }

  Future<void> _remove(Map row) async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(
          staffText('Удалить блок?', 'Блокты жою керек пе?', 'Delete block?'),
        ),
        content: Text(staffLocalized(row['labels'])),
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
    if (accepted == true && mounted) {
      setState(() {
        _document!['blocks'] = _blocks
            .where((b) => b['id'] != row['id'])
            .toList();
        _dirty = true;
      });
    }
  }

  Future<void> _reload() async {
    if (_dirty) {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(
            staffText(
              'Загрузить серверную версию?',
              'Сервер нұсқасын жүктеу керек пе?',
              'Reload server version?',
            ),
          ),
          content: Text(
            staffText(
              'Несохранённые изменения будут потеряны.',
              'Сақталмаған өзгерістер жоғалады.',
              'Unsaved changes will be discarded.',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
            ),
            TextButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(staffText('Загрузить', 'Жүктеу', 'Reload')),
            ),
          ],
        ),
      );
      if (accepted != true || !mounted) return;
    }
    await _load();
  }

  Color _color(dynamic value, Color fallback) {
    final parsed = int.tryParse(
      '${value ?? ''}'.replaceFirst('#', ''),
      radix: 16,
    );
    return parsed == null ? fallback : Color(0xFF000000 | parsed);
  }

  Widget _preview() {
    final d = _document!;
    final p = d['profile'] as Map;
    final t = d['theme'] as Map;
    String text(dynamic v) => '${(v as Map?)?[_locale] ?? ''}';
    final radius = (t['radius'] as num?)?.toDouble() ?? 22;
    return Container(
      decoration: BoxDecoration(
        color: _color(t['backgroundColor'], Colors.white),
        borderRadius: BorderRadius.circular(22),
        gradient: t['backgroundMode'] == 'gradient'
            ? LinearGradient(
                colors: [
                  _color(t['gradientFrom'], Colors.amber),
                  _color(t['gradientTo'], Colors.orange),
                ],
              )
            : null,
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (p['logoUrl'] is String)
            Image.network(
              widget.api._base.resolve('${p['logoUrl']}').toString(),
              height: 70,
              errorBuilder: (_, e, s) => const SizedBox.shrink(),
            ),
          Text(
            text(p['title']),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: _color(t['textColor'], Colors.brown),
            ),
          ),
          Text(
            text(p['description']),
            textAlign: TextAlign.center,
            style: TextStyle(color: _color(t['mutedTextColor'], Colors.brown)),
          ),
          const SizedBox(height: 16),
          for (final block in _blocks.where((b) => b['enabled'] == true))
            block['type'] == 'section'
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      text(block['labels']),
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: _color(t['textColor'], Colors.brown),
                      ),
                    ),
                  )
                : Container(
                    margin: const EdgeInsets.symmetric(vertical: 5),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: _color(
                        (block['appearance'] as Map?)?['backgroundColor'] ??
                            t[block['style'] == 'primary'
                                ? 'primaryButtonBackgroundColor'
                                : 'buttonBackgroundColor'],
                        Colors.white,
                      ),
                      borderRadius: BorderRadius.circular(
                        ((block['appearance'] as Map?)?['radius'] as num?)
                                ?.toDouble() ??
                            radius,
                      ),
                    ),
                    child: Column(
                      children: [
                        Text(
                          text(block['labels']),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: _color(
                              (block['appearance'] as Map?)?['textColor'] ??
                                  t[block['style'] == 'primary'
                                      ? 'primaryButtonTextColor'
                                      : 'buttonTextColor'],
                              Colors.brown,
                            ),
                          ),
                        ),
                        if (text(block['subtitles']).isNotEmpty)
                          Text(
                            text(block['subtitles']),
                            textAlign: TextAlign.center,
                          ),
                      ],
                    ),
                  ),
          const SizedBox(height: 16),
          Text(text(p['footer']), textAlign: TextAlign.center),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(18),
    children: [
      if (_busy) const LinearProgressIndicator(),
      if (_error != null)
        Text(
          _error!,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      if (_document != null) ...[
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            OutlinedButton(
              onPressed: _busy ? null : _save,
              child: Text(
                _dirty
                    ? staffText(
                        'Сохранить черновик •',
                        'Нобайды сақтау •',
                        'Save draft •',
                      )
                    : staffText(
                        'Черновик сохранён',
                        'Нобай сақталды',
                        'Draft saved',
                      ),
              ),
            ),
            FilledButton(
              onPressed: _busy ? null : _publish,
              child: Text(staffText('Опубликовать', 'Жариялау', 'Publish')),
            ),
            IconButton(
              onPressed: _busy ? null : _reload,
              tooltip: staffText('Обновить', 'Жаңарту', 'Reload'),
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        Text(
          '${staffText('Черновик', 'Нобай', 'Draft')}: $_revision · ${staffText('Опубликовано', 'Жарияланды', 'Published')}: $_published',
        ),
        const SizedBox(height: 18),
        for (final entry in {
          staffText('Профиль', 'Профиль', 'Profile'): () => _profile(false),
          staffText('Оформление', 'Безендіру', 'Theme'): _theme,
          'SEO': () => _profile(true),
        }.entries)
          Card(
            child: ListTile(
              title: Text(entry.key),
              trailing: const Icon(Icons.edit_outlined),
              onTap: _busy ? null : entry.value,
            ),
          ),
        for (final (index, block) in _blocks.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    staffLocalized(block['labels']),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  if (block['enabled'] != true)
                    Text(staffText('Скрыт', 'Жасырылған', 'Hidden')),
                  Wrap(
                    spacing: 4,
                    children: [
                      IconButton(
                        tooltip: staffText('Изменить', 'Өзгерту', 'Edit'),
                        onPressed: _busy ? null : () => _block(block),
                        icon: const Icon(Icons.edit_outlined),
                      ),
                      if (block['type'] == 'link')
                        IconButton(
                          tooltip: staffText(
                            'Оформление',
                            'Безендіру',
                            'Appearance',
                          ),
                          onPressed: _busy
                              ? null
                              : () => _buttonAppearance(block),
                          icon: const Icon(Icons.palette_outlined),
                        ),
                      IconButton(
                        tooltip: staffText('Выше', 'Жоғары', 'Move up'),
                        onPressed: _busy || index == 0
                            ? null
                            : () => _move(index, -1),
                        icon: const Icon(Icons.arrow_upward),
                      ),
                      IconButton(
                        tooltip: staffText('Ниже', 'Төмен', 'Move down'),
                        onPressed: _busy || index == _blocks.length - 1
                            ? null
                            : () => _move(index, 1),
                        icon: const Icon(Icons.arrow_downward),
                      ),
                      IconButton(
                        tooltip: staffText('Копировать', 'Көшіру', 'Duplicate'),
                        onPressed: _busy || _blocks.length >= 40
                            ? null
                            : () {
                                setState(() {
                                  _document!['blocks'] = [
                                    ..._blocks,
                                    {...block, 'id': staffRequestId()},
                                  ];
                                  _dirty = true;
                                });
                              },
                        icon: const Icon(Icons.copy_outlined),
                      ),
                      IconButton(
                        tooltip: staffText('Удалить', 'Жою', 'Delete'),
                        onPressed: _busy ? null : () => _remove(block),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        OutlinedButton.icon(
          onPressed: _busy || _blocks.length >= 40 ? null : () => _block(),
          icon: const Icon(Icons.add),
          label: Text(staffText('Добавить блок', 'Блок қосу', 'Add block')),
        ),
        const SizedBox(height: 18),
        StaffPicker(
          label: staffText('Предпросмотр', 'Алдын ала қарау', 'Preview'),
          value: _locale,
          options: {'ru': 'Русский', 'kk': 'Қазақша'},
          onChanged: (v) => setState(() => _locale = v),
        ),
        const SizedBox(height: 12),
        _preview(),
      ] else if (!_busy)
        OutlinedButton(
          onPressed: _load,
          child: Text(staffText('Повторить', 'Қайталау', 'Retry')),
        ),
    ],
  );
}
