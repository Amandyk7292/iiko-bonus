part of '../main.dart';

String staffValue(Object? value) {
  if (value == null || value == '') return '—';
  if (value is num) {
    if (!value.isFinite) return '—';
    final parts = value
        .toStringAsFixed(value == value.roundToDouble() ? 0 : 2)
        .split('.');
    return '${parts.first.replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]} ')}${parts.length > 1 ? ',${parts[1]}' : ''}';
  }
  if (value is bool) {
    return value ? staffText('Да', 'Иә', 'Yes') : staffText('Нет', 'Жоқ', 'No');
  }
  if (value is List) return value.map(staffValue).join(', ');
  if (value is Map) {
    return value.entries
        .map((e) => '${e.key}: ${staffValue(e.value)}')
        .join('\n');
  }
  return '$value';
}

/// Mobile report uses expandable rows; no squeezed desktop table or hidden columns.
class StaffReport extends StatefulWidget {
  const StaffReport({
    required this.report,
    this.onReceipt,
    this.onOpen,
    super.key,
  });
  final Map<String, dynamic> report;
  final ValueChanged<Map<String, dynamic>>? onReceipt;
  final ValueChanged<Map<String, dynamic>>? onOpen;
  @override
  State<StaffReport> createState() => _StaffReportState();
}

