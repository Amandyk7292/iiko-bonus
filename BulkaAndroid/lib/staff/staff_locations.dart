part of '../main.dart';

class StaffDraftCancelled implements Exception {}

class StaffLocations extends StatefulWidget {
  const StaffLocations({required this.api, required this.role, super.key});
  final StaffApiClient api;
  final String role;
  @override
  State<StaffLocations> createState() => _StaffLocationsState();
}

class _StaffLocationsState extends State<StaffLocations> {
  List<Map<String, dynamic>> _locations = [], _cities = [];
  String _city = '';
  bool _loading = false;
  String? _error;
  late final StaffLiveRefresh _live;
  bool get _editAllowed =>
      ['owner', 'admin', 'branch_manager', 'editor'].contains(widget.role);
  bool get _owner => ['owner', 'admin'].contains(widget.role);
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['locations.updated', 'location.updated'],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await Future.wait([
        widget.api.request('/locations'),
        widget.api.request('/locations/cities'),
      ]);
      if (mounted) {
        setState(() {
          _locations = staffRows(result[0]['locations']);
          _cities = staffRows(result[1]['cities']);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<StaffField> get _coordinates => [
    StaffField(
      'latitude',
      staffText('Широта', 'Ендік', 'Latitude'),
      type: 'number',
      required: true,
      minimum: -90,
      maximum: 90,
    ),
    StaffField(
      'longitude',
      staffText('Долгота', 'Бойлық', 'Longitude'),
      type: 'number',
      required: true,
      minimum: -180,
      maximum: 180,
    ),
  ];
  Future<void> _cityCreate() async {
    if (!_owner) return;
    final saved = await staffEdit(
      context,
      title: staffText('Новый город', 'Жаңа қала', 'New city'),
      fields: [
        StaffField(
          'name',
          staffText('Город', 'Қала', 'City'),
          required: true,
          maxLength: 100,
        ),
        ..._coordinates,
      ],
      save: (values) async {
        await widget.api.request(
          '/locations/cities',
          method: 'POST',
          body: values,
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _create() async {
    if (!_owner || _cities.isEmpty) return;
    final saved = await staffEdit(
      context,
      title: staffText('Новый филиал', 'Жаңа филиал', 'New branch'),
      fields: [
        StaffField(
          'cityId',
          staffText('Город', 'Қала', 'City'),
          options: {
            for (final city in _cities) '${city['id']}': '${city['name']}',
          },
        ),
        StaffField(
          'name',
          staffText('Название филиала', 'Филиал атауы', 'Branch name'),
          required: true,
          maxLength: 160,
        ),
        StaffField(
          'address',
          staffText('Полный адрес', 'Толық мекенжай', 'Full address'),
          required: true,
          maxLength: 300,
        ),
        ..._coordinates,
        StaffField(
          'active',
          staffText('Активен', 'Белсенді', 'Active'),
          type: 'bool',
        ),
        StaffField(
          'pickupEnabled',
          staffText('Самовывоз', 'Өзімен алып кету', 'Pickup'),
          type: 'bool',
        ),
        StaffField(
          'preorderEnabled',
          staffText('Предзаказ', 'Алдын ала тапсырыс', 'Preorder'),
          type: 'bool',
        ),
        StaffField(
          'deliveryEnabled',
          staffText('Доставка', 'Жеткізу', 'Delivery'),
          type: 'bool',
        ),
      ],
      initial: {
        'active': true,
        'pickupEnabled': true,
        'preorderEnabled': false,
        'deliveryEnabled': false,
      },
      save: (values) async {
        await widget.api.request('/locations', method: 'POST', body: values);
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _open(Map<String, dynamic> location) async {
    await Navigator.push(
      context,
      StaffPageRoute<void>(
        builder: (_) => StaffLocationDetail(
          api: widget.api,
          location: location,
          canEdit: _editAllowed,
          canRotate: _owner,
        ),
      ),
    );
    if (mounted) unawaited(_load());
  }

  Future<void> _bulkZones() async {
    if (!_owner) return;
    await Navigator.push(
      context,
      StaffPageRoute<void>(
        builder: (_) => StaffZones(
          zones: const [],
          save: (zones) async {
            final confirmed = await staffEdit(
              context,
              title: staffText(
                'Применить зоны ко всем филиалам?',
                'Аймақтарды барлық филиалдарға қолдану керек пе?',
                'Apply zones to all branches?',
              ),
              fields: [
                StaffField(
                  'enableDelivery',
                  staffText(
                    'Включить доставку',
                    'Жеткізуді қосу',
                    'Enable delivery',
                  ),
                  type: 'bool',
                ),
              ],
              save: (values) async {
                await widget.api.request(
                  '/locations/delivery-zones/bulk',
                  method: 'PATCH',
                  body: {...values, 'deliveryZones': zones},
                );
              },
            );
            if (confirmed != true) throw StaffDraftCancelled();
          },
        ),
      ),
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_owner)
          Wrap(
            spacing: 12,
            runSpacing: 10,
            children: [
              FilledButton.icon(
                onPressed: _create,
                icon: const Icon(Icons.add),
                label: Text(staffText('Филиал', 'Филиал', 'Branch')),
              ),
              OutlinedButton(
                onPressed: _cityCreate,
                child: Text(staffText('Новый город', 'Жаңа қала', 'New city')),
              ),
              OutlinedButton(
                onPressed: _bulkZones,
                child: Text(
                  staffText(
                    'Общие зоны доставки',
                    'Ортақ жеткізу аймақтары',
                    'Shared delivery zones',
                  ),
                ),
              ),
            ],
          ),
        const SizedBox(height: 16),
        StaffPicker(
          label: staffText('Город', 'Қала', 'City'),
          value: _city,
          options: {
            '': staffText('Все города', 'Барлық қалалар', 'All cities'),
            for (final city in _cities) '${city['name']}': '${city['name']}',
          },
          onChanged: (value) => setState(() => _city = value),
        ),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        for (final row in _locations.where(
          (row) => _city.isEmpty || row['city'] == _city,
        ))
          Card(
            margin: const EdgeInsets.symmetric(vertical: 8),
            child: ListTile(
              contentPadding: const EdgeInsets.all(18),
              title: Text('${row['name']}'),
              subtitle: Text(
                '${row['address']}\n${row['city']} · ${row['active'] == true ? staffText('Активен', 'Белсенді', 'Active') : staffText('Закрыт', 'Жабылған', 'Closed')}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(row),
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

class StaffLocationDetail extends StatefulWidget {
  const StaffLocationDetail({
    required this.api,
    required this.location,
    required this.canEdit,
    required this.canRotate,
    super.key,
  });
  final StaffApiClient api;
  final Map<String, dynamic> location;
  final bool canEdit, canRotate;
  @override
  State<StaffLocationDetail> createState() => _StaffLocationDetailState();
}

class _StaffLocationDetailState extends State<StaffLocationDetail> {
  late Map<String, dynamic> _location;
  final _map = YandexMapController();
  bool _mapOpen = false;
  LatLng? _point;
  String get _path => '/locations/${Uri.encodeComponent('${_location['id']}')}';
  @override
  void initState() {
    super.initState();
    _location = Map.of(widget.location);
    if (_location['latitude'] is num && _location['longitude'] is num) {
      _point = LatLng(
        (_location['latitude'] as num).toDouble(),
        (_location['longitude'] as num).toDouble(),
      );
    }
  }

  Future<void> _save(Map<String, dynamic> body) async {
    final result = await widget.api.request(_path, method: 'PATCH', body: body);
    if (mounted) {
      setState(
        () => _location = {
          ..._location,
          ...Map<String, dynamic>.from(result['location'] as Map),
        },
      );
    }
  }

  Future<void> _edit(
    String title,
    List<StaffField> fields, {
    Map<String, dynamic>? initial,
    Map<String, dynamic> Function(Map<String, dynamic>)? convert,
  }) async {
    if (!widget.canEdit) return;
    await staffEdit(
      context,
      title: title,
      fields: fields,
      initial: initial ?? _location,
      save: (values) async {
        await _save(convert?.call(values) ?? values);
      },
    );
  }

  Future<void> _hours() async {
    final hours = Map<String, dynamic>.from((_location['hours'] as Map?) ?? {});
    final days = {
      'daily': staffText('Ежедневно', 'Күн сайын', 'Daily'),
      'monday': staffText('Понедельник', 'Дүйсенбі', 'Monday'),
      'tuesday': staffText('Вторник', 'Сейсенбі', 'Tuesday'),
      'wednesday': staffText('Среда', 'Сәрсенбі', 'Wednesday'),
      'thursday': staffText('Четверг', 'Бейсенбі', 'Thursday'),
      'friday': staffText('Пятница', 'Жұма', 'Friday'),
      'saturday': staffText('Суббота', 'Сенбі', 'Saturday'),
      'sunday': staffText('Воскресенье', 'Жексенбі', 'Sunday'),
    };
    final day = await staffChooseFields(
      context,
      staffText('Расписание', 'Кесте', 'Schedule'),
      days,
      ['daily'],
    );
    if (day == null || !mounted) return;
    final key = day.single;
    final value = Map<String, dynamic>.from(
      (hours[key] ??
              hours[key.substring(0, 3)] ??
              hours['daily'] ??
              {'open': '08:00', 'close': '21:00'})
          as Map,
    );
    await _edit(
      days[key]!,
      [
        StaffField(
          'open',
          staffText('Открытие, ЧЧ:ММ', 'Ашылуы, СС:ММ', 'Opening, HH:MM'),
          required: true,
        ),
        StaffField(
          'close',
          staffText('Закрытие, ЧЧ:ММ', 'Жабылуы, СС:ММ', 'Closing, HH:MM'),
          required: true,
        ),
        StaffField(
          'closed',
          staffText('Выходной', 'Демалыс', 'Closed'),
          type: 'bool',
        ),
      ],
      initial: value,
      convert: (values) {
        if (key != 'daily') hours.remove(key.substring(0, 3));
        return {
          'hours': {...hours, key: values},
        };
      },
    );
  }

  Future<void> _credential() async {
    try {
      final result = await widget.api.request('$_path/pos-credential');
      if (!mounted) return;
      final credential = result['credential'] as Map;
      await showDialog<void>(
        context: context,
        builder: (c) => BulkaActionDialog(
          title: Text(
            staffText(
              'Подключение iikoFront',
              'iikoFront қосылымы',
              'iikoFront connection',
            ),
          ),
          content: StaffFacts({
            staffText(
              'Настроено',
              'Бапталған',
              'Configured',
            ): credential['configured'] == true
                ? staffText('Да', 'Иә', 'Yes')
                : staffText('Нет', 'Жоқ', 'No'),
            staffText('Обновлено', 'Жаңартылды', 'Updated'): staffDate(
              credential['rotatedAt'],
            ),
          }),
          actions: [
            if (widget.canRotate)
              FilledButton(
                onPressed: () {
                  Navigator.pop(c);
                  unawaited(_rotate());
                },
                child: Text(
                  staffText(
                    'Создать новый ключ',
                    'Жаңа кілт жасау',
                    'Create new key',
                  ),
                ),
              ),
            TextButton(
              onPressed: () => Navigator.pop(c),
              child: Text(staffText('Закрыть', 'Жабу', 'Close')),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _rotate() async {
    if (!widget.canRotate) return;
    Map<String, dynamic>? secret;
    final saved = await staffEdit(
      context,
      title: staffText(
        'Заменить ключ iikoFront?',
        'iikoFront кілтін ауыстыру керек пе?',
        'Replace iikoFront key?',
      ),
      description: staffText(
        'Текущий ключ перестанет работать. Новый нужно будет указать в iikoFront.',
        'Ағымдағы кілт жұмысын тоқтатады. Жаңасын iikoFront ішінде көрсету қажет.',
        'The current key will stop working. Configure the new key in iikoFront.',
      ),
      fields: [],
      save: (_) async {
        final result = await widget.api.request(
          '$_path/pos-credential/rotate',
          method: 'POST',
        );
        secret = Map<String, dynamic>.from(result['credential'] as Map);
      },
    );
    if (saved != true || !mounted || secret == null) return;
    final config =
        'IIKO_BRANCH_ID=${secret!['branchId']}\nIIKO_BRANCH_POS_TOKEN=${secret!['token']}';
    await showDialog<void>(
      context: context,
      builder: (c) => BulkaActionDialog(
        title: Text(staffText('Новый ключ', 'Жаңа кілт', 'New key')),
        content: SelectableText(config),
        actions: [
          TextButton(
            onPressed: () => Clipboard.setData(ClipboardData(text: config)),
            child: Text(staffText('Скопировать', 'Көшіру', 'Copy')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: Text(staffText('Закрыть', 'Жабу', 'Close')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('${_location['name']}')),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Text(
          '${_location['address']}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        if (widget.canEdit)
          OutlinedButton.icon(
            onPressed: () => _edit(
              staffText(
                'Название и адрес',
                'Атауы мен мекенжайы',
                'Name and address',
              ),
              [
                StaffField(
                  'name',
                  staffText('Название филиала', 'Филиал атауы', 'Branch name'),
                  required: true,
                  maxLength: 160,
                ),
                StaffField(
                  'address',
                  staffText('Полный адрес', 'Толық мекенжай', 'Full address'),
                  required: true,
                  maxLength: 300,
                ),
              ],
            ),
            icon: const Icon(Icons.edit_outlined),
            label: Text(
              staffText(
                'Изменить название и адрес',
                'Атауы мен мекенжайды өзгерту',
                'Edit name and address',
              ),
            ),
          ),
        ExpansionTile(
          initiallyExpanded: false,
          onExpansionChanged: (value) => setState(() => _mapOpen = value),
          title: Text(
            staffText('Точка на карте', 'Картадағы нүкте', 'Map location'),
          ),
          children: [
            if (_mapOpen && _point != null)
              SizedBox(
                height: 300,
                child: YandexMapView(
                  controller: _map,
                  center: _point!,
                  selectedPoint: _point,
                  zoom: 14,
                  branches: [
                    YandexMapBranch(
                      id: '${_location['id']}',
                      name: '${_location['name']}',
                      address: '${_location['address'] ?? ''}',
                      point: _point!,
                      zones: [
                        for (final zone in staffRows(
                          _location['deliveryZones'],
                        ))
                          YandexDeliveryZone(
                            id: '${zone['id']}',
                            radiusKm: (zone['radiusKm'] as num).toDouble(),
                            fee: (zone['fee'] as num).toInt(),
                            minOrder: (zone['minOrder'] as num).toInt(),
                            color: '${zone['color']}',
                          ),
                      ],
                    ),
                  ],
                  semanticLabel: staffText(
                    'Карта филиала',
                    'Филиал картасы',
                    'Branch map',
                  ),
                  unavailableLabel: staffText(
                    'Карта недоступна',
                    'Карта қолжетімсіз',
                    'Map unavailable',
                  ),
                  language: AppLang.current,
                  interactive: widget.canEdit,
                  onTap: widget.canEdit
                      ? (point) => setState(() => _point = point)
                      : null,
                ),
              ),
            if (widget.canEdit) ...[
              OutlinedButton(
                onPressed: () => _edit(
                  staffText('Координаты', 'Координаттар', 'Coordinates'),
                  [
                    StaffField(
                      'latitude',
                      staffText('Широта', 'Ендік', 'Latitude'),
                      type: 'number',
                      required: true,
                      minimum: -90,
                      maximum: 90,
                    ),
                    StaffField(
                      'longitude',
                      staffText('Долгота', 'Бойлық', 'Longitude'),
                      type: 'number',
                      required: true,
                      minimum: -180,
                      maximum: 180,
                    ),
                  ],
                  initial: {
                    'latitude': _point?.latitude,
                    'longitude': _point?.longitude,
                  },
                  convert: (values) {
                    _point = LatLng(
                      (values['latitude'] as num).toDouble(),
                      (values['longitude'] as num).toDouble(),
                    );
                    return values;
                  },
                ),
                child: Text(
                  staffText(
                    'Ввести координаты',
                    'Координаттарды енгізу',
                    'Enter coordinates',
                  ),
                ),
              ),
              if (_point != null)
                FilledButton(
                  onPressed: () => _edit(
                    staffText(
                      'Сохранить точку?',
                      'Нүктені сақтау керек пе?',
                      'Save map point?',
                    ),
                    [],
                    convert: (_) => {
                      'latitude': _point!.latitude,
                      'longitude': _point!.longitude,
                    },
                  ),
                  child: Text(
                    staffText(
                      'Сохранить точку',
                      'Нүктені сақтау',
                      'Save point',
                    ),
                  ),
                ),
            ],
          ],
        ),
        StaffFacts({
          staffText('Самовывоз', 'Өзімен алып кету', 'Pickup'):
              _location['pickupEnabled'] == true ? '✓' : '—',
          staffText('Доставка', 'Жеткізу', 'Delivery'):
              _location['deliveryEnabled'] == true ? '✓' : '—',
          staffText('Предзаказ', 'Алдын ала тапсырыс', 'Preorder'):
              _location['preorderEnabled'] == true ? '✓' : '—',
        }),
        if (widget.canEdit) ...[
          OutlinedButton(
            onPressed: () => _edit(
              staffText('Доступность', 'Қолжетімділік', 'Availability'),
              [
                for (final field in {
                  'active': staffText('Активен', 'Белсенді', 'Active'),
                  'pickupEnabled': staffText(
                    'Самовывоз',
                    'Өзімен алып кету',
                    'Pickup',
                  ),
                  'deliveryEnabled': staffText(
                    'Доставка',
                    'Жеткізу',
                    'Delivery',
                  ),
                  'preorderEnabled': staffText(
                    'Предзаказ',
                    'Алдын ала тапсырыс',
                    'Preorder',
                  ),
                }.entries)
                  StaffField(field.key, field.value, type: 'bool'),
              ],
            ),
            child: Text(
              staffText('Доступность', 'Қолжетімділік', 'Availability'),
            ),
          ),
          OutlinedButton(
            onPressed: _hours,
            child: Text(staffText('Расписание', 'Кесте', 'Schedule')),
          ),
          OutlinedButton(
            onPressed: () => _edit(
              staffText(
                'Слоты и вместимость',
                'Слоттар мен сыйымдылық',
                'Slots and capacity',
              ),
              [
                StaffField(
                  'slotMinutes',
                  staffText('Интервал, мин', 'Аралық, мин', 'Interval, min'),
                  type: 'number',
                  required: true,
                  minimum: 15,
                  maximum: 240,
                ),
                for (final entry in {
                  'pickupSlotCapacity': staffText(
                    'Самовывоз',
                    'Өзімен алып кету',
                    'Pickup',
                  ),
                  'preorderSlotCapacity': staffText(
                    'Предзаказ',
                    'Алдын ала тапсырыс',
                    'Preorder',
                  ),
                  'deliverySlotCapacity': staffText(
                    'Доставка',
                    'Жеткізу',
                    'Delivery',
                  ),
                }.entries)
                  StaffField(
                    entry.key,
                    entry.value,
                    type: 'number',
                    required: true,
                    minimum: 1,
                    maximum: 500,
                  ),
              ],
            ),
            child: Text(
              staffText(
                'Слоты и вместимость',
                'Слоттар мен сыйымдылық',
                'Slots and capacity',
              ),
            ),
          ),
          OutlinedButton(
            onPressed: () => Navigator.push(
              context,
              StaffPageRoute<void>(
                builder: (_) => StaffZones(
                  zones: staffRows(_location['deliveryZones']),
                  save: (zones) => _save({'deliveryZones': zones}),
                ),
              ),
            ),
            child: Text(
              staffText('Зоны доставки', 'Жеткізу аймақтары', 'Delivery zones'),
            ),
          ),
        ],
        OutlinedButton(
          onPressed: _credential,
          child: Text(
            staffText(
              'Подключение iikoFront',
              'iikoFront қосылымы',
              'iikoFront connection',
            ),
          ),
        ),
      ],
    ),
  );
  @override
  void dispose() {
    _map.dispose();
    super.dispose();
  }
}

class StaffZones extends StatefulWidget {
  const StaffZones({required this.zones, required this.save, super.key});
  final List<Map<String, dynamic>> zones;
  final Future<void> Function(List<Map<String, dynamic>>) save;
  @override
  State<StaffZones> createState() => _StaffZonesState();
}

class _StaffZonesState extends State<StaffZones> {
  late List<Map<String, dynamic>> _zones;
  bool _busy = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _zones = widget.zones.map((row) => Map<String, dynamic>.from(row)).toList();
  }

  Future<void> _edit([int? index]) async {
    if (_busy) return;
    if (index == null && _zones.length >= 8) return;
    await staffEdit(
      context,
      title: staffText('Зона доставки', 'Жеткізу аймағы', 'Delivery zone'),
      fields: [
        StaffField(
          'radiusKm',
          staffText('Радиус, км', 'Радиус, км', 'Radius, km'),
          type: 'number',
          required: true,
          minimum: 0.001,
          maximum: 100,
        ),
        StaffField(
          'fee',
          staffText('Стоимость, ₸', 'Бағасы, ₸', 'Fee, ₸'),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 100000,
        ),
        StaffField(
          'minOrder',
          staffText(
            'Минимальный заказ, ₸',
            'Ең аз тапсырыс, ₸',
            'Minimum order, ₸',
          ),
          type: 'number',
          required: true,
          minimum: 0,
          maximum: 10000000,
        ),
        StaffField(
          'color',
          staffText('Цвет #RRGGBB', 'Түс #RRGGBB', 'Color #RRGGBB'),
          required: true,
          maxLength: 7,
        ),
      ],
      initial: index == null
          ? {'radiusKm': 5, 'fee': 700, 'minOrder': 3000, 'color': '#66BB6A'}
          : _zones[index],
      save: (values) async {
        if (!RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch('${values['color']}')) {
          throw Exception(
            staffText('Неверный цвет', 'Түс қате', 'Invalid color'),
          );
        }
        for (final key in ['fee', 'minOrder']) {
          final n = values[key] as num;
          if (n != n.roundToDouble()) {
            throw Exception(
              staffText(
                'Введите целую сумму',
                'Бүтін соманы енгізіңіз',
                'Enter a whole amount',
              ),
            );
          }
        }
        setState(() {
          final zone = {
            'id': index == null ? staffRequestId() : _zones[index]['id'],
            ...values,
          };
          if (index == null) {
            _zones.add(zone);
          } else {
            _zones[index] = zone;
          }
          _zones.sort(
            (a, b) => (a['radiusKm'] as num).compareTo(b['radiusKm'] as num),
          );
        });
      },
    );
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_zones.isEmpty ||
          _zones.length > 8 ||
          _zones.map((z) => z['radiusKm']).toSet().length != _zones.length) {
        throw Exception(
          staffText(
            'Нужны от 1 до 8 зон с разными радиусами',
            'Радиустары әртүрлі 1–8 аймақ қажет',
            'Use 1–8 zones with distinct radii',
          ),
        );
      }
      await widget.save(_zones);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted && e is! StaffDraftCancelled) setState(() => _error = '$e');
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
          staffText('Зоны доставки', 'Жеткізу аймақтары', 'Delivery zones'),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          for (var i = 0; i < _zones.length; i++)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${_zones[i]['radiusKm']} км · ${staffMoney(_zones[i]['fee'])}',
                    ),
                    Text(
                      '${staffText('Заказ от', 'Тапсырыс', 'Order from')} ${staffMoney(_zones[i]['minOrder'])}',
                    ),
                    Wrap(
                      spacing: 12,
                      children: [
                        OutlinedButton(
                          onPressed: _busy ? null : () => _edit(i),
                          child: Text(staffText('Изменить', 'Өзгерту', 'Edit')),
                        ),
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => setState(() => _zones.removeAt(i)),
                          child: Text(staffText('Удалить', 'Жою', 'Delete')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          if (_zones.length < 8)
            OutlinedButton.icon(
              onPressed: _busy ? null : () => _edit(),
              icon: const Icon(Icons.add),
              label: Text(staffText('Добавить зону', 'Аймақ қосу', 'Add zone')),
            ),
          if (_error != null)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    staffText(
                      'Сохранить зоны',
                      'Аймақтарды сақтау',
                      'Save zones',
                    ),
                  ),
          ),
        ],
      ),
    ),
  );
}
