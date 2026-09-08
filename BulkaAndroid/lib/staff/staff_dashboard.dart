part of '../main.dart';

const _staffSalesFilters = [
  {
    'field': 'OrderDeleted',
    'values': ['NOT_DELETED'],
    'exclude': false,
  },
  {
    'field': 'DeletedWithWriteoff',
    'values': ['NOT_DELETED'],
    'exclude': false,
  },
];

class StaffDashboard extends StatefulWidget {
  const StaffDashboard({required this.api, super.key});
  final StaffApiClient api;
  @override
  State<StaffDashboard> createState() => _StaffDashboardState();
}

class _StaffDashboardState extends State<StaffDashboard>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _servers = [];
  String _server = '', _department = '', _tab = 'overview', _view = 'branches';
  List<String> _departments = [];
  late DateTime _to = _businessToday();
  late DateTime _from = _to.subtract(const Duration(days: 6));
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = false, _auto = true, _foreground = true, _onlyFlags = false;
  int _generation = 0;
  bool _exporting = false;
  double _discountThreshold = 30, _returnThreshold = 50000;
  List<String> _metrics = [
    'DishDiscountSumInt',
    'UniqOrderId',
    'AverageCheck',
    'DiscountSum',
  ];
  String _comparison = 'previous';
  Map<String, dynamic>? _previous, _trend;
  Map<String, dynamic>? _stockRaw, _rankingPrevious;
  Map<String, dynamic> _focus = {};
  String _rankMetric = 'DishDiscountSumInt',
      _stockStore = '',
      _stockGroup = '',
      _stockFilter = 'all';
  bool _adviceOnly = false;
  Map<String, dynamic> get _rankingQuery => {
    ..._scope,
    'view': _view,
    ..._focus,
  };
  Timer? _timer;
  final _scroll = ScrollController();
  DateTime _businessToday() {
    final now = DateTime.now().toUtc().add(const Duration(hours: 5));
    return DateTime(now.year, now.month, now.day);
  }

  String _date(DateTime value) =>
      '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  Map<String, dynamic> get _scope => {
    'serverId': _server,
    'from': _date(_from),
    'to': _date(_to),
    'department': _department,
  };
  Map<String, dynamic> get _base => {
    'serverId': _server,
    'from': _date(_from),
    'to': _date(_to),
    'reportType': 'SALES',
    'groupBy': <String>[],
    'aggregate': [
      'DishDiscountSumInt',
      'UniqOrderId',
      'DiscountSum',
      'DishAmountInt',
      'GuestNum',
      'ProductCostBase.ProductCost',
    ],
    'filters': [
      ..._staffSalesFilters,
      if (_department.isNotEmpty)
        {
          'field': 'Department',
          'values': [_department],
          'exclude': false,
        },
    ],
  };
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initialize());
    _timer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (_auto && _foreground && !_loading) unawaited(_load());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground && _auto && !_loading) unawaited(_load());
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    _scroll.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _initialize() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      _auto = prefs.getBool('staff_dashboard_auto') ?? true;
      final stored = prefs.getStringList('staff_dashboard_metrics');
      if (stored != null &&
          stored.isNotEmpty &&
          stored.every(staffDashboardMetricIds.containsValue)) {
        _metrics = stored.toSet().toList();
      }
      _comparison = prefs.getString('staff_dashboard_comparison') ?? 'previous';
      if (!['previous', 'year', 'none'].contains(_comparison)) {
        _comparison = 'previous';
      }
      _discountThreshold =
          (prefs.getDouble('staff_dashboard_discount_threshold') ?? 30).clamp(
            1,
            100,
          );
      _returnThreshold =
          (prefs.getDouble('staff_dashboard_return_threshold') ?? 50000).clamp(
            1,
            10000000,
          );
      final result = await widget.api.request('/iiko-dashboard/servers');
      if (!mounted) return;
      final servers = (result['servers'] as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((e) => e['active'] == true && e['configured'] == true)
          .toList();
      setState(() {
        _servers = servers;
        _server = servers.any((e) => e['id'] == 'aktau-chain')
            ? 'aktau-chain'
            : servers.isNotEmpty
            ? '${servers.first['id']}'
            : '';
      });
      await _load();
      unawaited(_loadDepartments());
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = '$error';
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadDepartments() async {
    if (_server.isEmpty) return;
    final scope = '$_server|${_date(_from)}|${_date(_to)}';
    try {
      final result = await widget.api.report('/iiko-dashboard/report', {
        ..._base,
        'filters': _staffSalesFilters,
        'groupBy': ['Department'],
        'aggregate': ['DishDiscountSumInt'],
      });
      if (!mounted || scope != '$_server|${_date(_from)}|${_date(_to)}') return;
      setState(() {
        _departments =
            (result['rows'] as List? ?? [])
                .whereType<Map>()
                .map((e) => '${e['Department'] ?? ''}')
                .where((e) => e.isNotEmpty)
                .toSet()
                .toList()
              ..sort();
      });
    } catch (_) {
      /* Reports remain usable even when the optional branch list fails. */
    }
  }

  Future<void> _load({bool clear = false}) async {
    if (_server.isEmpty) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    final generation = ++_generation;
    if (_tab == 'reports' || _tab == 'settings') {
      setState(() {
        _loading = false;
        _data = null;
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      if (clear) {
        _data = null;
        _previous = null;
        _trend = null;
        _rankingPrevious = null;
      }
    });
    try {
      final Map<String, dynamic> result;
      if (_tab == 'overview') {
        result = await widget.api.report(
          '/iiko-dashboard/report',
          _base,
          isCancelled: () => !mounted || generation != _generation,
        );
      } else if (_tab == 'rankings') {
        result = await widget.api.report(
          '/iiko-dashboard/analytics',
          _rankingQuery,
          isCancelled: () => !mounted || generation != _generation,
        );
      } else if (_tab == 'balances') {
        final raw = Map<String, dynamic>.from(
          await widget.api.request(
                '/iiko-dashboard/balances?${Uri(queryParameters: {'serverId': _server, 'date': _date(_to)}).query}',
              )
              as Map,
        );
        result = _balanceReport(raw);
        if (mounted && generation == _generation) _stockRaw = raw;
      } else {
        result = await widget.api.report(
          '/iiko-dashboard/controls',
          {
            ..._scope,
            'mode': _tab,
            'discountThreshold': _discountThreshold,
            'returnThreshold': _returnThreshold,
          },
          isCancelled: () => !mounted || generation != _generation,
        );
      }
      if (mounted && generation == _generation) setState(() => _data = result);
      if (_tab == 'rankings' &&
          generation == _generation &&
          _comparison != 'none') {
        unawaited(
          _compareRanking(generation, Map<String, dynamic>.from(_rankingQuery)),
        );
      }
      if (_tab == 'overview' && generation == _generation) {
        unawaited(
          _loadComparison(generation, Map<String, dynamic>.from(_base)),
        );
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

  Map<String, dynamic> _balanceReport(Map<String, dynamic> raw) {
    final products = {
      for (final p in (raw['products'] as List? ?? []).whereType<Map>())
        '${p['id']}': p,
    };
    final stores = {
      for (final s in (raw['stores'] as List? ?? []).whereType<Map>())
        '${s['id']}': s['name'],
    };
    final groups = {
      for (final group in staffRows(raw['groups']))
        '${group['id']}': '${group['name']}',
    };
    return {
      'fetchedAt': raw['fetchedAt'],
      'columns': {
        for (final key in [
          'product',
          'group',
          'store',
          'amount',
          'sum',
          'min',
          'max',
        ])
          key: {'name': staffFieldLabel(key)},
      },
      'rows': [
        for (final row in (raw['rows'] as List? ?? []).whereType<Map>())
          {
            ...row,
            'product': products['${row['product']}']?['name'] ?? row['product'],
            'store': stores['${row['store']}'] ?? row['store'],
            'storeId': row['store'],
            'groupId': products['${row['product']}']?['parent'],
            'group':
                groups['${products['${row['product']}']?['parent']}'] ?? '',
            for (final key in ['min', 'max'])
              key:
                  staffRows(
                        products['${row['product']}']?['storeBalanceLevels'],
                      )
                      .where((level) => level['storeId'] == row['store'])
                      .firstOrNull?['${key}BalanceLevel'],
          },
      ],
    };
  }

  Future<void> _period() async {
    final range = await showDateRangePicker(
      context: context,
      initialDateRange: DateTimeRange(start: _from, end: _to),
      firstDate: DateTime(2020),
      lastDate: _businessToday(),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
      helpText: staffText('Период отчёта', 'Есеп кезеңі', 'Report period'),
      saveText: staffText('Применить', 'Қолдану', 'Apply'),
    );
    if (range == null || !mounted) return;
    if (range.end.difference(range.start).inDays > 366) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            staffText(
              'Выберите не более 367 дней',
              '367 күннен аспайтын кезеңді таңдаңыз',
              'Select no more than 367 days',
            ),
          ),
        ),
      );
      return;
    }
    setState(() {
      _from = range.start;
      _to = range.end;
    });
    unawaited(_load(clear: true));
    unawaited(_loadDepartments());
  }

  Map<String, dynamic> _comparisonQuery(Map<String, dynamic> query) {
    final from = DateTime.parse('${query['from']}'),
        to = DateTime.parse('${query['to']}');
    final days = to.difference(from).inDays + 1;
    DateTime previous(DateTime d) => _comparison == 'year'
        ? DateTime(
            d.year - 1,
            d.month,
            min(d.day, DateTime(d.year - 1, d.month + 1, 0).day),
          )
        : d.subtract(Duration(days: days));
    return {...query, 'from': _date(previous(from)), 'to': _date(previous(to))};
  }

  Future<void> _compareRanking(
    int generation,
    Map<String, dynamic> query,
  ) async {
    try {
      final previous = await widget.api.report(
        '/iiko-dashboard/analytics',
        _comparisonQuery(query),
        isCancelled: () => !mounted || generation != _generation,
      );
      if (mounted && generation == _generation) {
        setState(() => _rankingPrevious = previous);
      }
    } catch (e) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = staffText(
            'Не удалось получить сравнение. Текущий период показан.',
            'Салыстыру жүктелмеді. Ағымдағы кезең көрсетілді.',
            'Comparison unavailable. Current period is shown.',
          ),
        );
      }
    }
  }

  Map<String, dynamic> _rankingDisplay(Map<String, dynamic> report) {
    final columns = Map<String, dynamic>.from(report['columns'] as Map? ?? {});
    final previous = _rankingPrevious;
    String identity(Map row) => jsonEncode(
      columns.entries
          .where(
            (e) =>
                ![
                  'MONEY',
                  'AMOUNT',
                  'INTEGER',
                  'NUMBER',
                  'PERCENT',
                ].contains((e.value as Map?)?['type']) &&
                e.key != 'WriteoffQuantity',
          )
          .map((e) => row[e.key])
          .toList(),
    );
    final prior = {
      if (previous != null)
        for (final row in staffRows(previous['rows'])) identity(row): row,
    };
    final rows =
        staffRows(report['rows']).map((row) {
          final old = prior[identity(row)]?[_rankMetric];
          final value = row[_rankMetric];
          return {
            ...row,
            if (previous != null) ...{
              'PreviousValue': old,
              'ChangePercent': old is num && old != 0 && value is num
                  ? (value - old) / old.abs() * 100
                  : null,
            },
          };
        }).toList()..sort(
          (a, b) => ((b[_rankMetric] as num?) ?? -double.infinity).compareTo(
            (a[_rankMetric] as num?) ?? -double.infinity,
          ),
        );
    return {
      ...report,
      'columns': {
        for (final e in columns.entries)
          if (!['Cashier.Id', 'DishId', 'Product.Id'].contains(e.key))
            e.key: e.value,
        if (previous != null) ...{
          'PreviousValue': {
            'name':
                '${staffText('Ранее', 'Бұрын', 'Previous')} · ${staffFieldLabel(_rankMetric)}',
            'type': 'NUMBER',
          },
          'ChangePercent': {
            'name': staffText('Изменение, %', 'Өзгеріс, %', 'Change, %'),
            'type': 'NUMBER',
          },
        },
      },
      'rows': rows,
    };
  }

  void _drill(Map<String, dynamic> row) {
    if (_view == 'branches') {
      _focus = {'department': '${row['Department']}'};
      _view = 'cashiers';
    } else if (_view == 'cashiers' && row['Cashier.Id'] != null) {
      _focus = {
        'department': '${row['Department']}',
        'cashierId': '${row['Cashier.Id']}',
      };
      _view = 'cashierProducts';
    } else if (_view == 'products' && row['DishId'] != null) {
      _focus = {'productId': '${row['DishId']}'};
      _view = 'productBranches';
    } else {
      return;
    }
    unawaited(_load(clear: true));
  }

  Widget _stockControls() => Column(
    children: [
      StaffPicker(
        label: staffText('Склад', 'Қойма', 'Store'),
        value: _stockStore,
        options: {
          '': staffText('Все склады', 'Барлық қоймалар', 'All stores'),
          for (final store in staffRows(_stockRaw?['stores']))
            '${store['id']}': '${store['name']}',
        },
        onChanged: (v) => setState(() => _stockStore = v),
      ),
      const SizedBox(height: 10),
      StaffPicker(
        label: staffText('Группа товаров', 'Тауар тобы', 'Product group'),
        value: _stockGroup,
        options: {
          '': staffText('Все группы', 'Барлық топтар', 'All groups'),
          for (final group in staffRows(_stockRaw?['groups']))
            '${group['id']}': '${group['name']}',
        },
        onChanged: (v) => setState(() => _stockGroup = v),
      ),
      const SizedBox(height: 10),
      StaffPicker(
        label: staffText(
          'Контроль остатков',
          'Қалдықтарды бақылау',
          'Stock check',
        ),
        value: _stockFilter,
        options: {
          'all': staffText('Все', 'Барлығы', 'All'),
          'negative': staffText('Отрицательные', 'Теріс', 'Negative'),
          'below': staffText(
            'Ниже минимума',
            'Минимумнан төмен',
            'Below minimum',
          ),
          'above': staffText(
            'Выше максимума',
            'Максимумнан жоғары',
            'Above maximum',
          ),
        },
        onChanged: (v) => setState(() => _stockFilter = v),
      ),
      const SizedBox(height: 16),
    ],
  );
  Map<String, dynamic> _filterStock(Map<String, dynamic> report) => {
    ...report,
    'rows': staffRows(report['rows']).where((row) {
      final amount = num.tryParse('${row['amount']}');
      return (_stockStore.isEmpty || row['storeId'] == _stockStore) &&
          (_stockGroup.isEmpty || row['groupId'] == _stockGroup) &&
          switch (_stockFilter) {
            'negative' => amount != null && amount < 0,
            'below' =>
              amount != null &&
                  row['min'] is num &&
                  amount < (row['min'] as num),
            'above' =>
              amount != null &&
                  row['max'] is num &&
                  amount > (row['max'] as num),
            _ => true,
          };
    }).toList(),
  };

  Future<void> _receipt(Map<String, dynamic> row) async {
    final server = _server;
    await Navigator.of(context).push<void>(
      StaffPageRoute(
        builder: (_) =>
            _StaffReceiptPage(api: widget.api, server: server, row: row),
      ),
    );
  }

  Future<void> _loadComparison(
    int generation,
    Map<String, dynamic> base,
  ) async {
    final from = DateTime.parse('${base['from']}'),
        to = DateTime.parse('${base['to']}');
    final days = to.difference(from).inDays + 1;
    DateTime shiftYear(DateTime d) => DateTime(
      d.year - 1,
      d.month,
      min(d.day, DateTime(d.year - 1, d.month + 1, 0).day),
    );
    final comparison = _comparison;
    final previous = {
      ...base,
      'from': _date(
        comparison == 'year'
            ? shiftYear(from)
            : from.subtract(Duration(days: days)),
      ),
      'to': _date(
        comparison == 'year'
            ? shiftYear(to)
            : to.subtract(Duration(days: days)),
      ),
    };
    final requests = <Future<void>>[
      () async {
        try {
          final result = await widget.api.report(
            '/iiko-dashboard/report',
            {
              ...base,
              'groupBy': ['OpenDate.Typed'],
            },
            isCancelled: () => !mounted || generation != _generation,
          );
          if (mounted && generation == _generation) {
            setState(() => _trend = result);
          }
        } catch (_) {
          /* Summary remains usable if the optional chart is unavailable. */
        }
      }(),
      if (comparison != 'none')
        () async {
          try {
            final result = await widget.api.report(
              '/iiko-dashboard/report',
              previous,
              isCancelled: () => !mounted || generation != _generation,
            );
            if (mounted && generation == _generation) {
              setState(() => _previous = result);
            }
          } catch (_) {
            /* Missing comparison is displayed as unavailable, never as zero. */
          }
        }(),
    ];
    await Future.wait(requests);
  }

  Map<String, dynamic> _totals(Map<String, dynamic>? report) {
    final rows = (report?['rows'] as List? ?? []).whereType<Map>();
    final row = rows.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(rows.first);
    final count = row['UniqOrderId'], revenue = row['DishDiscountSumInt'];
    row['AverageCheck'] = count is num && count > 0 && revenue is num
        ? revenue / count
        : null;
    return row;
  }

  Widget _overview(Map<String, dynamic> report) {
    final current = _totals(report), previous = _totals(_previous);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _StaffMetricGrid(
          values: {for (final key in _metrics) key: current[key]},
        ),
        if (_comparison != 'none')
          ExpansionTile(
            title: Text(
              staffText(
                'Сравнение с прошлым периодом',
                'Алдыңғы кезеңмен салыстыру',
                'Period comparison',
              ),
            ),
            subtitle: Text(
              _previous == null
                  ? '—'
                  : '${(_previous!['period'] as Map?)?['from'] ?? ''} — ${(_previous!['period'] as Map?)?['to'] ?? ''}',
            ),
            children: [
              for (final key in _metrics)
                ListTile(
                  title: Text(staffFieldLabel(key)),
                  subtitle: Text(
                    '${staffValue(previous[key])} → ${staffValue(current[key])}',
                  ),
                  trailing:
                      current[key] is num &&
                          previous[key] is num &&
                          previous[key] != 0
                      ? Text(
                          '${staffValue(((current[key] as num) - (previous[key] as num)) / (previous[key] as num).abs() * 100)}%',
                        )
                      : const Text('—'),
                ),
            ],
          ),
        if (_trend != null)
          ExpansionTile(
            title: Text(
              staffText('Выручка по дням', 'Күндік түсім', 'Daily revenue'),
            ),
            children: [
              StaffTrendChart(
                rows: staffRows(_trend!['rows']),
                x: 'OpenDate.Typed',
                y: 'DishDiscountSumInt',
              ),
              StaffReport(report: _trend!),
            ],
          ),
      ],
    );
  }

  Future<void> _savePreferences() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('staff_dashboard_auto', _auto);
      await prefs.setStringList('staff_dashboard_metrics', _metrics);
      await prefs.setString('staff_dashboard_comparison', _comparison);
      await prefs.setDouble(
        'staff_dashboard_discount_threshold',
        _discountThreshold,
      );
      await prefs.setDouble(
        'staff_dashboard_return_threshold',
        _returnThreshold,
      );
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = staffText(
            'Настройки не сохранены. Повторите изменение.',
            'Баптаулар сақталмады. Өзгерісті қайталаңыз.',
            'Settings were not saved. Retry the change.',
          ),
        );
      }
    }
  }

  Future<void> _profileFile(bool importing) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (importing) {
        final data = await staffImportDashboardPreferences();
        if (data == null || !mounted) return;
        final accepted = await staffEdit(
          context,
          title: staffText(
            'Заменить настройки отчётов?',
            'Есеп баптауларын ауыстыру керек пе?',
            'Replace report settings?',
          ),
          description:
              '${(data['cards'] as List).length} ${staffText('карточек', 'карточка', 'cards')} · ${(data['templates'] as List).length} ${staffText('шаблонов', 'үлгі', 'templates')}',
          fields: [],
          save: (_) async {
            await prefs.setString(
              'staff_report_templates_v1',
              jsonEncode(data['templates']),
            );
            final cards = (data['cards'] as List)
                .map((id) => staffDashboardMetricIds[id]!)
                .toList();
            await prefs.setStringList('staff_dashboard_metrics', cards);
            await prefs.setBool('staff_dashboard_auto', data['auto'] as bool);
            if (mounted) {
              setState(() {
                _metrics = cards;
                _auto = data['auto'] as bool;
              });
            }
          },
        );
        if (accepted == true && mounted) setState(() => _error = null);
      } else {
        final templates = staffValidateTemplates(
          jsonDecode(prefs.getString('staff_report_templates_v1') ?? '[]'),
        );
        if (mounted) {
          await staffShareJson(context, {
            'cards': _metrics
                .map(
                  (field) => staffDashboardMetricIds.entries
                      .firstWhere((e) => e.value == field)
                      .key,
                )
                .toList(),
            'templates': templates,
            'auto': _auto,
          }, 'iiko-dashboard-settings.json');
        }
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Widget _settings() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        staffText(
          'Карточки показателей',
          'Көрсеткіш карточкалары',
          'Metric cards',
        ),
        style: Theme.of(context).textTheme.titleLarge,
      ),
      const SizedBox(height: 12),
      for (final (index, key) in _metrics.indexed)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(staffFieldLabel(key)),
          trailing: Wrap(
            children: [
              IconButton(
                tooltip: staffText('Выше', 'Жоғары', 'Move up'),
                onPressed: index == 0
                    ? null
                    : () {
                        setState(() {
                          _metrics.removeAt(index);
                          _metrics.insert(index - 1, key);
                        });
                        unawaited(_savePreferences());
                      },
                icon: const Icon(Icons.arrow_upward),
              ),
              IconButton(
                tooltip: staffText('Ниже', 'Төмен', 'Move down'),
                onPressed: index == _metrics.length - 1
                    ? null
                    : () {
                        setState(() {
                          _metrics.removeAt(index);
                          _metrics.insert(index + 1, key);
                        });
                        unawaited(_savePreferences());
                      },
                icon: const Icon(Icons.arrow_downward),
              ),
            ],
          ),
        ),
      for (final key in [
        'DishDiscountSumInt',
        'UniqOrderId',
        'AverageCheck',
        'DiscountSum',
        'DishAmountInt',
        'GuestNum',
        'ProductCostBase.ProductCost',
      ])
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(staffFieldLabel(key)),
          value: _metrics.contains(key),
          onChanged: (value) {
            setState(() {
              if (value == true) {
                _metrics.add(key);
              } else if (_metrics.length > 1) {
                _metrics.remove(key);
              }
            });
            unawaited(_savePreferences());
          },
        ),
      const SizedBox(height: 16),
      Text(
        staffText('Период сравнения', 'Салыстыру кезеңі', 'Comparison period'),
      ),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final e in {
            'previous': staffText('Предыдущий', 'Алдыңғы', 'Previous'),
            'year': staffText('Прошлый год', 'Өткен жыл', 'Last year'),
            'none': staffText('Без сравнения', 'Салыстырусыз', 'None'),
          }.entries)
            ChoiceChip(
              label: Text(e.value),
              selected: _comparison == e.key,
              onSelected: (_) {
                setState(() {
                  _comparison = e.key;
                  _previous = null;
                });
                unawaited(_savePreferences());
              },
            ),
        ],
      ),
      const SizedBox(height: 16),
      TextFormField(
        initialValue: '$_discountThreshold',
        decoration: InputDecoration(
          labelText: staffText(
            'Скидка для проверки, %',
            'Тексерілетін жеңілдік, %',
            'Discount threshold, %',
          ),
        ),
        keyboardType: TextInputType.number,
        onChanged: (value) {
          final n = double.tryParse(value.replaceAll(',', '.'));
          if (n != null && n >= 1 && n <= 100) {
            _discountThreshold = n;
            unawaited(_savePreferences());
          }
        },
      ),
      const SizedBox(height: 16),
      TextFormField(
        initialValue: '$_returnThreshold',
        decoration: InputDecoration(
          labelText: staffText(
            'Возврат для проверки, ₸',
            'Тексерілетін қайтару, ₸',
            'Refund threshold, ₸',
          ),
        ),
        keyboardType: TextInputType.number,
        onChanged: (value) {
          final n = double.tryParse(value.replaceAll(',', '.'));
          if (n != null && n >= 1 && n <= 10000000) {
            _returnThreshold = n;
            unawaited(_savePreferences());
          }
        },
      ),
      const SizedBox(height: 16),
      Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          OutlinedButton.icon(
            onPressed: () => _profileFile(false),
            icon: const Icon(Icons.ios_share),
            label: Text(
              staffText(
                'Экспорт настроек',
                'Баптауларды экспорттау',
                'Export settings',
              ),
            ),
          ),
          OutlinedButton.icon(
            onPressed: () => _profileFile(true),
            icon: const Icon(Icons.file_open_outlined),
            label: Text(
              staffText(
                'Импорт настроек',
                'Баптауларды импорттау',
                'Import settings',
              ),
            ),
          ),
        ],
      ),
      ExpansionTile(
        title: Text(
          staffText(
            'Подключённые серверы',
            'Қосылған серверлер',
            'Connected servers',
          ),
        ),
        children: [
          for (final server in _servers)
            ListTile(
              title: Text('${server['host']}'),
              subtitle: Text('${server['city']} · ${server['kind']}'),
              trailing: const Icon(Icons.check_circle_outline),
            ),
        ],
      ),
    ],
  );

  Future<void> _export() async {
    if (_exporting || _data == null) return;
    setState(() => _exporting = true);
    final scope = Map<String, dynamic>.from(_scope),
        base = Map<String, dynamic>.from(_base),
        tab = _tab,
        view = _view;
    try {
      final Uint8List bytes;
      if (tab == 'overview') {
        bytes = await widget.api.exportFile(
          '/iiko-dashboard/export',
          body: {
            ...base,
            'groupBy': ['OpenDate.Typed'],
          },
        );
      } else if (tab == 'rankings') {
        bytes = await widget.api.exportFile(
          '/iiko-dashboard/analytics/export',
          body: {...scope, 'view': view, ..._focus},
        );
      } else if (tab == 'balances') {
        bytes = await widget.api.exportFile(
          '/iiko-dashboard/balances/export?${Uri(queryParameters: {'serverId': '${scope['serverId']}', 'date': '${scope['to']}', 'store': _stockStore, 'group': _stockGroup, 'filter': _stockFilter}).query}',
          method: 'GET',
        );
      } else {
        bytes = await widget.api.exportFile(
          '/iiko-dashboard/controls/export',
          body: {
            'query': {
              ...scope,
              'mode': tab,
              'discountThreshold': _discountThreshold,
              'returnThreshold': _returnThreshold,
            },
            'table': view,
            'flaggedOnly': _onlyFlags && tab == 'operations',
            'adviceOnly': _adviceOnly && tab == 'assortment',
          },
        );
      }
      if (mounted) {
        await shareStaffExport(
          context,
          bytes,
          'iiko-$tab-${scope['from']}-${scope['to']}.xlsx',
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Map<String, String> get _tabs => {
    'overview': staffText('Показатели', 'Көрсеткіштер', 'Overview'),
    'rankings': staffText('Рейтинги', 'Рейтингтер', 'Rankings'),
    'reports': staffText('Отчёты', 'Есептер', 'Reports'),
    'writeoffs': staffText('Списания', 'Есептен шығару', 'Write-offs'),
    'operations': staffText(
      'Скидки и возвраты',
      'Жеңілдіктер мен қайтарулар',
      'Discounts & returns',
    ),
    'assortment': staffText('Ассортимент', 'Ассортимент', 'Assortment'),
    'balances': staffText('Остатки', 'Қалдықтар', 'Stock'),
    'settings': staffText('Настройки', 'Баптаулар', 'Settings'),
  };
  Map<String, String> get _views => switch (_tab) {
    'rankings' => {
      'branches': staffText('Филиалы', 'Филиалдар', 'Branches'),
      'cashiers': staffText('Кассиры', 'Кассирлер', 'Cashiers'),
      'products': staffText('Товары', 'Тауарлар', 'Products'),
      'discounts': staffText('Скидки', 'Жеңілдіктер', 'Discounts'),
      if (_view == 'cashierProducts')
        'cashierProducts': staffText(
          'Товары кассира',
          'Кассир тауарлары',
          'Cashier products',
        ),
      if (_view == 'productBranches')
        'productBranches': staffText(
          'Товар по филиалам',
          'Филиалдардағы тауар',
          'Product by branch',
        ),
    },
    'writeoffs' => {
      'branches': staffText('Филиалы', 'Филиалдар', 'Branches'),
      'products': staffText('Товары', 'Тауарлар', 'Products'),
      'reasons': staffText('Причины', 'Себептер', 'Reasons'),
      'documents': staffText('Документы', 'Құжаттар', 'Documents'),
      'trend': staffText('По дням', 'Күндер', 'Daily'),
    },
    'operations' => {
      'discounts': staffText('Скидки', 'Жеңілдіктер', 'Discounts'),
      'returns': staffText('Возвраты', 'Қайтарулар', 'Returns'),
    },
    'assortment' => {'assortment': staffText('Товары', 'Тауарлар', 'Products')},
    _ => {},
  };

  @override
  Widget build(BuildContext context) {
    final data = _data;
    Map<String, dynamic>? report;
    if (data != null) {
      final raw = data['tables'] is Map ? data['tables'][_view] : data;
      if (raw is Map) report = Map<String, dynamic>.from(raw);
      if (_onlyFlags && _tab == 'operations' && report != null) {
        report = {
          ...report,
          'rows': (report['rows'] as List? ?? [])
              .where((e) => e is Map && '${e['Flags'] ?? ''}'.isNotEmpty)
              .toList(),
        };
      }
      if (_tab == 'rankings' && report != null) {
        report = _rankingDisplay(report);
      }
      if (_tab == 'balances' && report != null) report = _filterStock(report);
      if (_tab == 'assortment' && _adviceOnly && report != null) {
        report = {
          ...report,
          'rows': staffRows(report['rows'])
              .where(
                (row) =>
                    '${row['Advice'] ?? ''}'.isNotEmpty &&
                    !['keep', 'short_period'].contains(row['Advice']),
              )
              .toList(),
        };
      }
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          StaffPicker(
            label: staffText('Раздел', 'Бөлім', 'Section'),
            value: _tab,
            options: _tabs,
            onChanged: (value) {
              setState(() {
                _tab = value;
                _view = _views.keys.firstOrNull ?? '';
                _onlyFlags = false;
                _focus = {};
                _adviceOnly = false;
              });
              unawaited(_load(clear: true));
            },
          ),
          const SizedBox(height: 16),
          if (_servers.isNotEmpty)
            StaffPicker(
              label: staffText(
                'Город / сервер',
                'Қала / сервер',
                'City / server',
              ),
              value: _server,
              options: {
                for (final server in _servers)
                  '${server['id']}':
                      '${server['name'] ?? server['label'] ?? server['host'] ?? server['id']}',
              },
              onChanged: (value) {
                setState(() {
                  _server = value;
                  _department = '';
                  _departments = [];
                  _focus = {};
                  _stockStore = '';
                  _stockGroup = '';
                });
                unawaited(_load(clear: true));
                unawaited(_loadDepartments());
              },
            ),
          if (_departments.isNotEmpty) ...[
            const SizedBox(height: 12),
            StaffPicker(
              label: staffText('Филиал', 'Филиал', 'Branch'),
              value: _department,
              options: {
                '': staffText(
                  'Все филиалы',
                  'Барлық филиалдар',
                  'All branches',
                ),
                for (final item in _departments) item: item,
              },
              onChanged: (value) {
                setState(() {
                  _department = value;
                  _focus = {};
                });
                unawaited(_load(clear: true));
              },
            ),
          ],
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _period,
            icon: const Icon(Icons.calendar_month_outlined),
            label: Text(
              '${_date(_from)} — ${_date(_to)}',
              textAlign: TextAlign.center,
            ),
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: Text(
              staffText('Автообновление', 'Автоматты жаңарту', 'Auto refresh'),
            ),
            value: _auto,
            onChanged: (value) {
              setState(() => _auto = value);
              unawaited(_savePreferences());
            },
          ),
          if (_views.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final entry in _views.entries)
                    ChoiceChip(
                      label: Text(entry.value),
                      selected: _view == entry.key,
                      onSelected: (_) {
                        setState(() {
                          _view = entry.key;
                          if (_tab == 'rankings') _focus = {};
                        });
                        if (_tab == 'rankings') unawaited(_load(clear: true));
                      },
                    ),
                ],
              ),
            ),
          if (_tab == 'operations')
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                staffText(
                  'Только для проверки',
                  'Тек тексеру үшін',
                  'Only flagged',
                ),
              ),
              value: _onlyFlags,
              onChanged: (value) => setState(() => _onlyFlags = value ?? false),
            ),
          if (_error != null)
            _StaffError(
              message: _error!,
              onRetry: _servers.isEmpty ? _initialize : _load,
            ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: LinearProgressIndicator(),
            ),
          if (!_loading && _servers.isEmpty && _error == null)
            Text(
              staffText(
                'Нет подключённых серверов',
                'Қосылған серверлер жоқ',
                'No connected servers',
              ),
            ),
          if (data != null && data['summary'] is Map)
            _StaffMetricGrid(
              values: Map<String, dynamic>.from(data['summary'] as Map),
            ),
          if (_tab == 'overview' && report != null) _overview(report),
          if (_tab == 'reports' && _server.isNotEmpty)
            StaffReportBuilder(api: widget.api, base: _base),
          if (_tab == 'settings') _settings(),
          if (_data != null &&
              !_loading &&
              _tab != 'reports' &&
              _tab != 'settings')
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: _exporting ? null : _export,
                  icon: const Icon(Icons.ios_share),
                  label: Text(_exporting ? '…' : 'Excel'),
                ),
              ),
            ),
          if (_tab != 'overview' && report != null) ...[
            if (_tab == 'rankings') ...[
              StaffPicker(
                label: staffText('Показатель', 'Көрсеткіш', 'Metric'),
                value: _rankMetric,
                options: {
                  for (final metric in [
                    'DishDiscountSumInt',
                    'UniqOrderId',
                    'AverageCheck',
                    'DishAmountInt',
                    'DiscountSum',
                    'ItemSaleEventDiscountType.DiscountAmount',
                    'DiscountRate',
                    'ProductCostBase.ProductCost',
                  ])
                    metric: staffFieldLabel(metric),
                },
                onChanged: (v) => setState(() => _rankMetric = v),
              ),
              if (_focus.isNotEmpty)
                TextButton(
                  onPressed: () {
                    _focus = {};
                    _view = 'branches';
                    unawaited(_load(clear: true));
                  },
                  child: Text(
                    staffText(
                      'К общему рейтингу',
                      'Жалпы рейтингке',
                      'Back to overall ranking',
                    ),
                  ),
                ),
              if (_comparison != 'none')
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    '${staffText('Сравнение', 'Салыстыру', 'Comparison')}: ${_comparisonQuery(_scope)['from']} — ${_comparisonQuery(_scope)['to']}',
                  ),
                ),
            ],
            if (_tab == 'balances') _stockControls(),
            if (_tab == 'assortment')
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  staffText(
                    'Только с рекомендациями',
                    'Тек ұсыныстармен',
                    'Only recommendations',
                  ),
                ),
                value: _adviceOnly,
                onChanged: (v) => setState(() => _adviceOnly = v),
              ),
            StaffReport(
              key: ValueKey('$_tab|$_view|$_server|$_department'),
              report: report,
              onReceipt: _tab == 'operations' ? _receipt : null,
              onOpen:
                  _tab == 'rankings' &&
                      ['branches', 'cashiers', 'products'].contains(_view)
                  ? _drill
                  : null,
            ),
          ],
        ],
      ),
    );
  }
}

