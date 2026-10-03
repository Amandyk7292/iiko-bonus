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
  CashierProductionReport? _production;
  final Map<String, String> _selected = {};
  bool _submitting = false, _reviewing = false, _historyOpen = false;
  String? _submissionId, _submissionSignature, _submitError;
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
      isBusy: () => _loading || _clearing || _submitting || _reviewing,
    );
  }

  Future<Map<String, dynamic>> _fetch(int offset, String date) async =>
      Map<String, dynamic>.from(
        await widget.api.request(
              '/staff/reports/display-stock?date=$date&offset=$offset',
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
    final date = _dateKey;
    final branch = widget.api.scopeKey;
    if (mounted) {
      setState(() {
        _loading = !silent;
        _error = null;
      });
    }
    try {
      final offset = more ? _events.length : 0;
      final responses = await Future.wait([
        _fetch(offset, date),
        if (!more)
          widget.api
              .request('/staff/reports/production?date=$date')
              .then((value) => Map<String, dynamic>.from(value as Map)),
      ]);
      final report = responses.first;
      final production = more
          ? _production
          : CashierProductionReport(responses.last);
      if (!mounted || request != _request || branch != widget.api.scopeKey) {
        return;
      }
      if (production != null &&
          (production.date != date ||
              (widget.api.branchId.isNotEmpty &&
                  production.branch['id'] != widget.api.branchId))) {
        throw StateError(
          staffText(
            'Отчёт изменился. Обновите данные.',
            'Есеп өзгерді. Деректерді жаңартыңыз.',
            'Report changed. Refresh the data.',
          ),
        );
      }
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
          final page = await _fetch(nextOffset, date);
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
        _production = production;
        _selected.removeWhere(
          (key, snapshot) =>
              !production!.enabled ||
              !production.products.any(
                (product) =>
                    product.key == key &&
                    product.selectable &&
                    product.snapshot == snapshot,
              ),
        );
        final ownAct = production?.acts
            .where((act) => act.id == _submissionId)
            .firstOrNull;
        if (ownAct != null) {
          if (ownAct.status != 'pending') {
            _submissionId = null;
            _submissionSignature = null;
          }
          _submitError = null;
          _selected.clear();
        }
      });
    } catch (error) {
      if (mounted && request == _request) setState(() => _error = '$error');
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    if (_submitting || _reviewing || _clearing) return;
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
      _production = null;
      _selected.clear();
      _submitError = null;
      _submissionId = null;
      _submissionSignature = null;
      _events = [];
      _historyOpen = false;
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
    await _load();
  }

  Future<void> _clearToday() async {
    if (_clearing || _submitting || _reviewing || _date != _today()) return;
    var enteredCode = '';
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => BulkaActionDialog(
        title: Text(
          staffText('Очистить отчёт', 'Есепті тазалау', 'Clear report'),
        ),
        content: StaffTouchField(
          fieldKey: const ValueKey('cashier-report-reset-code'),
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
        _selected.clear();
        _submissionId = null;
        _submissionSignature = null;
        _submitError = null;
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
      await _load(silent: true);
    } catch (error) {
      if (mounted && request == _request) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(bulkaSnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _clearing = false);
    }
  }

  List<CashierProductionProduct> get _chosen =>
      _production?.products
          .where(
            (product) =>
                product.selectable &&
                _selected[product.key] == product.snapshot,
          )
          .toList() ??
      [];

  Future<void> _sendProduction() async {
    final production = _production;
    final chosen = _chosen;
    if (_submitting ||
        _reviewing ||
        _loading ||
        _error != null ||
        production == null ||
        !production.enabled ||
        chosen.isEmpty) {
      return;
    }
    final date = _dateKey, scope = widget.api.scopeKey;
    final snapshots = chosen.map((product) => product.snapshot).toList()
      ..sort();
    final signature = '$scope:$date:${snapshots.join('|')}';
    setState(() => _reviewing = true);
    final confirmed = await _confirmProduction(context, production, chosen);
    if (!mounted) return;
    setState(() => _reviewing = false);
    if (!confirmed || date != _dateKey || scope != widget.api.scopeKey) return;
    if (!_chosen.every((product) => snapshots.contains(product.snapshot)) ||
        _chosen.length != chosen.length) {
      setState(
        () => _submitError = staffText(
          'Отчёт изменился. Выберите товары заново.',
          'Есеп өзгерді. Тауарларды қайта таңдаңыз.',
          'Report changed. Select products again.',
        ),
      );
      return;
    }
    if (_submissionSignature != signature) {
      _submissionId = staffRequestId();
      _submissionSignature = signature;
    }
    final eventIds =
        chosen.expand((product) => product.eventIds).toSet().toList()..sort();
    await _submitProduction(_submissionId!, date, eventIds);
  }

  Future<void> _resumeProduction(CashierProductionAct act) async {
    if (_submitting ||
        _reviewing ||
        _loading ||
        _error != null ||
        act.status != 'pending' ||
        act.eventIds.isEmpty ||
        act.date != _dateKey) {
      return;
    }
    _submissionId = act.id;
    await _submitProduction(act.id, act.date, act.eventIds);
  }

  Future<void> _submitProduction(
    String requestId,
    String date,
    List<String> eventIds,
  ) async {
    final scope = widget.api.scopeKey;
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    try {
      final response = await widget.api.request(
        '/staff/reports/production',
        method: 'POST',
        body: {'requestId': requestId, 'date': date, 'eventIds': eventIds},
      );
      if (!mounted || date != _dateKey || scope != widget.api.scopeKey) return;
      final act = CashierProductionAct(
        Map<String, dynamic>.from(response['act'] as Map),
      );
      setState(() {
        _production!.acts.removeWhere((existing) => existing.id == act.id);
        _production!.acts.insert(0, act);
        _selected.clear();
        if (act.status != 'pending') {
          _submissionId = null;
          _submissionSignature = null;
        }
      });
    } catch (error) {
      if (mounted && date == _dateKey && scope == widget.api.scopeKey) {
        setState(() {
          _submitError =
              error is StaffApiException &&
                  error.status >= 400 &&
                  error.status < 500
              ? _productionReason(error.message, error.code)
              : staffText(
                  'Результат отправки уточняется. Обновите отчёт.',
                  'Жіберу нәтижесі тексерілуде. Есепті жаңартыңыз.',
                  'Checking the send result. Refresh the report.',
                );
        });
      }
    } finally {
      if (mounted && date == _dateKey && scope == widget.api.scopeKey) {
        await _load(silent: true);
        if (mounted) setState(() => _submitting = false);
      }
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
    final productionProducts =
        _production?.products ?? <CashierProductionProduct>[];
    final chosen = _chosen;
    final busy = _loading || _clearing || _submitting || _reviewing;
    final eligible = productionProducts
        .where((product) => product.selectable)
        .toList();
    final canSelect =
        !(_loading || _clearing || _submitting) &&
        _error == null &&
        _production?.enabled == true;
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
                  onPressed: _submitting || _reviewing || _clearing
                      ? null
                      : _pickDate,
                  icon: const Icon(Icons.calendar_month_outlined),
                  label: Text(_day(_date)),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: staffText('Обновить', 'Жаңарту', 'Refresh'),
                onPressed: busy ? null : () => _load(),
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
                          Wrap(
                            spacing: 8,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                staffText(
                                  'Добавлено в витрину',
                                  'Витринаға қосылды',
                                  'Added to display',
                                ),
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              if (_date == _today())
                                TextButton.icon(
                                  key: const ValueKey(
                                    'cashier-report-reset-button',
                                  ),
                                  onPressed: busy ? null : _clearToday,
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
                          if (_production?.enabled == false)
                            Text(
                              _productionReason(
                                _production!.unavailableReason,
                                _production!.unavailableReasonCode,
                              ),
                              key: const ValueKey('production-unavailable'),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          if (_production?.enabled == true &&
                              eligible.isNotEmpty)
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton(
                                key: const ValueKey('production-select-all'),
                                onPressed: canSelect
                                    ? () => setState(() {
                                        if (chosen.length == eligible.length) {
                                          _selected.clear();
                                        } else {
                                          _selected.addEntries(
                                            eligible.map(
                                              (product) => MapEntry(
                                                product.key,
                                                product.snapshot,
                                              ),
                                            ),
                                          );
                                        }
                                      })
                                    : null,
                                child: Text(
                                  chosen.length == eligible.length
                                      ? staffText(
                                          'Снять выбор',
                                          'Таңдауды алып тастау',
                                          'Clear selection',
                                        )
                                      : staffText(
                                          'Выбрать все',
                                          'Бәрін таңдау',
                                          'Select all',
                                        ),
                                ),
                              ),
                            ),
                          const SizedBox(height: 12),
                        ],
                      ),
                    ),
                    if (productionProducts.isEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 28,
                        ),
                        sliver: SliverToBoxAdapter(
                          child: Text(
                            staffText(
                              'Нет товаров для отправки.',
                              'Жіберетін тауар жоқ.',
                              'No products to send.',
                            ),
                          ),
                        ),
                      )
                    else
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: _sliver(
                          (index) => _productionProductRow(
                            context,
                            productionProducts[index],
                            selected:
                                _selected[productionProducts[index].key] ==
                                productionProducts[index].snapshot,
                            enabled: canSelect,
                            onChanged: (selected) => setState(() {
                              if (selected) {
                                _selected[productionProducts[index].key] =
                                    productionProducts[index].snapshot;
                              } else {
                                _selected.remove(productionProducts[index].key);
                              }
                              _submitError = null;
                            }),
                          ),
                          productionProducts.length,
                        ),
                      ),
                    if (_production?.acts.isNotEmpty == true)
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                        sliver: _sliver(
                          (index) => _productionActRow(
                            context,
                            _production!.acts[index],
                            onResume:
                                !busy &&
                                    _error == null &&
                                    _production!.acts[index].date == _dateKey
                                ? () => _resumeProduction(
                                    _production!.acts[index],
                                  )
                                : null,
                          ),
                          _production!.acts.length,
                        ),
                      ),
                    if (products.isNotEmpty || _events.isNotEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                        sliver: SliverToBoxAdapter(
                          child: TextButton.icon(
                            key: const ValueKey('cashier-report-history'),
                            onPressed: () =>
                                setState(() => _historyOpen = !_historyOpen),
                            icon: Icon(
                              _historyOpen
                                  ? Icons.expand_less
                                  : Icons.expand_more,
                            ),
                            label: Text(
                              staffText(
                                'История изменений',
                                'Өзгерістер тарихы',
                                'Change history',
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (_historyOpen)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: SliverList.list(
                          children: [
                            Text(
                              staffText(
                                'Только добавления формируют акт. Исправления и пересчёт — в истории.',
                                'Актіге тек қосылған тауарлар кіреді. Түзетулер мен қайта санау тарихта.',
                                'Only additions form the act. Corrections and recounts are in history.',
                              ),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            if (_report?['trackingStartedAt'] != null)
                              Text(
                                '${staffText('История ведётся с', 'Тарих басталған уақыт', 'History recorded since')} ${_localTime(_report!['trackingStartedAt'], date: true)}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            const SizedBox(height: 8),
                          ],
                        ),
                      ),
                    if (_historyOpen && products.isNotEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: _sliver(
                          (index) => _productRow(products[index]),
                          products.length,
                        ),
                      ),
                    if (_historyOpen && _events.isNotEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: _sliver(
                          (index) => _eventRow(_events[index]),
                          _events.length,
                        ),
                      ),
                    if (_historyOpen && hasMore)
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
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border(
                top: BorderSide(color: Theme.of(context).colorScheme.outline),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_submitError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      _submitError!,
                      key: const ValueKey('production-submit-error'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                if (chosen.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      '${staffText('Выбрано', 'Таңдалды', 'Selected')}: ${chosen.length} · ${_productionTotals(chosen)}',
                    ),
                  ),
                FilledButton(
                  key: const ValueKey('production-send'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: canSelect && chosen.isNotEmpty
                      ? _sendProduction
                      : null,
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          staffText(
                            'Отправить в iiko',
                            'iiko-ға жіберу',
                            'Send to iiko',
                          ),
                        ),
                ),
              ],
            ),
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
