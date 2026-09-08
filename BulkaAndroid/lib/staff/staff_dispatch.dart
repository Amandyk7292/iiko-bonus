part of '../main.dart';

String? staffYandexRequestBlockReason(
  Map order,
  Map delivery,
  Map config, {
  DateTime? now,
}) {
  if ((config['canCreate'] ?? config['canManage']) != true) {
    return staffText(
      'Нет права вызова курьера',
      'Курьер шақыруға рұқсат жоқ',
      'Courier dispatch is not permitted',
    );
  }
  if (delivery['itemsResolutionRequired'] == true ||
      '${delivery['status']}'.startsWith('items_resolution_') ||
      delivery['status'] == 'cancelled_items_unresolved') {
    return staffText(
      'Сначала подтвердите судьбу товаров',
      'Алдымен тауарлар нәтижесін растаңыз',
      'Resolve the items first',
    );
  }
  if (delivery['createReconciliationExhausted'] == true ||
      delivery['status'] == 'creating_exhausted') {
    return staffText(
      'Сначала сверьте заявку',
      'Алдымен өтінімді салыстырыңыз',
      'Reconcile the existing request first',
    );
  }
  if (delivery['active'] == true &&
      !['draft', 'quoted'].contains(delivery['status'])) {
    return staffText(
      'Курьер уже вызван',
      'Курьер шақырылған',
      'Courier already requested',
    );
  }
  if (order['courierDispatchRequestedAt'] == null &&
      !['preparing', 'ready', 'handed_over'].contains(order['kitchenStatus'])) {
    return staffText(
      'Сначала примите заказ на кухне',
      'Алдымен тапсырысты асүйге қабылдаңыз',
      'Accept the order in the kitchen first',
    );
  }
  final business =
      delivery['apiFamily'] == 'business_v2' ||
      (delivery.isEmpty && config['apiMode'] == 'business_v2');
  if (business) {
    if (config['restaurantDeliveryConfirmed'] != true) {
      return staffText(
        'Доставка еды не подтверждена в Яндексе',
        'Яндексте тағам жеткізу расталмаған',
        'Restaurant delivery is not confirmed',
      );
    }
    if (config['dispatchReady'] == false) {
      return staffText(
        'Настройте операционные уведомления',
        'Операциялық хабарландыруларды баптаңыз',
        'Configure operational alerts',
      );
    }
    final price = num.tryParse('${delivery['quotedPrice']}');
    if (delivery['id'] == null ||
        delivery['apiFamily'] != 'business_v2' ||
        delivery['fixedPrice'] != true ||
        '${delivery['quoteFingerprint'] ?? ''}'.isEmpty ||
        price == null ||
        !price.isFinite ||
        price <= 0) {
      return staffText(
        'Получите фиксированную стоимость',
        'Тұрақты бағаны алыңыз',
        'Get a fixed-price quote',
      );
    }
    final expires = DateTime.tryParse('${delivery['quoteExpiresAt']}');
    if (expires == null || !expires.isAfter(now ?? DateTime.now())) {
      return staffText(
        'Расчёт устарел. Обновите стоимость.',
        'Есептеу ескірген. Бағаны жаңартыңыз.',
        'Quote expired. Refresh the price.',
      );
    }
  }
  return null;
}

class StaffDispatch extends StatefulWidget {
  const StaffDispatch({required this.api, this.orderId, super.key});
  final StaffApiClient api;
  final String? orderId;
  @override
  State<StaffDispatch> createState() => _StaffDispatchState();
}

