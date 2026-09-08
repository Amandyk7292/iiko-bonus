part of '../main.dart';

Map<String, String> staffTransactionTypes() => {
  'deposit': staffText('Начисление', 'Есептеу', 'Credit'),
  'pending_deposit': staffText(
    'Ожидает начисления',
    'Есептеу күтілуде',
    'Pending credit',
  ),
  'withdrawal': staffText(
    'Оплата бонусами',
    'Бонустармен төлеу',
    'Bonus payment',
  ),
  'manual_deposit': staffText(
    'Ручное начисление',
    'Қолмен есептеу',
    'Manual credit',
  ),
  'manual_withdrawal': staffText(
    'Ручное списание',
    'Қолмен есептен шығару',
    'Manual debit',
  ),
  'manual': staffText('Ручная операция', 'Қолмен операция', 'Manual'),
  'expiration': staffText(
    'Сгорание бонусов',
    'Бонустардың аяқталуы',
    'Expiration',
  ),
  'refund_reversal': staffText(
    'Отмена начисления',
    'Есептеуді жою',
    'Credit reversal',
  ),
  'refund_bonus_restore': staffText(
    'Восстановление бонусов',
    'Бонустарды қалпына келтіру',
    'Bonus restored',
  ),
  'cancelled_deposit': staffText(
    'Начисление отменено',
    'Есептеу жойылды',
    'Credit cancelled',
  ),
  'order': staffText('Заказ', 'Тапсырыс', 'Order'),
};

class StaffTransactions extends StatefulWidget {
  const StaffTransactions({required this.api, this.iiko = false, super.key});
  final StaffApiClient api;
  final bool iiko;
  @override
  State<StaffTransactions> createState() => _StaffTransactionsState();
}

