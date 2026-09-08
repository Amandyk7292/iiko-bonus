part of '../main.dart';

const staffOrderTransitions = <String, List<String>>{
  'new': ['accepted', 'preparing', 'ready', 'completed', 'cancelled'],
  'accepted': ['preparing', 'ready', 'completed', 'cancelled'],
  'preparing': ['ready', 'completed', 'cancelled'],
  'ready': ['completed', 'cancelled'],
  'completed': [],
  'cancelled': [],
};
bool staffCanEditOrders(String role) =>
    ['owner', 'admin', 'branch_manager', 'operator', 'editor'].contains(role);
bool staffCanRefundOrders(String role) =>
    ['owner', 'admin', 'branch_manager'].contains(role);

class StaffOrders extends StatefulWidget {
  const StaffOrders({
    required this.api,
    required this.role,
    this.initialSearch = '',
    super.key,
  });
  final StaffApiClient api;
  final String role, initialSearch;
  @override
  State<StaffOrders> createState() => _StaffOrdersState();
}

class _StaffOrdersState extends State<StaffOrders> {
  late final TextEditingController _search;
  late final StaffLiveRefresh _live;
  Timer? _debounce;
  String _payment = '', _status = '';
  List<Map<String, dynamic>> _orders = [];
  bool _loading = true;
  String? _error;
  int _page = 1, _total = 0, _generation = 0;
  @override
  void initState() {
    super.initState();
    _search = TextEditingController(text: widget.initialSearch);
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['order.updated', 'order.created', 'order.customer_arrived'],
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
          'paymentStatus': _payment,
          'orderStatus': _status,
        },
      ).query;
      final result = await widget.api.request('/orders?$query');
      if (mounted && generation == _generation) {
        setState(() {
          _orders = staffRows(result['orders']);
          _total = (result['total'] as num?)?.toInt() ?? 0;
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

  Future<void> _open(Map<String, dynamic> order) async {
    await Navigator.push(
      context,
      StaffPageRoute<void>(
        builder: (_) =>
            StaffOrderDetail(api: widget.api, role: widget.role, order: order),
      ),
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
      children: [
        TextField(
          controller: _search,
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.search),
            labelText: staffText(
              'Номер заказа, имя или телефон',
              'Тапсырыс, аты немесе телефон',
              'Order, name or phone',
            ),
          ),
          onChanged: (_) {
            _generation++;
            _page = 1;
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), _load);
          },
        ),
        const SizedBox(height: 14),
        StaffPicker(
          label: staffText('Оплата', 'Төлем', 'Payment'),
          value: _payment,
          options: {
            '': staffText('Все', 'Барлығы', 'All'),
            for (final status in [
              'pending',
              'paid',
              'failed',
              'cancelled',
              'refunded',
            ])
              status: staffStatus(status),
          },
          onChanged: (value) {
            setState(() {
              _payment = value;
              _page = 1;
            });
            unawaited(_load());
          },
        ),
        const SizedBox(height: 10),
        StaffPicker(
          label: staffText(
            'Статус заказа',
            'Тапсырыс мәртебесі',
            'Order status',
          ),
          value: _status,
          options: {
            '': staffText('Все', 'Барлығы', 'All'),
            for (final status in staffOrderTransitions.keys)
              status: staffStatus(status),
          },
          onChanged: (value) {
            setState(() {
              _status = value;
              _page = 1;
            });
            unawaited(_load());
          },
        ),
        const SizedBox(height: 16),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (!_loading && _error == null && _orders.isEmpty)
          Padding(
            padding: const EdgeInsets.all(28),
            child: Text(
              staffText('Заказов нет', 'Тапсырыстар жоқ', 'No orders'),
              textAlign: TextAlign.center,
            ),
          ),
        for (final order in _orders)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 7),
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => _open(order),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      spacing: 12,
                      children: [
                        Text(
                          '№${order['number']}',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(
                          staffMoney(order['amount']),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text('${order['branch'] ?? ''}'),
                    Text(
                      '${(order['customer'] as Map?)?['name'] ?? ''} · ${(order['customer'] as Map?)?['phone'] ?? ''}',
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        Chip(label: Text(staffStatus(order['paymentStatus']))),
                        Chip(label: Text(staffStatus(order['orderStatus']))),
                      ],
                    ),
                    Text(
                      staffDate(order['createdAt']),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (order['lastError'] != null)
                      Text(
                        '${order['lastError']}',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            IconButton(
              tooltip: staffText('Назад', 'Артқа', 'Previous'),
              onPressed: _page > 1 && !_loading
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
              onPressed: _page * 50 < _total && !_loading
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
    _debounce?.cancel();
    _live.dispose();
    _search.dispose();
    super.dispose();
  }
}

class StaffOrderDetail extends StatefulWidget {
  const StaffOrderDetail({
    required this.api,
    required this.role,
    required this.order,
    super.key,
  });
  final StaffApiClient api;
  final String role;
  final Map<String, dynamic> order;
  @override
  State<StaffOrderDetail> createState() => _StaffOrderDetailState();
}

class _StaffOrderDetailState extends State<StaffOrderDetail> {
  late Map<String, dynamic> _order;
  late final StaffLiveRefresh _live;
  String? _error;
  bool _loading = false;
  int _generation = 0;
  String get _path => '/orders/${Uri.encodeComponent('${_order['id']}')}';
  bool get _canEdit => staffCanEditOrders(widget.role);
  bool get _canRefund => staffCanRefundOrders(widget.role);
  @override
  void initState() {
    super.initState();
    _order = Map.of(widget.order);
    _live = StaffLiveRefresh(
      widget.api,
      () => _refresh(),
      isBusy: () => _loading,
      events: ['order.updated', 'order.customer_arrived'],
    );
  }

  Future<void> _refresh() async {
    if (!mounted) return;
    final generation = ++_generation;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(
        '/orders?search=${Uri.encodeQueryComponent('${_order['number']}')}&pageSize=50',
      );
      final updated = staffRows(
        result['orders'],
      ).where((row) => row['id'] == _order['id']).firstOrNull;
      if (mounted && generation == _generation) {
        setState(() {
          if (updated != null) _order = updated;
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

  Future<void> _status(String status) async {
    if (!_canEdit || (status == 'cancelled' && !_canRefund)) return;
    final saved = await staffEdit(
      context,
      title: staffStatus(status),
      description: status == 'cancelled'
          ? staffText(
              'Отмена может запустить возврат оплаченной суммы.',
              'Бас тарту төленген соманы қайтаруды бастауы мүмкін.',
              'Cancellation may initiate a payment refund.',
            )
          : '№${_order['number']}',
      fields: status == 'cancelled'
          ? [
              StaffField(
                'reason',
                staffText(
                  'Причина отмены',
                  'Бас тарту себебі',
                  'Cancellation reason',
                ),
                required: true,
                type: 'multiline',
                maxLength: 500,
              ),
            ]
          : [],
      save: (values) async {
        final reason = '${values['reason'] ?? ''}'.trim().replaceAll(
          RegExp(r'\s+'),
          ' ',
        );
        if (status == 'cancelled' &&
            (reason.length < 3 ||
                !RegExp(
                  r'[a-zA-Zа-яА-ЯәғқңөұүһіӘҒҚҢӨҰҮҺІ0-9]',
                ).hasMatch(reason))) {
          throw Exception(
            staffText(
              'Укажите причину минимум из 3 символов',
              'Кемінде 3 таңбадан тұратын себеп жазыңыз',
              'Enter a reason of at least 3 characters',
            ),
          );
        }
        final result = await widget.api.request(
          '$_path/status',
          method: 'PATCH',
          body: {'status': status, 'cancellationReason': reason},
        );
        if (mounted) {
          _generation++;
          setState(
            () => _order = {
              ..._order,
              ...Map<String, dynamic>.from(result['order'] as Map),
            },
          );
        }
      },
    );
    if (saved == true && mounted) unawaited(_refresh());
  }

  Future<void> _courier() async {
    if (!_canEdit) return;
    try {
      final result = await widget.api.request('/couriers');
      if (!mounted) return;
      final options = {
        for (final c in staffRows(
          result['couriers'],
        ).where((c) => c['active'] == true))
          '${c['id']}': '${c['name']} · ${c['phone']}',
      };
      if (options.isEmpty) {
        throw Exception(
          staffText(
            'Нет активных курьеров',
            'Белсенді курьерлер жоқ',
            'No active couriers',
          ),
        );
      }
      await staffEdit(
        context,
        title: staffText(
          'Назначить курьера',
          'Курьер тағайындау',
          'Assign courier',
        ),
        fields: [
          StaffField(
            'courierId',
            staffText('Курьер', 'Курьер', 'Courier'),
            options: options,
          ),
        ],
        save: (values) async {
          await widget.api.request(
            '$_path/courier',
            method: 'PATCH',
            body: {...values, 'estimatedDeliveryAt': null},
          );
        },
      );
      if (mounted) unawaited(_refresh());
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _proof() async {
    try {
      final result = await widget.api.request('$_path/delivery-proof');
      if (!mounted) return;
      final proof = Map<String, dynamic>.from(result['proof'] as Map);
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => BulkaActionDialog(
          title: Text(
            staffText(
              'Подтверждение доставки',
              'Жеткізу растамасы',
              'Delivery proof',
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                StaffFacts({
                  staffText('Получатель', 'Алушы', 'Recipient'):
                      '${(_order['customer'] as Map?)?['name'] ?? '—'}',
                  'PIN': proof['pinVerified'] == true
                      ? staffText('Проверен', 'Тексерілді', 'Verified')
                      : staffText(
                          'Не проверен',
                          'Тексерілмеді',
                          'Not verified',
                        ),
                  staffText(
                    'Курьер',
                    'Курьер',
                    'Courier',
                  ): '${(proof['courier'] as Map?)?['name'] ?? '—'} · ${(proof['courier'] as Map?)?['phone'] ?? ''}',
                  staffText('Время', 'Уақыт', 'Time'): staffDate(
                    proof['deliveredAt'] ?? proof['createdAt'],
                  ),
                }),
                if (proof['latitude'] is num && proof['longitude'] is num)
                  TextButton.icon(
                    onPressed: () => launchUrl(
                      Uri.https('yandex.kz', '/maps/', {
                        'pt': '${proof['longitude']},${proof['latitude']}',
                        'z': '17',
                      }),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.location_on_outlined),
                    label: Text(
                      staffText(
                        'Место вручения',
                        'Тапсыру орны',
                        'Delivery location',
                      ),
                    ),
                  ),
                if (proof['photoUrl'] != null)
                  Image.network(
                    '${proof['photoUrl']}',
                    errorBuilder: (_, _, _) => Text(
                      staffText(
                        'Фото недоступно',
                        'Фото қолжетімсіз',
                        'Photo unavailable',
                      ),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(staffText('Закрыть', 'Жабу', 'Close')),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _refund() async {
    if (!_canRefund) return;
    await Navigator.push(
      context,
      StaffPageRoute<void>(
        builder: (_) => StaffRefund(api: widget.api, order: _order),
      ),
    );
    if (mounted) unawaited(_refresh());
  }

  Future<void> _substitute() async {
    if (!_canEdit) return;
    try {
      final result = await widget.api.request('$_path/substitution-options');
      final options = result['options'] as Map;
      final lines = staffRows(options['lines']);
      if (lines.isEmpty) {
        throw Exception(
          staffText(
            'Нет доступных позиций',
            'Қолжетімді тауарлар жоқ',
            'No eligible items',
          ),
        );
      }
      if (!mounted) return;
      await staffEdit(
        context,
        title: staffText(
          'Замена товара',
          'Тауарды ауыстыру',
          'Item substitution',
        ),
        fields: [
          StaffField(
            'lineKey',
            staffText('Товар', 'Тауар', 'Item'),
            options: {
              for (final row in lines)
                '${row['lineKey']}':
                    '${row['name']} · ${row['refundableQuantity']}',
            },
          ),
          StaffField(
            'quantity',
            staffText('Количество', 'Саны', 'Quantity'),
            type: 'number',
            required: true,
            minimum: 0.001,
          ),
          StaffField(
            'action',
            staffText('Действие', 'Әрекет', 'Action'),
            options: {
              'call_customer': staffText(
                'Позвонить клиенту',
                'Клиентке қоңырау шалу',
                'Call customer',
              ),
              'remove_refund': staffText(
                'Убрать и вернуть деньги',
                'Алып тастап, ақшаны қайтару',
                'Remove and refund',
              ),
              'replace_with_approval': staffText(
                'Предложить замену клиенту',
                'Клиентке ауыстыру ұсыну',
                'Request customer approval',
              ),
            },
          ),
          StaffField(
            'replacementProductId',
            staffText('Товар для замены', 'Ауыстыратын тауар', 'Replacement'),
            options: {
              '': staffText('Не выбран', 'Таңдалмады', 'Not selected'),
              for (final row in staffRows(options['replacements']))
                '${row['productId']}': '${row['productName']}',
            },
          ),
          StaffField(
            'note',
            staffText('Комментарий', 'Пікір', 'Note'),
            type: 'multiline',
            maxLength: 500,
          ),
        ],
        initial: {'quantity': 1},
        save: (values) async {
          final line = lines.firstWhere(
            (row) => row['lineKey'] == values['lineKey'],
          );
          if ((values['quantity'] as num) >
              (line['refundableQuantity'] as num)) {
            throw Exception(
              staffText(
                'Количество превышает доступное',
                'Саны қолжетімді мөлшерден асады',
                'Quantity exceeds available amount',
              ),
            );
          }
          if (values['action'] == 'replace_with_approval' &&
              values['replacementProductId'] == '') {
            throw Exception(
              staffText(
                'Выберите замену',
                'Ауыстыруды таңдаңыз',
                'Select a replacement',
              ),
            );
          }
          final body = Map<String, dynamic>.of(values);
          if (body['replacementProductId'] == '') {
            body.remove('replacementProductId');
          }
          await widget.api.request(
            '$_path/substitutions',
            method: 'POST',
            body: body,
          );
        },
      );
      if (mounted) unawaited(_refresh());
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final customer = _order['customer'] as Map? ?? {};
    final courier = _order['courier'] as Map?;
    final delivery =
        (_order['effectiveFulfillmentType'] ?? _order['fulfillmentType']) ==
        'delivery';
    return Scaffold(
      appBar: AppBar(title: Text('№${_order['number']}'), centerTitle: true),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (_loading) const LinearProgressIndicator(),
            if (_error != null)
              _StaffError(message: _error!, onRetry: _refresh),
            Text(
              staffMoney(_order['amount']),
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            StaffFacts({
              staffText('Оплата', 'Төлем', 'Payment'): staffStatus(
                _order['paymentStatus'],
              ),
              staffText('Статус', 'Мәртебе', 'Status'): staffStatus(
                _order['orderStatus'],
              ),
              staffText('Филиал', 'Филиал', 'Branch'):
                  '${_order['branch'] ?? '—'}',
              staffText('Создан', 'Құрылды', 'Created'): staffDate(
                _order['createdAt'],
              ),
              staffText('Клиент', 'Клиент', 'Customer'):
                  '${customer['name'] ?? '—'}',
              staffText('Телефон', 'Телефон', 'Phone'):
                  '${customer['phone'] ?? '—'}',
              staffText('Получение', 'Алу', 'Fulfillment'): staffStatus(
                _order['orderType'] ?? _order['fulfillmentType'],
              ),
              if (_order['pickupTime'] != null)
                staffText('Время получения', 'Алу уақыты', 'Pickup time'):
                    staffDate(_order['pickupTime']),
              staffText('Скидка', 'Жеңілдік', 'Discount'): staffMoney(
                _order['discount'],
              ),
              staffText('Бонусы', 'Бонустар', 'Bonus'): staffNumber(
                _order['earnedBonus'],
              ),
              if (_order['refundStatus'] != null)
                staffText(
                  'Возврат',
                  'Қайтару',
                  'Refund',
                ): '${staffStatus(_order['refundStatus'])} · ${staffMoney(_order['refundAmount'])}',
              if (courier != null)
                staffText('Курьер', 'Курьер', 'Courier'):
                    '${courier['name']} · ${courier['phone']}',
            }),
            if (customer['phone'] != null)
              OutlinedButton.icon(
                onPressed: () =>
                    launchUrl(Uri(scheme: 'tel', path: '${customer['phone']}')),
                icon: const Icon(Icons.phone_outlined),
                label: Text(
                  staffText(
                    'Позвонить клиенту',
                    'Клиентке қоңырау шалу',
                    'Call customer',
                  ),
                ),
              ),
            const Divider(height: 32),
            for (final item in staffRows(_order['items']))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${item['name'] ?? '—'}'),
                subtitle: Text(
                  '${staffNumber(item['quantity'])} × ${staffMoney(item['price'])}',
                ),
              ),
            if ('${_order['comment'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text('${_order['comment']}'),
              ),
            if (_canEdit)
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final status
                      in staffOrderTransitions['${_order['orderStatus']}'] ??
                          <String>[])
                    if (status != 'cancelled' || _canRefund)
                      OutlinedButton(
                        onPressed: () => _status(status),
                        child: Text(staffStatus(status)),
                      ),
                  if (_order['paymentStatus'] == 'paid')
                    OutlinedButton(
                      onPressed: _substitute,
                      child: Text(
                        staffText(
                          'Замена товара',
                          'Тауарды ауыстыру',
                          'Substitute item',
                        ),
                      ),
                    ),
                  if (delivery)
                    OutlinedButton(
                      onPressed: _courier,
                      child: Text(
                        staffText(
                          'Назначить курьера',
                          'Курьер тағайындау',
                          'Assign courier',
                        ),
                      ),
                    ),
                ],
              ),
            if (_canRefund &&
                _order['paymentStatus'] == 'paid' &&
                !['processing', 'unknown'].contains(_order['refundStatus']))
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _refund,
                  child: Text(
                    staffText(
                      'Частичный возврат',
                      'Ішінара қайтару',
                      'Partial refund',
                    ),
                  ),
                ),
              ),
            if (delivery)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _proof,
                  child: Text(
                    staffText(
                      'Подтверждение доставки',
                      'Жеткізу растамасы',
                      'Delivery proof',
                    ),
                  ),
                ),
              ),
            if (delivery && ['owner', 'admin'].contains(widget.role))
              OutlinedButton.icon(
                onPressed: () async {
                  await Navigator.push(
                    context,
                    StaffPageRoute<void>(
                      builder: (_) => Scaffold(
                        appBar: AppBar(
                          title: Text(
                            staffText('Доставка', 'Жеткізу', 'Delivery'),
                          ),
                        ),
                        body: StaffDispatch(
                          api: widget.api,
                          orderId: '${_order['id']}',
                        ),
                      ),
                    ),
                  );
                  if (mounted) unawaited(_refresh());
                },
                icon: const Icon(Icons.local_shipping_outlined),
                label: Text(
                  staffText(
                    'Управление доставкой',
                    'Жеткізуді басқару',
                    'Manage delivery',
                  ),
                ),
              ),
            for (final sub in staffRows(_order['substitutions']))
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('${sub['productName']} × ${sub['quantity']}'),
                      if (sub['replacementProductName'] != null)
                        Text('→ ${sub['replacementProductName']}'),
                      Text(staffStatus(sub['status'])),
                      if (sub['error'] != null) Text('${sub['error']}'),
                      if (_canEdit && sub['status'] == 'approved')
                        OutlinedButton(
                          onPressed: () async {
                            await staffEdit(
                              context,
                              title: staffText(
                                'Завершить замену',
                                'Ауыстыруды аяқтау',
                                'Complete substitution',
                              ),
                              fields: [],
                              save: (_) async {
                                await widget.api.request(
                                  '$_path/substitutions/${Uri.encodeComponent('${sub['id']}')}/complete',
                                  method: 'PATCH',
                                );
                              },
                            );
                            if (mounted) unawaited(_refresh());
                          },
                          child: Text(
                            staffText('Завершить', 'Аяқтау', 'Complete'),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _generation++;
    _live.dispose();
    super.dispose();
  }
}

class StaffRefund extends StatefulWidget {
  const StaffRefund({required this.api, required this.order, super.key});
  final StaffApiClient api;
  final Map<String, dynamic> order;
  @override
  State<StaffRefund> createState() => _StaffRefundState();
}

class _StaffRefundState extends State<StaffRefund> {
  Map<String, dynamic>? _options, _preview;
  final _quantities = <String, TextEditingController>{};
  final _reason = TextEditingController();
  bool _loading = true, _busy = false;
  String? _error, _idempotency;
  String get _path => '/orders/${Uri.encodeComponent('${widget.order['id']}')}';
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final result = await widget.api.request('$_path/refund-options');
      if (!mounted) return;
      _options = Map<String, dynamic>.from(result['refund'] as Map);
      for (final line in staffRows(_options!['lines'])) {
        _quantities['${line['lineKey']}'] = TextEditingController(text: '0');
      }
    } catch (e) {
      if (mounted) _error = '$e';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _items() {
    final result = <Map<String, dynamic>>[];
    for (final line in staffRows(_options?['lines'])) {
      final quantity = num.tryParse(
        _quantities['${line['lineKey']}']!.text.replaceAll(',', '.'),
      );
      if (quantity == null ||
          !quantity.isFinite ||
          quantity != quantity.roundToDouble() ||
          quantity < 0 ||
          quantity > (line['refundableQuantity'] as num)) {
        throw Exception(
          staffText(
            'Проверьте количество товаров',
            'Тауарлар санын тексеріңіз',
            'Check item quantities',
          ),
        );
      }
      if (quantity > 0) {
        result.add({'lineKey': line['lineKey'], 'quantity': quantity});
      }
    }
    if (result.isEmpty) {
      throw Exception(
        staffText(
          'Выберите товары для возврата',
          'Қайтарылатын тауарларды таңдаңыз',
          'Select items to refund',
        ),
      );
    }
    return result;
  }

  Future<void> _calculate() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final items = _items();
      final result = await widget.api.request(
        '$_path/partial-refund-preview',
        method: 'POST',
        body: {'items': items, 'reason': _reason.text.trim()},
      );
      if (mounted) {
        setState(
          () => _preview = Map<String, dynamic>.from(result['preview'] as Map),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (_preview == null || _busy) return;
    final items = _items();
    final saved = await staffEdit(
      context,
      title: staffText(
        'Подтвердить возврат',
        'Қайтаруды растау',
        'Confirm refund',
      ),
      description:
          '№${widget.order['number']} · ${staffMoney(_preview!['amount'])}',
      fields: [],
      submitLabel: staffText(
        'Вернуть деньги',
        'Ақшаны қайтару',
        'Refund payment',
      ),
      save: (_) async {
        // Retain this key after uncertain network failures. Never double-submit a refund.
        _idempotency ??= staffRequestId();
        final result = await widget.api.request(
          '$_path/partial-refund',
          method: 'POST',
          body: {
            'idempotencyKey': _idempotency,
            'items': items,
            'reason': _reason.text.trim(),
          },
        );
        final status = (result['refund'] as Map?)?['status'];
        if (status == 'failed') {
          throw Exception(
            staffText(
              'Возврат отклонён',
              'Қайтару қабылданбады',
              'Refund failed',
            ),
          );
        }
      },
    );
    if (saved == true && mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        staffText('Частичный возврат', 'Ішінара қайтару', 'Partial refund'),
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (_loading || _busy) const LinearProgressIndicator(),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (_options != null) ...[
          StaffFacts({
            staffText('Оплачено', 'Төленді', 'Paid'): staffMoney(
              _options!['paidAmount'],
            ),
            staffText('Уже возвращено', 'Қайтарылды', 'Already refunded'):
                staffMoney(_options!['alreadyRefunded']),
            staffText(
              'Доступно для возврата',
              'Қайтаруға қолжетімді',
              'Available',
            ): staffMoney(
              _options!['remainingAmount'],
            ),
          }),
          for (final line in staffRows(_options!['lines']))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: TextField(
                controller: _quantities['${line['lineKey']}'],
                enabled: !_busy && _idempotency == null,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(
                  labelText: '${line['name']}',
                  helperText:
                      '${staffText('Доступно', 'Қолжетімді', 'Available')}: ${line['refundableQuantity']}',
                ),
                onChanged: (_) => setState(() => _preview = null),
              ),
            ),
          TextField(
            controller: _reason,
            enabled: !_busy && _idempotency == null,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: staffText('Причина', 'Себебі', 'Reason'),
            ),
            onChanged: (_) => setState(() => _preview = null),
          ),
          const SizedBox(height: 16),
          if (_preview != null) ...[
            StaffFacts({
              staffText(
                'Вернём на карту',
                'Картаға қайтарылады',
                'Card refund',
              ): staffMoney(
                _preview!['amount'],
              ),
              staffText(
                'Восстановим бонусы',
                'Бонустар қалпына келеді',
                'Restore bonus',
              ): staffNumber(
                (_preview!['adjustment'] as Map?)?['spentBonusRestored'],
              ),
              staffText(
                'Отменим начисление',
                'Есептеу жойылады',
                'Reverse earned bonus',
              ): staffNumber(
                (_preview!['adjustment'] as Map?)?['earnedBonusReversed'],
              ),
            }),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(
                staffText(
                  'Подтвердить сумму',
                  'Соманы растау',
                  'Confirm amount',
                ),
              ),
            ),
          ],
          if (_preview == null)
            FilledButton(
              onPressed: _busy ? null : _calculate,
              child: Text(
                staffText(
                  'Рассчитать возврат',
                  'Қайтаруды есептеу',
                  'Calculate refund',
                ),
              ),
            ),
        ],
      ],
    ),
  );
  @override
  void dispose() {
    for (final c in _quantities.values) {
      c.dispose();
    }
    _reason.dispose();
    super.dispose();
  }
}