class _StaffMetricGrid extends StatelessWidget {
  const _StaffMetricGrid({required this.values});
  final Map<String, dynamic> values;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = constraints.maxWidth >= 600
          ? 3
          : MediaQuery.textScalerOf(context).scale(1) > 1.3
          ? 1
          : 2;
      return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            for (final entry in values.entries.where(
              (e) => e.value is num || e.value == null,
            ))
              SizedBox(
                width: (constraints.maxWidth - (columns - 1) * 12) / columns,
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(22),
                    boxShadow: BulkaShadows.card,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        staffFieldLabel(entry.key),
                        style: TextStyle(color: context.bulkaColors.mutedText),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        staffValue(entry.value),
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      );
    },
  );
}

class _StaffReceiptPage extends StatefulWidget {
  const _StaffReceiptPage({
    required this.api,
    required this.server,
    required this.row,
  });
  final StaffApiClient api;
  final String server;
  final Map<String, dynamic> row;
  @override
  State<_StaffReceiptPage> createState() => _StaffReceiptPageState();
}

class _StaffReceiptPageState extends State<_StaffReceiptPage> {
  Map<String, dynamic>? _report;
  String? _error;
  bool _onlyDiscounts = false;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _report = null;
    });
    try {
      final result = await widget.api.report('/iiko-dashboard/receipt', {
        'serverId': widget.server,
        'orderId': widget.row['UniqOrderId.Id'],
        'date': widget.row['OpenDate.Typed'],
        'department': widget.row['Department'],
      }, isCancelled: () => !mounted);
      if (mounted) setState(() => _report = result);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        '${staffText('Чек', 'Чек', 'Receipt')} № ${widget.row['OrderNum'] ?? '—'}',
      ),
    ),
    body: _error != null
        ? _StaffError(message: _error!, onRetry: _load)
        : _report == null
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                '${widget.row['Department'] ?? ''}\n${widget.row['Cashier'] ?? ''}',
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  staffText(
                    'Только со скидкой',
                    'Тек жеңілдікпен',
                    'Discounted items only',
                  ),
                ),
                value: _onlyDiscounts,
                onChanged: (value) =>
                    setState(() => _onlyDiscounts = value ?? false),
              ),
              StaffReport(
                report: {
                  ..._report!,
                  if (_onlyDiscounts)
                    'rows': (_report!['rows'] as List? ?? [])
                        .where(
                          (e) =>
                              e is Map &&
                              (num.tryParse('${e['DiscountSum']}') ?? 0) > 0,
                        )
                        .toList(),
                },
              ),
            ],
          ),
  );
}