class _StaffTransactionsState extends State<StaffTransactions> {
  final _search = TextEditingController();
  Timer? _debounce;
  late final StaffLiveRefresh _live;
  DateTimeRange? _range;
  String _type = '';
  int _page = 1, _total = 0, _generation = 0;
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _rows = [];
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: [
        'transaction.created',
        'loyalty.balance.updated',
        'order.created',
      ],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    final generation = ++_generation;
    setState(() => _loading = true);
    try {
      final query = Uri(
        queryParameters: {
          'page': '$_page',
          'pageSize': '50',
          'search': _search.text.trim(),
          'type': _type,
          if (_range != null) 'dateFrom': staffDay(_range!.start),
          if (_range != null) 'dateTo': staffDay(_range!.end),
        },
      ).query;
      final result = await widget.api.request(
        widget.iiko ? '/iiko-operations' : '/transactions?$query',
      );
      if (mounted && generation == _generation) {
        setState(() {
          _rows = staffRows(result is List ? result : result['transactions']);
          _total = result is List
              ? result.length
              : (result['total'] as num?)?.toInt() ?? 0;
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

  Future<void> _dates() async {
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: _range,
      saveText: staffText('Применить', 'Қолдану', 'Apply'),
    );
    if (range != null && mounted) {
      setState(() {
        _range = range;
        _page = 1;
      });
      unawaited(_load());
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (!widget.iiko) ...[
          TextField(
            controller: _search,
            decoration: InputDecoration(
              labelText: staffText(
                'Поиск операции',
                'Операцияны іздеу',
                'Search transactions',
              ),
              prefixIcon: const Icon(Icons.search),
            ),
            onChanged: (_) {
              _generation++;
              _page = 1;
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 300), _load);
            },
          ),
          const SizedBox(height: 12),
          StaffPicker(
            label: staffText('Тип операции', 'Операция түрі', 'Type'),
            value: _type,
            options: {
              '': staffText('Все', 'Барлығы', 'All'),
              ...staffTransactionTypes(),
            },
            onChanged: (value) {
              setState(() {
                _type = value;
                _page = 1;
              });
              unawaited(_load());
            },
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: _dates,
                icon: const Icon(Icons.date_range),
                label: Text(
                  _range == null
                      ? staffText('Период', 'Кезең', 'Period')
                      : '${staffDay(_range!.start)} — ${staffDay(_range!.end)}',
                ),
              ),
              if (_range != null)
                TextButton(
                  onPressed: () {
                    setState(() {
                      _range = null;
                      _page = 1;
                    });
                    unawaited(_load());
                  },
                  child: Text(
                    staffText('Все даты', 'Барлық күндер', 'All dates'),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: () async {
                  try {
                    await staffExportCsv(
                      context,
                      'transactions',
                      {
                        'created_at': staffText('Дата', 'Күні', 'Date'),
                        'name': staffText('Клиент', 'Клиент', 'Customer'),
                        'phone': staffText('Телефон', 'Телефон', 'Phone'),
                        'type': staffText('Тип', 'Түрі', 'Type'),
                        'amount': staffText('Бонусы', 'Бонустар', 'Bonus'),
                        'order_total': staffText(
                          'Сумма заказа',
                          'Тапсырыс сомасы',
                          'Order total',
                        ),
                      },
                      _rows
                          .map(
                            (row) => {
                              ...row,
                              'created_at':
                                  row['timestamp'] ?? row['created_at'],
                              'name': (row['customers'] as Map?)?['name'],
                              'phone': (row['customers'] as Map?)?['phone'],
                            },
                          )
                          .toList(),
                    );
                  } catch (e) {
                    if (mounted) setState(() => _error = '$e');
                  }
                },
                icon: const Icon(Icons.ios_share),
                label: Text(
                  staffText(
                    'Экспорт страницы',
                    'Бетті экспорттау',
                    'Export page',
                  ),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 16),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (!_loading && _rows.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText('Операций нет', 'Операциялар жоқ', 'No transactions'),
              textAlign: TextAlign.center,
            ),
          ),
        for (final row in _rows)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 7),
            child: ExpansionTile(
              title: Text(
                '${row['order_number'] != null ? '№${row['order_number']}' : row['order_id'] ?? '—'}',
              ),
              subtitle: Text(staffDate(row['timestamp'] ?? row['created_at'])),
              childrenPadding: const EdgeInsets.all(16),
              children: [
                StaffFacts({
                  staffText('Клиент', 'Клиент', 'Customer'):
                      '${(row['customers'] as Map?)?['name'] ?? '—'}',
                  staffText('Телефон', 'Телефон', 'Phone'):
                      '${(row['customers'] as Map?)?['phone'] ?? '—'}',
                  if (!widget.iiko)
                    staffText('Тип', 'Түрі', 'Type'):
                        staffTransactionTypes()['${row['type']}'] ??
                        staffText('Другая операция', 'Басқа операция', 'Other'),
                  staffText('Сумма чека', 'Чек сомасы', 'Receipt total'):
                      staffMoney(row['order_total']),
                  if (widget.iiko) ...{
                    staffText('Начислено', 'Есептелді', 'Earned'): staffNumber(
                      row['earned_bonus'],
                    ),
                    staffText('Списано', 'Есептен шығарылды', 'Spent'):
                        staffNumber(row['discount_amount']),
                  } else
                    staffText('Бонусы', 'Бонустар', 'Bonus'): staffNumber(
                      row['amount'],
                    ),
                }),
                for (final item in staffRows(row['items']))
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      '${item['productName'] ?? item['name'] ?? '—'}',
                    ),
                    subtitle: Text(
                      '${staffNumber(item['quantity'] ?? item['amount'])} × ${staffMoney(item['price'])}',
                    ),
                  ),
              ],
            ),
          ),
        if (!widget.iiko)
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            children: [
              IconButton(
                tooltip: staffText('Назад', 'Артқа', 'Previous'),
                onPressed: !_loading && _page > 1
                    ? () {
                        _page--;
                        unawaited(_load());
                      }
                    : null,
                icon: const Icon(Icons.chevron_left),
              ),
              Text('$_page / ${max(1, (_total / 50).ceil())} · $_total'),
              IconButton(
                tooltip: staffText('Далее', 'Келесі', 'Next'),
                onPressed: !_loading && _page * 50 < _total
                    ? () {
                        _page++;
                        unawaited(_load());
                      }
                    : null,
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
      ],
    ),
  );
  @override
  void dispose() {
    _generation++;
    _live.dispose();
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }
}