class _StaffReportState extends State<StaffReport> {
  String _search = '', _sort = '';
  bool _descending = true;
  int _page = 0;
  List<String>? _visibleFields;
  final _searchController = TextEditingController();
  @override
  void didUpdateWidget(StaffReport oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.report != widget.report) _page = 0;
    if (!listEquals(
      (oldWidget.report['columns'] as Map?)?.keys.toList(),
      (widget.report['columns'] as Map?)?.keys.toList(),
    )) {
      _visibleFields = null;
      _sort = '';
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final columns = Map<String, dynamic>.from(
      widget.report['columns'] as Map? ?? {},
    );
    final rows = (widget.report['rows'] as List? ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .where(
          (row) =>
              _search.isEmpty ||
              row.values.any(
                (v) => staffValue(v).toLowerCase().contains(_search),
              ),
        )
        .toList();
    final availableFields = columns.isEmpty
        ? (rows.isEmpty ? <String>[] : rows.first.keys.toList())
        : columns.keys.toList();
    final fields = (_visibleFields ?? availableFields)
        .where(availableFields.contains)
        .toList();
    String label(String key) => staffFieldLabel(
      key,
      columns[key] is Map ? '${columns[key]['name'] ?? key}' : key,
    );
    if (_sort.isNotEmpty) {
      rows.sort((a, b) {
        final av = a[_sort], bv = b[_sort];
        final compared = av is num && bv is num
            ? av.compareTo(bv)
            : staffValue(av).compareTo(staffValue(bv));
        return _descending ? -compared : compared;
      });
    }
    final start = min(_page * 25, max(0, rows.length - 1));
    final visible = rows.skip(start).take(25).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _searchController,
          decoration: InputDecoration(
            hintText: staffText(
              'Поиск в отчёте',
              'Есептен іздеу',
              'Search report',
            ),
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.isEmpty
                ? null
                : IconButton(
                    tooltip: 'close_btn'.tr,
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _searchController.clear();
                      setState(() {
                        _search = '';
                        _page = 0;
                      });
                    },
                  ),
          ),
          onChanged: (value) => setState(() {
            _search = value.trim().toLowerCase();
            _page = 0;
          }),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('${staffText('Строк', 'Жолдар', 'Rows')}: ${rows.length}'),
            TextButton.icon(
              onPressed: () async {
                final selected = await staffChooseFields(
                  context,
                  staffText('Поля отчёта', 'Есеп өрістері', 'Report fields'),
                  {for (final field in availableFields) field: label(field)},
                  fields,
                  limit: 100,
                );
                if (selected != null && selected.isNotEmpty && mounted) {
                  setState(() => _visibleFields = selected);
                }
              },
              icon: const Icon(Icons.view_column_outlined),
              label: Text(staffText('Поля', 'Өрістер', 'Fields')),
            ),
            PopupMenuButton<String>(
              tooltip: staffText('Сортировка', 'Сұрыптау', 'Sort'),
              onSelected: (value) => setState(() {
                _sort = value;
                _page = 0;
              }),
              itemBuilder: (_) => [
                for (final field in fields)
                  PopupMenuItem(value: field, child: Text(label(field))),
              ],
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _sort.isEmpty
                      ? staffText('Сортировка', 'Сұрыптау', 'Sort')
                      : label(_sort),
                ),
              ),
            ),
            IconButton(
              tooltip: staffText(
                'Изменить порядок',
                'Ретін өзгерту',
                'Reverse order',
              ),
              onPressed: () => setState(() => _descending = !_descending),
              icon: Icon(
                _descending ? Icons.arrow_downward : Icons.arrow_upward,
              ),
            ),
          ],
        ),
        if (visible.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText(
                'Нет данных за выбранный период',
                'Таңдалған кезеңде деректер жоқ',
                'No data for this period',
              ),
              textAlign: TextAlign.center,
            ),
          ),
        for (final row in visible)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              margin: EdgeInsets.zero,
              color: Colors.white,
              child: ExpansionTile(
                key: ValueKey(
                  '${widget.report['fetchedAt']}|$_page|$_sort|${rows.indexOf(row)}',
                ),
                tilePadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                title: Text(
                  fields.isEmpty ? '—' : staffValue(row[fields.first]),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: fields.length < 2
                    ? null
                    : Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          fields
                              .skip(1)
                              .take(2)
                              .map(
                                (key) =>
                                    '${label(key)}: ${staffValue(row[key])}',
                              )
                              .join('\n'),
                        ),
                      ),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (widget.onOpen != null)
                          OutlinedButton.icon(
                            onPressed: () => widget.onOpen!(row),
                            icon: const Icon(Icons.open_in_new),
                            label: Text(
                              staffText(
                                'Детализация',
                                'Егжей-тегжей',
                                'Details',
                              ),
                            ),
                          ),
                        for (final key in fields)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 7),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  label(key),
                                  style: TextStyle(
                                    color: context.bulkaColors.mutedText,
                                    fontSize: 13,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                SelectableText(staffFieldValue(key, row[key])),
                              ],
                            ),
                          ),
                        if (widget.onReceipt != null &&
                            row['UniqOrderId.Id'] != null &&
                            row['OpenDate.Typed'] != null)
                          OutlinedButton.icon(
                            onPressed: () => widget.onReceipt!(row),
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: Text(
                              staffText(
                                'Товары в чеке',
                                'Чектегі тауарлар',
                                'Receipt items',
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (rows.length > 25)
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                tooltip: 'back_tooltip'.tr,
                onPressed: _page == 0 ? null : () => setState(() => _page--),
                icon: const Icon(Icons.chevron_left),
              ),
              Flexible(
                child: Text(
                  '${_page + 1} / ${(rows.length / 25).ceil()}',
                  textAlign: TextAlign.center,
                ),
              ),
              IconButton(
                tooltip: staffText('Далее', 'Келесі', 'Next'),
                onPressed: start + 25 >= rows.length
                    ? null
                    : () => setState(() => _page++),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
      ],
    );
  }
}