class _StaffDispatchState extends State<StaffDispatch> {
  List<Map<String, dynamic>> _orders = [], _couriers = [];
  Map<String, dynamic> _config = {};
  bool _loading = false;
  final _busy = <String>{};
  String? _error;
  late final StaffLiveRefresh _live;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['order.updated', 'courier.updated', 'delivery.updated'],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading || _busy.isNotEmpty) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request('/dispatch');
      if (mounted) {
        setState(() {
          _orders = staffRows(result['orders'])
              .where((o) => widget.orderId == null || o['id'] == widget.orderId)
              .toList();
          _couriers = staffRows(result['couriers']);
          _config = Map<String, dynamic>.from(
            (result['yandexDelivery'] as Map?) ?? {},
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

  Future<void> _run(String id, Future<void> Function() action) async {
    if (_busy.contains(id)) return;
    setState(() {
      _busy.add(id);
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) {
        setState(() => _busy.remove(id));
        unawaited(_load());
      }
    }
  }

  String _path(Map<String, dynamic> order) =>
      '/dispatch/${Uri.encodeComponent('${order['id']}')}';
  Future<void> _quote(Map<String, dynamic> order) => _run(
    '${order['id']}',
    () async {
      await widget.api.request('${_path(order)}/yandex/quote', method: 'POST');
    },
  );
  Future<void> _request(Map<String, dynamic> order, Map delivery) async {
    final reason = staffYandexRequestBlockReason(order, delivery, _config);
    if (reason != null) {
      setState(() => _error = reason);
      return;
    }
    final price = delivery['quotedPrice'] ?? delivery['price'];
    if (delivery['apiFamily'] == 'business_v2' &&
        (price is! num || price <= 0)) {
      await _quote(order);
      return;
    }
    await staffEdit(
      context,
      title: staffText(
        'Вызвать Яндекс Курьера?',
        'Яндекс Курьерін шақыру керек пе?',
        'Request Yandex Courier?',
      ),
      description:
          '№${order['number']} · ${staffMoney(price)}\n${order['deliveryAddress'] ?? ''}',
      fields: [],
      submitLabel: staffText(
        'Вызвать курьера',
        'Курьер шақыру',
        'Request courier',
      ),
      save: (_) async {
        final blocked = staffYandexRequestBlockReason(order, delivery, _config);
        if (blocked != null) throw Exception(blocked);
        final expires = DateTime.tryParse('${delivery['quoteExpiresAt']}');
        if (expires != null && expires.isBefore(DateTime.now())) {
          throw Exception(
            staffText(
              'Расчёт устарел. Обновите стоимость.',
              'Есептеу ескірген. Бағаны жаңартыңыз.',
              'Quote expired. Refresh the price.',
            ),
          );
        }
        await widget.api.request(
          '${_path(order)}/yandex/request',
          method: 'POST',
          body: delivery['apiFamily'] == 'business_v2'
              ? {
                  'deliveryJobId': delivery['id'],
                  'maxPriceKzt': price,
                  if (delivery['quoteFingerprint'] != null)
                    'quoteFingerprint': delivery['quoteFingerprint'],
                }
              : {},
        );
      },
    );
    if (mounted) unawaited(_load());
  }

  Future<void> _cancel(Map<String, dynamic> order) async {
    try {
      final result = await widget.api.request(
        '${_path(order)}/yandex/cancel-info',
        method: 'POST',
      );
      if (!mounted) return;
      final info = result['cancellation'] as Map;
      if (info['cancelState'] == 'unavailable') {
        throw Exception(
          '${info['message'] ?? staffText('Отмена недоступна', 'Бас тарту қолжетімсіз', 'Cancellation unavailable')}',
        );
      }
      final paid =
          info['cancelState'] == 'paid' || info['cancelState'] == 'minimal';
      if (paid && (_config['canCreate'] ?? _config['canManage']) != true) {
        throw Exception(
          staffText(
            'Нет права платной отмены',
            'Ақылы бас тартуға рұқсат жоқ',
            'Paid cancellation is not permitted',
          ),
        );
      }
      await staffEdit(
        context,
        title: staffText(
          'Отменить вызов курьера?',
          'Курьер шақыруын тоқтату керек пе?',
          'Cancel courier request?',
        ),
        description:
            '${info['title'] ?? ''}\n${info['message'] ?? ''}\n${paid ? staffText('Платная отмена', 'Ақылы бас тарту', 'Paid cancellation') : staffText('Бесплатная отмена', 'Тегін бас тарту', 'Free cancellation')} · ${staffMoney(info['price'])}',
        fields: [],
        submitLabel: paid
            ? staffText(
                'Согласен на платную отмену',
                'Ақылы бас тартуға келісемін',
                'Approve paid cancellation',
              )
            : staffText('Отменить вызов', 'Шақыруды тоқтату', 'Cancel request'),
        save: (_) async {
          await widget.api.request(
            '${_path(order)}/yandex/cancel',
            method: 'POST',
            body: {'allowPaid': paid},
          );
        },
      );
      if (mounted) unawaited(_load());
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _resolve(
    Map<String, dynamic> order,
    Map delivery,
    bool create,
  ) async {
    await staffEdit(
      context,
      title: create
          ? staffText(
              'Сверить заявку с Яндексом',
              'Өтінімді Яндекспен салыстыру',
              'Reconcile Yandex request',
            )
          : staffText(
              'Подтвердить судьбу товаров',
              'Тауарлардың нәтижесін растау',
              'Confirm item resolution',
            ),
      fields: [
        StaffField(
          'resolution',
          staffText('Результат', 'Нәтиже', 'Resolution'),
          options: create
              ? {
                  'attach': staffText(
                    'Заявка есть в Яндексе',
                    'Өтінім Яндексте бар',
                    'Attach existing request',
                  ),
                  'not_created': staffText(
                    'Заявка не создана',
                    'Өтінім жасалмады',
                    'Not created',
                  ),
                }
              : {
                  'returned': staffText(
                    'Товары вернулись',
                    'Тауарлар қайтарылды',
                    'Items returned',
                  ),
                  'delivered': staffText(
                    'Товары доставлены',
                    'Тауарлар жеткізілді',
                    'Items delivered',
                  ),
                },
        ),
        if (create)
          StaffField(
            'externalOrderId',
            staffText(
              'ID заявки в Яндексе',
              'Яндекс өтінімінің ID',
              'Yandex request ID',
            ),
          ),
        StaffField(
          'reason',
          staffText('Основание', 'Негіздеме', 'Reason'),
          type: 'multiline',
          required: true,
          maxLength: 240,
        ),
      ],
      save: (values) async {
        if (values['resolution'] == 'not_created' ||
            values['externalOrderId'] == '') {
          values.remove('externalOrderId');
        }
        await widget.api.request(
          '${_path(order)}/yandex/${create ? 'resolve-create' : 'resolve-items'}',
          method: 'POST',
          body: {...values, 'deliveryJobId': delivery['id']},
        );
      },
    );
    if (mounted) unawaited(_load());
  }

  Future<void> _assign(Map<String, dynamic> order, bool automatic) async {
    await staffEdit(
      context,
      title: staffText(
        'Назначить курьера',
        'Курьер тағайындау',
        'Assign courier',
      ),
      description: '№${order['number']}',
      fields: automatic
          ? []
          : [
              StaffField(
                'courierId',
                staffText('Курьер', 'Курьер', 'Courier'),
                options: {
                  for (final c in _couriers.where((c) => c['active'] != false))
                    '${c['id']}': '${c['name']} · ${c['vehicle'] ?? ''}',
                },
              ),
            ],
      save: (values) async {
        await widget.api.request(
          automatic
              ? '${_path(order)}/auto-assign'
              : '/orders/${Uri.encodeComponent('${order['id']}')}/courier',
          method: automatic ? 'POST' : 'PATCH',
          body: automatic ? null : {...values, 'estimatedDeliveryAt': null},
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
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        for (final courier
            in widget.orderId == null ? _couriers : <Map<String, dynamic>>[])
          Card(
            child: ListTile(
              title: Text('${courier['name']}'),
              subtitle: Text(
                '${courier['phone']} · ${courier['vehicle'] ?? ''}',
              ),
              trailing: const Icon(Icons.edit_outlined),
              onTap: () async {
                await staffEdit(
                  context,
                  title: staffText(
                    'Доступность курьера',
                    'Курьер қолжетімділігі',
                    'Courier availability',
                  ),
                  fields: [
                    StaffField(
                      'status',
                      staffText('Статус', 'Мәртебе', 'Status'),
                      options: {
                        'offline': staffText(
                          'Не в сети',
                          'Желіде емес',
                          'Offline',
                        ),
                        'available': staffText('Свободен', 'Бос', 'Available'),
                        'busy': staffText('Занят', 'Бос емес', 'Busy'),
                        'break': staffText('Перерыв', 'Үзіліс', 'Break'),
                      },
                    ),
                  ],
                  initial: {
                    'status': courier['availabilityStatus'] ?? 'offline',
                  },
                  save: (values) async {
                    await widget.api.request(
                      '/dispatch/couriers/${Uri.encodeComponent('${courier['id']}')}/availability',
                      method: 'PATCH',
                      body: values,
                    );
                  },
                );
                if (mounted) unawaited(_load());
              },
            ),
          ),
        for (final order in _orders)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 10),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Builder(
                builder: (context) {
                  final delivery = (order['externalDelivery'] as Map?) ?? {};
                  final courier = delivery['courier'] as Map?;
                  final busy = _busy.contains('${order['id']}');
                  final canQuote =
                      (_config['canQuote'] ?? _config['canManage']) == true;
                  final canCreate =
                      (_config['canCreate'] ?? _config['canManage']) == true;
                  final blocked = staffYandexRequestBlockReason(
                    order,
                    delivery,
                    _config,
                  );
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        '№${order['number']} · ${staffMoney(order['amount'])}',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 10),
                      Text('${order['branchName'] ?? ''}'),
                      SelectableText('${order['deliveryAddress'] ?? ''}'),
                      StaffFacts({
                        staffText(
                          'Доставка',
                          'Жеткізу',
                          'Delivery',
                        ): '${delivery['statusLabel'] ?? staffStatus(order['deliveryStatus'])}',
                        staffText(
                          'Стоимость курьера',
                          'Курьер бағасы',
                          'Courier cost',
                        ): staffMoney(
                          delivery['price'] ?? delivery['quotedPrice'],
                        ),
                        if (delivery['etaMinutes'] != null)
                          staffText('Ожидание, мин', 'Күту, мин', 'ETA, min'):
                              staffNumber(delivery['etaMinutes']),
                        if (courier != null)
                          staffText('Курьер', 'Курьер', 'Courier'):
                              '${courier['name']} · ${courier['phone'] ?? ''}',
                        if (courier != null)
                          staffText('Автомобиль', 'Автокөлік', 'Vehicle'):
                              '${courier['vehicle'] ?? '—'}',
                      }),
                      for (final message in [
                        order['courierDispatchError'],
                        delivery['lastError'],
                        delivery['transportWarning'],
                      ])
                        if (message != null)
                          Text(
                            '$message',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                      if (delivery['priceOverrun'] == true)
                        Text(
                          staffText(
                            'Стоимость выше согласованного лимита',
                            'Баға келісілген лимиттен жоғары',
                            'Price exceeds approved limit',
                          ),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      if (busy) const LinearProgressIndicator(),
                      if (canCreate &&
                          blocked != null &&
                          delivery['active'] != true)
                        Text(blocked),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: [
                          if (canQuote &&
                              (delivery['active'] != true ||
                                  delivery['status'] == 'quoted') &&
                              delivery['createReconciliationExhausted'] != true)
                            OutlinedButton(
                              onPressed: busy ? null : () => _quote(order),
                              child: Text(
                                staffText(
                                  'Рассчитать стоимость',
                                  'Бағаны есептеу',
                                  'Get quote',
                                ),
                              ),
                            ),
                          if (canCreate &&
                              (delivery.isEmpty ||
                                  delivery['status'] == 'quoted' ||
                                  delivery['terminal'] == true))
                            FilledButton(
                              onPressed: busy || blocked != null
                                  ? null
                                  : () => _request(order, delivery),
                              child: Text(
                                staffText(
                                  'Вызвать Яндекс',
                                  'Яндекс шақыру',
                                  'Request Yandex',
                                ),
                              ),
                            ),
                          if (delivery.isNotEmpty)
                            OutlinedButton(
                              onPressed: busy
                                  ? null
                                  : () => _run('${order['id']}', () async {
                                      await widget.api.request(
                                        '${_path(order)}/yandex/sync',
                                        method: 'POST',
                                      );
                                    }),
                              child: Text(
                                staffText(
                                  'Обновить статус',
                                  'Мәртебені жаңарту',
                                  'Refresh status',
                                ),
                              ),
                            ),
                          if (delivery['canCancel'] == true && canQuote)
                            TextButton(
                              onPressed: busy ? null : () => _cancel(order),
                              child: Text(
                                staffText(
                                  'Отменить вызов',
                                  'Шақыруды тоқтату',
                                  'Cancel courier',
                                ),
                              ),
                            ),
                          if (delivery['itemsResolutionRequired'] == true &&
                              canCreate)
                            OutlinedButton(
                              onPressed: busy
                                  ? null
                                  : () => _resolve(order, delivery, false),
                              child: Text(
                                staffText(
                                  'Судьба товаров',
                                  'Тауарлар нәтижесі',
                                  'Resolve items',
                                ),
                              ),
                            ),
                          if ((delivery['createReconciliationExhausted'] ==
                                      true ||
                                  delivery['status'] == 'creating_exhausted') &&
                              _config['canCreate'] == true)
                            OutlinedButton(
                              onPressed: busy
                                  ? null
                                  : () => _resolve(order, delivery, true),
                              child: Text(
                                staffText(
                                  'Сверить заявку',
                                  'Өтінімді салыстыру',
                                  'Reconcile request',
                                ),
                              ),
                            ),
                          if (_couriers.isNotEmpty &&
                              delivery['active'] != true) ...[
                            OutlinedButton(
                              onPressed: busy
                                  ? null
                                  : () => _assign(order, false),
                              child: Text(
                                staffText(
                                  'Свой курьер',
                                  'Өз курьері',
                                  'Assign own courier',
                                ),
                              ),
                            ),
                            TextButton(
                              onPressed: busy
                                  ? null
                                  : () => _assign(order, true),
                              child: Text(
                                staffText(
                                  'Автоназначение',
                                  'Автоматты тағайындау',
                                  'Auto assign',
                                ),
                              ),
                            ),
                          ],
                          if (delivery['trackingUrl'] != null &&
                              Uri.tryParse(
                                    '${delivery['trackingUrl']}',
                                  )?.scheme ==
                                  'https')
                            OutlinedButton.icon(
                              onPressed: () => launchUrl(
                                Uri.parse('${delivery['trackingUrl']}'),
                                mode: LaunchMode.externalApplication,
                              ),
                              icon: const Icon(Icons.navigation_outlined),
                              label: Text(
                                staffText('Отслеживать', 'Бақылау', 'Track'),
                              ),
                            ),
                        ],
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        if (!_loading && _orders.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText('Доставок нет', 'Жеткізулер жоқ', 'No deliveries'),
              textAlign: TextAlign.center,
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
