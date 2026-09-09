part of '../main.dart';

class StaffKitchen extends StatefulWidget {
  const StaffKitchen({
    required this.api,
    required this.canEdit,
    this.canCancel = false,
    super.key,
  });
  final StaffApiClient api;
  final bool canEdit;
  final bool canCancel;
  @override
  State<StaffKitchen> createState() => _StaffKitchenState();
}

class _StaffKitchenState extends State<StaffKitchen>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _orders = [];
  final _saving = <String>{};
  String _status = 'queued', _search = '';
  String? _error, _lastEvent;
  bool _loading = false,
      _reload = false,
      _online = false,
      _active = true,
      _closed = false;
  int _revision = 0, _retries = 0;
  StreamSubscription<Map<String, dynamic>>? _events;
  Timer? _poll, _reconnect;
  final _wakelock = AdminPortalWakelockController();
  AudioPlayer? _alarm;
  Timer? _alarmTimer;
  bool _soundEnabled = false, _alarmPlaying = false;

  Future<void> _soundPreference() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(
        () => _soundEnabled = prefs.getBool('staffKitchenSound') ?? true,
      );
      _syncAlarm();
    }
  }

  // /kitchen contains paid orders only; its DTO intentionally omits paymentStatus.
  bool get _needsAlarm =>
      _orders.any((row) => row['kitchenStatus'] == 'queued');
  void _syncAlarm() {
    if (!_active || !_soundEnabled || !_needsAlarm) {
      _alarmTimer?.cancel();
      _alarmTimer = null;
      unawaited(_alarm?.stop());
      return;
    }
    if (_alarmTimer != null) return;
    unawaited(_ring());
    _alarmTimer = Timer.periodic(
      const Duration(seconds: 20),
      (_) => unawaited(_ring()),
    );
  }

  Future<void> _ring() async {
    if (_alarmPlaying ||
        !mounted ||
        !_active ||
        !_soundEnabled ||
        !_needsAlarm) {
      return;
    }
    _alarmPlaying = true;
    try {
      final player = _alarm ??= AudioPlayer();
      await player.setAsset('assets/audio/staff-order-alarm.wav');
      if (mounted && _active && _soundEnabled && _needsAlarm) {
        await player.play();
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = staffText(
            'Не удалось включить звук. Проверьте громкость телефона.',
            'Дыбысты қосу мүмкін болмады. Телефон дыбысын тексеріңіз.',
            'Unable to play the alarm. Check phone volume.',
          ),
        );
      }
    } finally {
      _alarmPlaying = false;
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_soundPreference());
    unawaited(_load());
    _connect();
    _poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_active) {
        unawaited(_load());
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    unawaited(
      _wakelock.setActive(
        _active &&
            shouldKeepAdminPortalAwake(
              screenSize: MediaQuery.sizeOf(context),
              platform: defaultTargetPlatform,
            ),
      ),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    _syncAlarm();
    if (_active) {
      _connect();
      unawaited(_load());
    } else {
      unawaited(_events?.cancel());
      _events = null;
      _reconnect?.cancel();
    }
    unawaited(
      _wakelock.setActive(
        _active &&
            shouldKeepAdminPortalAwake(
              screenSize: MediaQuery.sizeOf(context),
              platform: defaultTargetPlatform,
            ),
      ),
    );
  }

  void _connect() {
    if (!_active || !mounted || _events != null) return;
    _events = widget.api
        .events(lastEventId: _lastEvent)
        .listen(
          (event) {
            if (!mounted) return;
            _retries = 0;
            if ('${event['id']}'.isNotEmpty) _lastEvent = '${event['id']}';
            setState(() => _online = true);
            if (event['type'] != 'heartbeat') unawaited(_load());
          },
          onError: (Object _) => _disconnected(),
          onDone: _disconnected,
          cancelOnError: true,
        );
  }

  void _disconnected() {
    _events = null;
    if (!mounted) return;
    setState(() => _online = false);
    _reconnect?.cancel();
    if (_active) {
      _reconnect = Timer(
        Duration(seconds: min(30, 1 << min(_retries++, 5))),
        _connect,
      );
    }
  }

  Future<void> _load() async {
    if (_loading) {
      _reload = true;
      return;
    }
    _loading = true;
    final revision = _revision;
    if (mounted) setState(() {});
    try {
      final result = await widget.api.request(
        '/kitchen?includeClosed=$_closed',
      );
      if (mounted && revision == _revision) {
        setState(() {
          _orders = (result['orders'] as List)
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList();
          _error = null;
        });
        _syncAlarm();
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      _loading = false;
      if (mounted) {
        setState(() {});
        if (_reload || revision != _revision) {
          _reload = false;
          unawaited(_load());
        }
      }
    }
  }

  String _label(String status) => switch (status) {
    'queued' => staffText('Новые', 'Жаңа', 'New'),
    'preparing' => staffText('Готовятся', 'Дайындалуда', 'Preparing'),
    'ready' => staffText('Готовы', 'Дайын', 'Ready'),
    'handed_over' => staffText('Выданы', 'Берілді', 'Handed over'),
    'cancelled' => staffText('Отменены', 'Бас тартылды', 'Cancelled'),
    _ => staffText('Все', 'Барлығы', 'All'),
  };

  String _action(String status, bool delivery) => switch (status) {
    'preparing' => staffText(
      'Принять заказ',
      'Тапсырысты қабылдау',
      'Accept order',
    ),
    'ready' => staffText('Заказ готов', 'Тапсырыс дайын', 'Mark ready'),
    'handed_over' =>
      delivery
          ? staffText('Передать курьеру', 'Курьерге беру', 'Hand to courier')
          : staffText('Выдать заказ', 'Тапсырысты беру', 'Hand over order'),
    _ => staffText('Отменить заказ', 'Тапсырыстан бас тарту', 'Cancel order'),
  };

  Future<void> _change(Map<String, dynamic> order, String status) async {
    final id = '${order['id']}';
    if (!widget.canEdit ||
        (status == 'cancelled' && !widget.canCancel) ||
        _saving.contains(id)) {
      return;
    }
    final delivery = order['fulfillmentType'] == 'delivery';
    final input = TextEditingController(
      text: status == 'preparing' ? '${order['preparationMinutes'] ?? 30}' : '',
    );
    final form = GlobalKey<FormState>();
    final route = DialogRoute<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        scrollable: true,
        title: Text('${_action(status, delivery)} №${order['number']}'),
        content: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (status == 'preparing') ...[
                Text(
                  staffText(
                    'Время приготовления, минут',
                    'Дайындау уақыты, минут',
                    'Preparation time, minutes',
                  ),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: input,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: (value) {
                    final minutes = int.tryParse(value ?? '');
                    return minutes == null || minutes < 1 || minutes > 240
                        ? staffText(
                            'Укажите от 1 до 240 минут',
                            '1–240 минутты көрсетіңіз',
                            'Enter 1–240 minutes',
                          )
                        : null;
                  },
                ),
                if (delivery)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(
                      staffText(
                        'После принятия начнётся поиск автокурьера.',
                        'Қабылдағаннан кейін автокурьерді іздеу басталады.',
                        'Accepting starts the car courier dispatch.',
                      ),
                    ),
                  ),
              ],
              if (status == 'cancelled') ...[
                Text(
                  staffText(
                    'Заказ будет отменён с возвратом оплаты.',
                    'Тапсырыс тоқтатылып, төлем қайтарылады.',
                    'The order will be cancelled and refunded.',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: input,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 500,
                  decoration: InputDecoration(
                    labelText: staffText('Причина', 'Себебі', 'Reason'),
                  ),
                  validator: (value) => (value ?? '').trim().isEmpty
                      ? staffText(
                          'Укажите причину',
                          'Себебін көрсетіңіз',
                          'Enter a reason',
                        )
                      : null,
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(staffText('Назад', 'Артқа', 'Back')),
          ),
          FilledButton(
            onPressed: () {
              if (form.currentState!.validate()) {
                Navigator.pop(dialogContext, true);
              }
            },
            child: Text(_action(status, delivery), textAlign: TextAlign.center),
          ),
        ],
      ),
    );
    final confirmed = await Navigator.of(context).push(route);
    final value = input.text.trim();
    unawaited(route.completed.then((_) => input.dispose()));
    if (confirmed != true || !mounted) return;
    setState(() {
      _saving.add(id);
      _revision++;
    });
    try {
      final result = await widget.api.request(
        '/kitchen/${Uri.encodeComponent(id)}/status',
        method: 'PATCH',
        body: {
          'status': status,
          if (status == 'preparing') 'preparationMinutes': int.parse(value),
          if (status == 'cancelled') 'cancellationReason': value,
        },
      );
      if (mounted) {
        setState(() {
          _revision++;
          final updated = Map<String, dynamic>.from(result['order'] as Map);
          _orders = _orders
              .map((row) => '${row['id']}' == id ? updated : row)
              .toList();
        });
        unawaited(_load());
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _saving.remove(id));
    }
  }

  String _time(Object? value) {
    final time = DateTime.tryParse('$value');
    if (time == null) return '—';
    final local = time.toUtc().add(const Duration(hours: 5));
    String pad(int value) => '$value'.padLeft(2, '0');
    return '${pad(local.day)}.${pad(local.month)} ${pad(local.hour)}:${pad(local.minute)}';
  }

  Widget _ticket(Map<String, dynamic> order) {
    final status = '${order['kitchenStatus']}';
    final promised = DateTime.tryParse('${order['promisedReadyAt']}');
    final late =
        promised != null &&
        promised.isBefore(DateTime.now()) &&
        !['ready', 'handed_over', 'cancelled'].contains(status);
    final courier = (order['externalDelivery'] as Map?)?['courier'] as Map?;
    final delivery = order['fulfillmentType'] == 'delivery';
    final next = switch (status) {
      'queued' => 'preparing',
      'preparing' => 'ready',
      'ready' => 'handed_over',
      _ => null,
    };
    final items = (order['items'] as List? ?? []).whereType<Map>();
    final busy = _saving.contains('${order['id']}');
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (late)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  staffText('Задерживается', 'Кешігуде', 'Overdue'),
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            if (courier?['latitude'] is num && courier?['longitude'] is num)
              TextButton.icon(
                onPressed: () => launchUrl(
                  Uri.https('yandex.kz', '/maps/', {
                    'pt': '${courier!['longitude']},${courier['latitude']}',
                    'z': '16',
                  }),
                  mode: LaunchMode.externalApplication,
                ),
                icon: const Icon(Icons.location_on_outlined),
                label: Text(
                  '${staffText('Курьер на карте', 'Картадағы курьер', 'Courier location')} · ${_time(courier?['locationUpdatedAt'])}',
                ),
              ),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 12,
              runSpacing: 6,
              children: [
                Text(
                  '№${order['number']}',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Chip(
                  avatar: Icon(
                    delivery
                        ? Icons.delivery_dining_outlined
                        : Icons.shopping_bag_outlined,
                    size: 18,
                  ),
                  label: Text(
                    delivery
                        ? staffText('Доставка', 'Жеткізу', 'Delivery')
                        : staffText('Самовывоз', 'Алып кету', 'Pickup'),
                  ),
                ),
              ],
            ),
            Text(
              '${order['branch'] ?? ''}',
              style: const TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 4),
            Text('${_label(status)} · ${_time(order['createdAt'])}'),
            if (order['promisedReadyAt'] != null)
              Text(
                '${staffText('Готовность', 'Дайын болу уақыты', 'Ready by')}: ${_time(order['promisedReadyAt'])}',
              ),
            if (order['customerArrivedAt'] != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  staffText(
                    'Клиент на месте',
                    'Клиент келді',
                    'Customer has arrived',
                  ),
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF21754B),
                  ),
                ),
              ),
            const Divider(height: 26),
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${item['name'] ?? ''}',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          for (final modifier
                              in (item['modifiers'] as List? ?? [])
                                  .whereType<Map>())
                            Text(
                              '${modifier['name'] ?? ''} × ${modifier['quantity'] ?? 1}',
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text('× ${item['quantity'] ?? 1}'),
                  ],
                ),
              ),
            if ('${order['comment'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text('${order['comment']}'),
              ),
            if (order['substitutionPreference'] == 'cancel_order')
              Text(
                staffText(
                  'Без замены товаров',
                  'Тауарларды ауыстырмау',
                  'No substitutions',
                ),
              ),
            if ('${order['courierDispatchError'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  '${order['courierDispatchError']}',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            if (order['externalDelivery'] is Map &&
                order['externalDelivery']['courier'] is Map) ...[
              Text('${order['externalDelivery']['courier']['name'] ?? ''}'),
              Text('${order['externalDelivery']['courier']['vehicle'] ?? ''}'),
              if ('${order['externalDelivery']['courier']['phone'] ?? ''}'
                  .isNotEmpty)
                TextButton.icon(
                  icon: const Icon(Icons.call_outlined),
                  onPressed: () => launchUrl(
                    Uri(
                      scheme: 'tel',
                      path: '${order['externalDelivery']['courier']['phone']}',
                    ),
                  ),
                  label: Text(
                    '${order['externalDelivery']['courier']['phone']}',
                  ),
                ),
            ],
            if (order['acceptedBy'] != null)
              Text(
                '${staffText('Принял', 'Қабылдады', 'Accepted by')}: ${order['acceptedBy']} · ${_time(order['acceptedAt'])}',
              ),
            if (next != null && widget.canEdit) ...[
              const SizedBox(height: 16),
              FilledButton(
                onPressed: busy ? null : () => _change(order, next),
                child: busy
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        _action(next, delivery),
                        textAlign: TextAlign.center,
                      ),
              ),
              if (widget.canCancel)
                TextButton(
                  onPressed: busy ? null : () => _change(order, 'cancelled'),
                  child: Text(staffText('Отменить', 'Бас тарту', 'Cancel')),
                ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final queued = _orders
        .where((row) => row['kitchenStatus'] == 'queued')
        .length;
    final visible = _orders
        .where(
          (row) =>
              (_status == 'all' || row['kitchenStatus'] == _status) &&
              [
                '${row['number']}',
                '${row['branch']}',
                '${row['items']}',
              ].join(' ').toLowerCase().contains(_search.toLowerCase()),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Icon(
                      Icons.circle,
                      size: 8,
                      color: _online
                          ? const Color(0xFF278151)
                          : const Color(0xFFB48632),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        _online
                            ? staffText('Онлайн', 'Онлайн', 'Online')
                            : staffText(
                                'Подключение…',
                                'Қосылуда…',
                                'Connecting…',
                              ),
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF746B63),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: _soundEnabled
                    ? staffText('Выключить звук', 'Дыбысты өшіру', 'Mute sound')
                    : staffText(
                        'Включить звук',
                        'Дыбысты қосу',
                        'Enable sound',
                      ),
                isSelected: _soundEnabled,
                selectedIcon: const Icon(Icons.volume_up_outlined, size: 21),
                icon: const Icon(Icons.volume_off_outlined, size: 21),
                onPressed: () async {
                  setState(() => _soundEnabled = !_soundEnabled);
                  _syncAlarm();
                  await (await SharedPreferences.getInstance()).setBool(
                    'staffKitchenSound',
                    _soundEnabled,
                  );
                },
              ),
              IconButton(
                tooltip: staffText('Обновить', 'Жаңарту', 'Refresh'),
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh_rounded, size: 21),
              ),
              PopupMenuButton<String>(
                tooltip: staffText(
                  'Вид заказов',
                  'Тапсырыс көрінісі',
                  'Order view',
                ),
                color: Colors.white,
                surfaceTintColor: Colors.transparent,
                icon: const Icon(Icons.tune_rounded, size: 21),
                onSelected: (value) {
                  setState(() {
                    if (value == 'closed') {
                      _closed = !_closed;
                      _revision++;
                    }
                    _status = 'all';
                  });
                  if (value == 'closed') unawaited(_load());
                },
                itemBuilder: (_) => [
                  PopupMenuItem(
                    value: 'all',
                    child: Text(
                      staffText(
                        'Все активные',
                        'Барлық белсенді',
                        'All active',
                      ),
                    ),
                  ),
                  CheckedPopupMenuItem(
                    value: 'closed',
                    checked: _closed,
                    child: Text(
                      staffText(
                        'Завершённые заказы',
                        'Аяқталған тапсырыстар',
                        'Closed orders',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (queued > 0)
            Container(
              margin: const EdgeInsets.symmetric(vertical: 12),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF0DD),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '${staffText('Ожидают принятия', 'Қабылдауды күтуде', 'Awaiting acceptance')}: $queued',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          TextField(
            // The alarm remains active until a refreshed server response confirms acceptance.
            onChanged: (value) => setState(() => _search = value),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: staffText(
                'Найти заказ',
                'Тапсырысты іздеу',
                'Find order',
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              for (final status in ['queued', 'preparing', 'ready'])
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(right: status == 'ready' ? 0 : 8),
                    child: Semantics(
                      button: true,
                      selected: _status == status,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () => setState(() => _status = status),
                        child: AnimatedContainer(
                          duration: MediaQuery.disableAnimationsOf(context)
                              ? Duration.zero
                              : const Duration(milliseconds: 180),
                          padding: const EdgeInsets.symmetric(
                            vertical: 14,
                            horizontal: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: _status == status
                                  ? const Color(0xFFAC8750)
                                  : const Color(0xFFECE6DF),
                            ),
                          ),
                          child: Column(
                            children: [
                              Text(
                                '${_orders.where((row) => row['kitchenStatus'] == status).length}',
                                style: const TextStyle(
                                  fontSize: 21,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF55301D),
                                ),
                              ),
                              const SizedBox(height: 7),
                              Text(
                                _label(status),
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (!_loading && visible.isEmpty)
            StaffEmptyState(
              icon: Icons.soup_kitchen_outlined,
              title: staffText(
                'Заказов пока нет',
                'Тапсырыстар әлі жоқ',
                'No orders yet',
              ),
              description: staffText(
                'Новые заказы появятся здесь автоматически.',
                'Жаңа тапсырыстар осында автоматты түрде пайда болады.',
                'New orders will appear here automatically.',
              ),
            ),
          for (final order in visible) _ticket(order),
        ],
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _alarmTimer?.cancel();
    unawaited(_alarm?.dispose());
    _reconnect?.cancel();
    unawaited(_events?.cancel());
    unawaited(_wakelock.dispose());
    super.dispose();
  }
}