String staffFieldLabel(String field, [String? fallback]) {
  final names = <String, List<String>>{
    'Department': ['Филиал', 'Филиал', 'Branch'],
    'Cashier': ['Кассир', 'Кассир', 'Cashier'],
    'DishName': ['Товар', 'Тауар', 'Product'],
    'DishGroup': ['Категория', 'Санат', 'Category'],
    'DishMeasureUnit': ['Единица', 'Өлшем', 'Unit'],
    'DishDiscountSumInt': ['Выручка', 'Түсім', 'Revenue'],
    'DishSumInt': ['До скидки', 'Жеңілдікке дейін', 'Before discount'],
    'DishAmountInt': ['Продано, ед.', 'Сатылды', 'Items sold'],
    'UniqOrderId': ['Чеков', 'Чектер', 'Checks'],
    'DiscountSum': ['Скидка', 'Жеңілдік', 'Discount'],
    'AverageCheck': ['Средний чек', 'Орташа чек', 'Average check'],
    'ProductCostBase.ProductCost': ['Себестоимость', 'Өзіндік құны', 'Cost'],
    'GuestNum': ['Гостей', 'Қонақтар', 'Guests'],
    'OpenDate.Typed': ['Дата', 'Күні', 'Date'],
    'OrderNum': ['Чек №', 'Чек №', 'Receipt #'],
    'CloseTime': ['Время', 'Уақыты', 'Time'],
    'Product.Name': ['Товар', 'Тауар', 'Product'],
    'WriteoffQuantity': ['Списано, ед.', 'Шығарылған саны', 'Written off'],
    'WriteoffCost': ['Стоимость списания', 'Шығару құны', 'Write-off cost'],
    'AuthUser': [
      'Авторизовал в iiko',
      'iiko-да рұқсат берген',
      'Authorized in iiko',
    ],
    'Flags': ['Сигналы проверки', 'Тексеру белгілері', 'Review signals'],
    'Advice': ['Рекомендация', 'Ұсыныс', 'Suggestion'],
    'Sold': ['Продано', 'Сатылды', 'Sold'],
    'PreviousSold': ['Ранее', 'Бұрын', 'Previously'],
    'Daily': ['Продаж в день', 'Күндік сату', 'Sales per day'],
    'Growth': ['Изменение, %', 'Өзгеріс, %', 'Change, %'],
    'cost': ['Стоимость списаний', 'Шығару құны', 'Write-off cost'],
    'revenue': ['Выручка', 'Түсім', 'Revenue'],
    'share': [
      'Доля от выручки, %',
      'Түсімдегі үлесі, %',
      'Share of revenue, %',
    ],
    'change': [
      'К прошлому периоду, %',
      'Алдыңғы кезеңге, %',
      'Vs previous period, %',
    ],
    'discount': ['Сумма скидок', 'Жеңілдіктер сомасы', 'Discounts'],
    'discountChecks': [
      'Чеков со скидкой',
      'Жеңілдігі бар чектер',
      'Discounted checks',
    ],
    'returns': ['Возвраты', 'Қайтарулар', 'Refunds'],
    'returnChecks': ['Чеков возврата', 'Қайтару чектері', 'Return checks'],
    'flagged': ['Для проверки', 'Тексеру қажет', 'To review'],
    'productsCount': [
      'Товары × филиалы',
      'Тауарлар × филиалдар',
      'Products × branches',
    ],
    'Store': ['Склад', 'Қойма', 'Warehouse'],
    'Reason': ['Причина', 'Себеп', 'Reason'],
    'Comment': ['Комментарий', 'Пікір', 'Comment'],
    'product': ['Товар', 'Тауар', 'Product'],
    'store': ['Склад', 'Қойма', 'Warehouse'],
    'amount': ['Количество', 'Саны', 'Quantity'],
    'sum': ['Стоимость', 'Құны', 'Value'],
  };
  final name = names[field];
  return name == null
      ? fallback ?? field
      : staffText(name[0], name[1], name[2]);
}

String staffFieldValue(String field, Object? value) {
  const meanings = {
    'review_decline': [
      'Спрос снизился — проверить план',
      'Сұраныс төмендеді — жоспарды тексеру',
      'Demand fell — review plan',
    ],
    'review_increase': [
      'Проверить увеличение',
      'Көбейтуді тексеру',
      'Review an increase',
    ],
    'reduce_batch': [
      'Проверить размер партии',
      'Партия көлемін тексеру',
      'Review batch size',
    ],
    'keep': [
      'Сохранить и наблюдать',
      'Сақтау және бақылау',
      'Maintain and monitor',
    ],
    'short_period': [
      'Выберите минимум 7 дней',
      'Кемінде 7 күн таңдаңыз',
      'Select at least 7 days',
    ],
    'high_discount': ['Высокая скидка', 'Жоғары жеңілдік', 'High discount'],
    'large_return': ['Крупный возврат', 'Ірі қайтару', 'Large refund'],
    'repeat_returns': [
      '3+ возврата за день',
      'Күніне 3+ қайтару',
      '3+ refunds per day',
    ],
  };
  if (field == 'Flags' || field == 'Advice' || field == 'Pace') {
    if (value == null || value == '') return '—';
    return '$value'
        .split('|')
        .map((key) {
          final text = meanings[key];
          return text == null
              ? staffValue(key)
              : staffText(text[0], text[1], text[2]);
        })
        .join(' · ');
  }
  return staffValue(value);
}
