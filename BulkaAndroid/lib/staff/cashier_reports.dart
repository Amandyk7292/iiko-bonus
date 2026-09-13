part of '../main.dart';

class CashierReports extends StatefulWidget {
  const CashierReports({required this.api, super.key});
  final StaffApiClient api;
  @override
  State<CashierReports> createState() => _CashierReportsState();
}

class _CashierReportsState extends State<CashierReports> {
  static DateTime _today() {
    final local = DateTime.now().toUtc().add(const Duration(hours: 5));
    return DateTime(local.year, local.month, local.day);
  }

  DateTime _date = _today();
  Map<String, dynamic>? _report;
  List<Map<String, dynamic>> _events = [];
  bool _loading = false;
  bool _clearing = false;
  String? _error;
  int _request = 0;
  late final StaffLiveRefresh _live;
  final _scroll = ScrollController();
  String get _dateKey => _date.toIso8601String().substring(0, 10);
  String _day(DateTime date) =>
      date.toIso8601String().substring(0, 10).split('-').reversed.join('.');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(silent: true),
      events: ['inventory.updated'],
      isBusy: () => _loading || _clearing,
    );
  }

  Future<Map<String, dynamic>> _fetch(int offset) async =>
      Map<String, dynamic>.from(
        await widget.api.request(
              '/staff/reports/display-stock?date=$_dateKey&offset=$offset',
            )
            as Map,
      );

  List<Map<String, dynamic>> _mergeEvents(
    Iterable<Map<String, dynamic>> current,
    Iterable<Map<String, dynamic>> incoming,
  ) {
    final merged = <String, Map<String, dynamic>>{};
    for (final row in [...current, ...incoming]) {
      final key = '${row['id'] ?? '${row['created_at']}:${row['product_id']}'}';
      merged[key] = row;
    }
    final rows = merged.values.toList();
    rows.sort((left, right) {
      final byTime = '${left['created_at']}'.compareTo(
        '${right['created_at']}',
      );
      return byTime != 0 ? byTime : '${left['id']}'.compareTo('${right['id']}');
    });
    return rows;
  }

  Future<void> _load({bool more = false, bool silent = false}) async {
    final request = ++_request;
    if (mounted) {
      setState(() {
        _loading = !silent;
        _error = null;
      });
    }
    try {
      final offset = more ? _events.length : 0;
      final report = await _fetch(offset);
      if (!mounted || request != _request) return;
      var nextEvents = more
          ? _mergeEvents(_events, staffRows(report['events']))
          : silent
          ? _mergeEvents(_events, staffRows(report['events']))
          : staffRows(report['events']);

      if (silent) {
        final eventCount =
            int.tryParse('${report['eventCount']}') ?? nextEvents.length;
        var nextOffset = _events.length;
        var pages = 0;
        while (nextEvents.length < eventCount && pages < 5) {
          final page = await _fetch(nextOffset);
          if (!mounted || request != _request) return;
          final rows = staffRows(page['events']);
          if (rows.isEmpty) break;
          nextEvents = _mergeEvents(nextEvents, rows);
          nextOffset += rows.length;
          pages += 1;
        }
      }

      if (!mounted || request != _request) return;
      setState(() {
        _report = report;
        _events = nextEvents;
      });
    } catch (error) {
      if (mounted && request == _request) setState(() => _error = '$error');
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: _today(),
    );
    if (!mounted || date == null || date == _date) return;
    setState(() {
      _date = date;
      _report = null;
      _events = [];
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
    await _load();
  }

  Future<void> _clearToday() async {
    if (_clearing || _date != _today()) return;
    var enteredCode = '';
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => BulkaActionDialog(
        title: Text(
          staffText('Очистить отчёт', 'Есепті тазалау', 'Clear report'),
        ),
        content: TextField(
          key: const ValueKey('cashier-report-reset-code'),
          autofocus: true,
          obscureText: true,
          maxLength: 4,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(
            labelText: staffText('Код', 'Код', 'Code'),
            hintText: '0000',
          ),
          onChanged: (value) => enteredCode = value,
          onSubmitted: (value) {
            if (value.length == 4) Navigator.pop(dialogContext, value);
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
          ),
          FilledButton(
            key: const ValueKey('cashier-report-reset-confirm'),
            onPressed: () => Navigator.pop(dialogContext, enteredCode),
            child: Text(staffText('Очистить', 'Тазалау', 'Clear')),
          ),
        ],
      ),
    );
    if (!mounted || code == null) return;
    setState(() => _clearing = true);
    final request = ++_request;
    try {
      final response = Map<String, dynamic>.from(
        await widget.api.request(
              '/staff/reports/display-stock/reset',
              method: 'POST',
              body: {'code': code},
            )
            as Map,
      );
      if (!mounted || request != _request) return;
      setState(() {
        _report = response;
        _events = staffRows(response['events']);
        _error = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(
          content: Text(
            staffText(
              'Отчёт очищен. Сегодняшняя витрина начинается с 0.',
              'Есеп тазаланды. Бүгінгі витрина 0-ден басталады.',
              'Report cleared. Today’s display starts from 0.',
            ),
          ),
        ),
      );
    } catch (error) {
      if (mounted && request == _request) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(bulkaSnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted && request == _request) setState(() => _clearing = false);
    }
  }

  String _quantity(dynamic value) {
    final number = num.tryParse('$value') ?? 0;
    return number.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
  }

  String _source(dynamic value) => switch (value) {
    'recount' => staffText(
      'Сверка на кассе',
      'Кассадағы салыстыру',
      'Register recount',
    ),
    'bakery' => staffText('Пекарня', 'Наубайхана', 'Bakery'),
    'admin' => staffText('Администратор', 'Әкімші', 'Administrator'),
    _ => staffText('Кассир', 'Кассир', 'Cashier'),
  };

  String _reason(dynamic value) => switch (value) {
    'receipt' => staffText(
      'Добавление в витрину',
      'Витринаға қосу',
      'Added to display',
    ),
    'recount' => staffText('Пересчёт', 'Қайта санау', 'Recount'),
    _ => staffText(
      'Исправление остатка',
      'Қалдықты түзету',
      'Stock correction',
    ),
  };

  String _localTime(dynamic value, {bool date = false}) {
    final instant = DateTime.tryParse(
      '$value',
    )?.toUtc().add(const Duration(hours: 5));
    return instant == null
        ? '—'
        : '${date ? '${_day(instant)} ' : ''}${instant.hour.toString().padLeft(2, '0')}:${instant.minute.toString().padLeft(2, '0')}';
  }

  String? _adjustments(Map<String, dynamic> row) {
    final correctionUp = num.tryParse('${row['correction_increase']}') ?? 0;
    final correctionDown = num.tryParse('${row['correction_decrease']}') ?? 0;
    final recountUp = num.tryParse('${row['recount_increase']}') ?? 0;
    final recountDown = num.tryParse('${row['recount_decrease']}') ?? 0;
    final initial = num.tryParse('${row['initial_quantity']}') ?? 0;
    final lines = <String>[];
    if (correctionUp != 0 || correctionDown != 0) {
      lines.add(
        '${staffText('Исправления', 'Түзетулер', 'Corrections')}: +${_quantity(correctionUp)} / −${_quantity(correctionDown)} ${row['unit']}',
      );
    }
    if (recountUp != 0 || recountDown != 0) {
      lines.add(
        '${staffText('Пересчёт', 'Қайта санау', 'Recount')}: +${_quantity(recountUp)} / −${_quantity(recountDown)} ${row['unit']}',
      );
    }
    if (initial > 0) {
      lines.add(
        '${staffText('Первичный остаток', 'Бастапқы қалдық', 'Initial count')}: ${_quantity(initial)} ${row['unit']}',
      );
    }
    return lines.isEmpty ? null : lines.join('\n');
  }

  Widget _productRow(Map<String, dynamic> row) {
    final adjustments = _adjustments(row);
    return Card(
      key: ValueKey('report-product:${row['product_id']}:${row['unit']}'),
      child: ListTile(
        title: Text('${row['product_name']}'),
        trailing: Text(
          '+${_quantity(row['added'])} ${row['unit']}',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: adjustments == null ? null : Text(adjustments),
      ),
    );
  }

  Widget _eventRow(Map<String, dynamic> row) => ListTile(
    key: ValueKey(
      'report-event:${row['id'] ?? '${row['created_at']}:${row['product_id']}'}',
    ),
    contentPadding: EdgeInsets.zero,
    title: Text('${row['product_name']}'),
    subtitle: Text(
      '${_localTime(row['created_at'])} · ${_reason(row['reason'])} · ${_source(row['source'])}\n${row['before_quantity'] == null ? staffText('Первичный остаток', 'Бастапқы қалдық', 'Initial count') : _quantity(row['before_quantity'])} → ${_quantity(row['after_quantity'])} ${row['unit']}',
    ),
    trailing: row['delta'] == null
        ? null
        : Text(
            '${(num.tryParse('${row['delta']}') ?? 0) > 0 ? '+' : ''}${_quantity(row['delta'])} ${row['unit']}',
          ),
  );

  SliverList _sliver(Widget Function(int) builder, int count) => SliverList(
    delegate: SliverChildBuilderDelegate(
      (_, index) => builder(index),
      childCount: count,
      addAutomaticKeepAlives: false,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final products = staffRows(_report?['products']);
    final totals = staffRows(_report?['totals']);
    final eventCount =
        int.tryParse('${_report?['eventCount']}') ?? _events.length;
    final hasMore = _events.length < eventCount;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_month_outlined),
                  label: Text(_day(_date)),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: staffText('Обновить', 'Жаңарту', 'Refresh'),
                onPressed: _loading ? null : () => _load(),
                icon: _loading && _report != null
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Expanded(
          child: _loading && _report == null
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? _StaffError(message: _error!, onRetry: () => _load())
              : CustomScrollView(
                  key: const PageStorageKey('cashier-stock-report-scroll'),
                  controller: _scroll,
                  slivers: [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                      sliver: SliverList.list(
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  staffText(
                                    'Добавлено в витрину',
                                    'Витринаға қосылды',
                                    'Added to display',
                                  ),
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                              ),
                              if (_date == _today())
                                TextButton.icon(
                                  key: const ValueKey(
                                    'cashier-report-reset-button',
                                  ),
                                  onPressed: _clearing ? null : _clearToday,
                                  icon: _clearing
                                      ? const SizedBox.square(
                                          dimension: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : const Icon(Icons.delete_sweep_outlined),
                                  label: Text(
                                    staffText('Очистить', 'Тазалау', 'Clear'),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            totals.isEmpty
                                ? '0'
                                : totals
                                      .map(
                                        (row) =>
                                            '${_quantity(row['added'])} ${row['unit']}',
                                      )
                                      .join(' · '),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            staffText(
                              'Сюда входят только изменения с причиной «Добавление в витрину». Исправления, пересчёт, продажи и возвраты показаны отдельно.',
                              'Мұнда тек «Витринаға қосу» себебі бар өзгерістер кіреді. Түзетулер, қайта санау, сатылымдар және қайтарулар бөлек көрсетіледі.',
                              'Only changes marked “Added to display” are included. Corrections, recounts, sales and refunds are shown separately.',
                            ),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          if (_report?['trackingStartedAt'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                '${staffText('История ведётся с', 'Тарих басталған уақыт', 'History recorded since')} ${_localTime(_report!['trackingStartedAt'], date: true)}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ),
                          const SizedBox(height: 12),
                        ],
                      ),
                    ),
                    if (products.isEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 28,
                        ),
                        sliver: SliverToBoxAdapter(
                          child: Text(
                            staffText(
                              'За выбранную дату записей нет.',
                              'Таңдалған күнге жазбалар жоқ.',
                              'No records for this date.',
                            ),
                          ),
                        ),
                      )
                    else
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: _sliver(
                          (index) => _productRow(products[index]),
                          products.length,
                        ),
                      ),
                    if (_events.isNotEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                        sliver: SliverToBoxAdapter(
                          child: Text(
                            staffText(
                              'История изменений',
                              'Өзгерістер тарихы',
                              'Change history',
                            ),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                      ),
                    if (_events.isNotEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: _sliver(
                          (index) => _eventRow(_events[index]),
                          _events.length,
                        ),
                      ),
                    if (hasMore)
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        sliver: SliverToBoxAdapter(
                          child: OutlinedButton(
                            onPressed: _loading
                                ? null
                                : () => _load(more: true),
                            child: Text(
                              staffText(
                                'Показать ещё',
                                'Тағы көрсету',
                                'Show more',
                              ),
                            ),
                          ),
                        ),
                      )
                    else
                      const SliverToBoxAdapter(child: SizedBox(height: 24)),
                  ],
                ),
        ),
      ],
    );
  }

  @override
  void dispose() {
    _live.dispose();
    _scroll.dispose();
    super.dispose();
  }
}
