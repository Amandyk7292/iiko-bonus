part of '../main.dart';

class StaffNativePush extends ChangeNotifier with WidgetsBindingObserver {
  StaffNativePush(
    this.api, {
    @visibleForTesting
    Future<Map<String, Object?>> Function(StaffPushBridgeAction, bool)? native,
    @visibleForTesting Stream<Map<String, Object?>>? tokenEvents,
  }) : _nativeOverride = native {
    WidgetsBinding.instance.addObserver(this);
    PushNotifications.setStaffPushBridgeActivated(true);
    _tokens = (tokenEvents ?? PushNotifications.staffTokenEvents).listen(
      (_) => unawaited(synchronize()),
    );
    _timer = Timer.periodic(const Duration(seconds: 45), (_) {
      if (!_active || busy || _disposed) return;
      unawaited(enabled ? _heartbeat() : synchronize());
    });
    unawaited(synchronize());
  }
  final StaffApiClient api;
  final Future<Map<String, Object?>> Function(StaffPushBridgeAction, bool)?
  _nativeOverride;
  bool enabled = false,
      busy = false,
      _disposed = false,
      _active = true,
      _disabling = false;
  String? error;
  Map<String, dynamic>? _device;
  Timer? _timer;
  StreamSubscription<Map<String, Object?>>? _tokens;
  Future<void> _serial = Future.value();
  Future<Map<String, Object?>> _native(
    StaffPushBridgeAction action, {
    bool user = false,
  }) =>
      _nativeOverride?.call(action, user) ??
      PushNotifications.handleStaffPushBridgeRequest(
        StaffPushBridgeRequest(
          requestId: staffRequestId(),
          action: action,
          userInitiated: user,
        ),
      );
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> synchronize({bool user = false}) {
    if (_disabling || _disposed) return Future<void>.value();
    _serial = _serial.catchError((Object _) {}).then((_) async {
      if (_disposed) return;
      busy = true;
      _notify();
      try {
        final status = await _native(StaffPushBridgeAction.status);
        if (_disposed) return;
        if (status['ok'] != true) {
          enabled = false;
          if (user) {
            throw Exception(
              staffText(
                'Уведомления недоступны. Проверьте разрешение в настройках телефона.',
                'Хабарландырулар қолжетімсіз. Телефон баптауларындағы рұқсатты тексеріңіз.',
                'Notifications unavailable. Check phone permissions.',
              ),
            );
          }
          return;
        }
        _device = {
          'installationId': status['installationId'],
          'platform': status['platform'],
        };
        final backend = await api.request(
          '/staff/push-token',
          query: {
            'installationId': '${_device!['installationId']}',
            'platform': '${_device!['platform']}',
          },
        );
        if (_disposed) return;
        enabled = backend['enabled'] == true;
        if (user || enabled || status['staffEnrollmentIntent'] == true) {
          final token = await _native(
            StaffPushBridgeAction.register,
            user: user,
          );
          if (_disposed) return;
          if (token['ok'] != true) {
            throw Exception(
              staffText(
                'Разрешите уведомления для Bulka в настройках телефона.',
                'Телефон баптауларында Bulka хабарландыруларына рұқсат беріңіз.',
                'Allow Bulka notifications in phone settings.',
              ),
            );
          }
          await api.request(
            '/staff/push-token',
            method: 'POST',
            body: {..._device!, 'fcmToken': token['fcmToken']},
          );
          enabled = true;
        }
        error = null;
      } catch (e) {
        error = '$e';
      } finally {
        busy = false;
        _notify();
      }
    });
    return _serial;
  }

  Future<void> disable() {
    if (_disabling) return _serial;
    _disabling = true;
    _serial = _serial.catchError((Object _) {}).then((_) async {
      busy = true;
      _notify();
      try {
        if (_disposed) return;
        if (_device != null) {
          await api.request(
            '/staff/push-token',
            method: 'DELETE',
            body: _device,
          );
        }
        await _native(StaffPushBridgeAction.unregister);
        enabled = false;
        error = null;
      } catch (e) {
        error = '$e';
      } finally {
        busy = false;
        _disabling = false;
        _notify();
      }
    });
    return _serial;
  }

  Future<void> _heartbeat() async {
    if (_disposed || !_active || !enabled || busy || _device == null) return;
    try {
      final result = await api.request(
        '/staff/push-heartbeat',
        method: 'POST',
        body: _device,
      );
      if (!_disposed && result['active'] != true) {
        enabled = false;
        _notify();
      }
    } catch (e) {
      if (!_disposed) {
        error = '$e';
        _notify();
      }
    }
  }

  Future<void> test() async {
    if (_device == null || busy) return;
    busy = true;
    _notify();
    try {
      final result = await api.request(
        '/staff/push-test',
        method: 'POST',
        body: _device,
      );
      if (result['delivery']?['delivered'] != 1) {
        throw Exception(
          staffText(
            'Тестовое уведомление не доставлено',
            'Сынақ хабарландыруы жеткізілмеді',
            'Test notification was not delivered',
          ),
        );
      }
      error = null;
    } catch (e) {
      error = '$e';
    } finally {
      busy = false;
      _notify();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) unawaited(synchronize().then((_) => _heartbeat()));
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    unawaited(_tokens?.cancel());
    PushNotifications.setStaffPushBridgeActivated(false);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}

class StaffPushPanel extends StatelessWidget {
  const StaffPushPanel({required this.push, super.key});
  final StaffNativePush push;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: push,
    builder: (context, _) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            staffText(
              'Уведомления сотруднику',
              'Қызметкер хабарландырулары',
              'Staff notifications',
            ),
          ),
          value: push.enabled,
          onChanged: push.busy
              ? null
              : (enabled) {
                  if (enabled) {
                    unawaited(push.synchronize(user: true));
                  } else {
                    unawaited(push.disable());
                  }
                },
        ),
        if (push.busy) const LinearProgressIndicator(),
        if (push.error != null)
          Text(
            push.error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        if (push.enabled)
          TextButton.icon(
            onPressed: push.busy ? null : push.test,
            icon: const Icon(Icons.notifications_active_outlined),
            label: Text(
              staffText(
                'Тест уведомления',
                'Хабарландыру сынағы',
                'Test notification',
              ),
            ),
          ),
      ],
    ),
  );
}

class StaffAlerts extends StatefulWidget {
  const StaffAlerts({required this.api, required this.navigate, super.key});
  final StaffApiClient api;
  final ValueChanged<String> navigate;
  @override
  State<StaffAlerts> createState() => _StaffAlertsState();
}

class _StaffAlertsState extends State<StaffAlerts> {
  Map<String, dynamic> _summary = {};
  late final StaffLiveRefresh _live;
  bool _busy = false;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _busy);
    unawaited(_load());
  }

  Future<void> _load() async {
    if (_busy || !mounted) return;
    _busy = true;
    try {
      final data = await widget.api.request('/operations/summary');
      if (mounted) {
        setState(() => _summary = Map<String, dynamic>.from(data as Map));
      }
    } catch (_) {
      /* The current page presents connection errors; preserve the last badge. */
    } finally {
      _busy = false;
    }
  }

  List<Map<String, dynamic>> get _items {
    final counts = (_summary['counts'] as Map?) ?? {};
    final capabilities = (_summary['capabilities'] as Map?) ?? {};
    return [
          {
            'key': 'paymentIssues',
            'section': 'orders',
            'label': staffText(
              'Проблемы оплаты',
              'Төлем мәселелері',
              'Payment issues',
            ),
          },
          {
            'key': 'newOrders',
            'section': 'orders',
            'label': staffText(
              'Новые оплаченные заказы',
              'Жаңа төленген тапсырыстар',
              'New paid orders',
            ),
          },
          {
            'key': 'kitchenOverdue',
            'section': 'kitchen',
            'label': staffText(
              'Просрочено на кухне',
              'Асүйде кешіккен',
              'Kitchen overdue',
            ),
          },
          {
            'key': 'supportNew',
            'section': 'support',
            'label': staffText(
              'Новые обращения',
              'Жаңа өтініштер',
              'New support requests',
            ),
          },
          {
            'key': 'whatsappUnread',
            'section': 'whatsapp',
            'label': staffText(
              'Непрочитано в WhatsApp',
              'WhatsApp оқылмағандар',
              'Unread WhatsApp',
            ),
          },
        ]
        .where(
          (row) =>
              capabilities[row['section']] == true &&
              (counts[row['key']] as num? ?? 0) > 0,
        )
        .map((row) => {...row, 'count': counts[row['key']]})
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final count = _items.fold<int>(
      0,
      (sum, row) => sum + (row['count'] as num).toInt(),
    );
    return IconButton(
      tooltip: staffText('Уведомления', 'Хабарландырулар', 'Notifications'),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: const Icon(Icons.notifications_none),
      ),
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (c) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  staffText('Уведомления', 'Хабарландырулар', 'Notifications'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                if (_items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(18),
                    child: Text(
                      staffText(
                        'Новых срочных задач нет',
                        'Жаңа шұғыл тапсырмалар жоқ',
                        'No urgent tasks',
                      ),
                    ),
                  ),
                for (final item in _items)
                  ListTile(
                    title: Text('${item['label']}'),
                    trailing: Text('${item['count']}'),
                    onTap: () {
                      Navigator.pop(c);
                      widget.navigate('${item['section']}');
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }
}

class StaffGlobalSearch extends StatefulWidget {
  const StaffGlobalSearch({required this.api, required this.role, super.key});
  final StaffApiClient api;
  final String role;
  @override
  State<StaffGlobalSearch> createState() => _StaffGlobalSearchState();
}

class _StaffGlobalSearchState extends State<StaffGlobalSearch> {
  List<Map<String, dynamic>> _rows = [];
  String? _error;
  bool _loading = false;
  int _generation = 0;
  Timer? _timer;
  Future<void> _search(String value) async {
    final generation = ++_generation;
    if (value.trim().length < 2) {
      setState(() {
        _rows = [];
        _loading = false;
        _error = null;
      });
      return;
    }
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(
        '/global-search',
        query: {'q': value.trim(), 'limit': '20'},
      );
      if (mounted && generation == _generation) {
        setState(() {
          _rows = staffRows(result['results']);
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

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(staffText('Поиск', 'Іздеу', 'Search'))),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        TextField(
          autofocus: true,
          decoration: InputDecoration(
            labelText: staffText(
              'Заказ, клиент или обращение',
              'Тапсырыс, клиент немесе өтініш',
              'Order, customer or support request',
            ),
            prefixIcon: const Icon(Icons.search),
          ),
          onChanged: (v) {
            _timer?.cancel();
            _timer = Timer(
              const Duration(milliseconds: 250),
              () => unawaited(_search(v)),
            );
          },
        ),
        const SizedBox(height: 18),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) Text(_error!),
        for (final row in _rows)
          Card(
            child: ListTile(
              title: Text('${row['title']}'),
              subtitle: Text('${row['subtitle'] ?? ''} ${row['branch'] ?? ''}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                context,
                StaffPageRoute<void>(
                  builder: (_) => StaffGlobalDetail(
                    api: widget.api,
                    role: widget.role,
                    type: '${row['type']}',
                    id: '${row['id']}',
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
  @override
  void dispose() {
    _timer?.cancel();
    _generation++;
    super.dispose();
  }
}

class StaffGlobalDetail extends StatefulWidget {
  const StaffGlobalDetail({
    required this.api,
    required this.role,
    required this.type,
    required this.id,
    super.key,
  });
  final StaffApiClient api;
  final String role, type, id;
  @override
  State<StaffGlobalDetail> createState() => _StaffGlobalDetailState();
}

class _StaffGlobalDetailState extends State<StaffGlobalDetail> {
  Map<String, dynamic>? _detail;
  String? _error;
  late final StaffLiveRefresh _live;
  bool _loading = false;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _loading);
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    _loading = true;
    try {
      final result = await widget.api.request(
        '/global-search/${Uri.encodeComponent(widget.type)}/${Uri.encodeComponent(widget.id)}',
      );
      if (mounted) {
        setState(() {
          _detail = Map<String, dynamic>.from(result['detail'] as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      _loading = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    final profile = d?['customerProfile'] as Map?;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${d?['title'] ?? staffText('Подробности', 'Толығырақ', 'Details')}',
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            if (_error != null) _StaffError(message: _error!, onRetry: _load),
            if (d != null) ...[
              Text('${d['subtitle'] ?? ''}'),
              if (profile != null)
                StaffFacts({
                  staffText('Клиент', 'Клиент', 'Customer'):
                      '${profile['name'] ?? '—'}',
                  staffText('Телефон', 'Телефон', 'Phone'):
                      '${profile['phone'] ?? '—'}',
                  staffText('Бонусы', 'Бонустар', 'Bonus balance'): staffNumber(
                    profile['balance'],
                  ),
                  staffText('Покупки', 'Сатып алулар', 'Total spent'):
                      staffMoney(profile['totalSpent']),
                }),
              if (d['order'] is Map)
                FilledButton(
                  onPressed: () => Navigator.push(
                    context,
                    StaffPageRoute<void>(
                      builder: (_) => StaffOrderDetail(
                        api: widget.api,
                        role: widget.role,
                        order: Map<String, dynamic>.from(d['order'] as Map),
                      ),
                    ),
                  ),
                  child: Text(
                    staffText('Открыть заказ', 'Тапсырысты ашу', 'Open order'),
                  ),
                ),
              if (d['support'] is Map)
                OutlinedButton(
                  onPressed: () => Navigator.push(
                    context,
                    StaffPageRoute<void>(
                      builder: (_) => StaffSupportDetail(
                        api: widget.api,
                        id: '${d['support']['id']}',
                        canEdit: widget.role != 'viewer',
                      ),
                    ),
                  ),
                  child: Text(
                    staffText(
                      'Открыть обращение',
                      'Өтінішті ашу',
                      'Open support request',
                    ),
                  ),
                ),
              const SizedBox(height: 20),
              Text(
                staffText('История событий', 'Оқиғалар тарихы', 'Timeline'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              for (final event in staffRows(d['timeline']))
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.history),
                    title: Text('${event['title']}'),
                    subtitle: SelectableText(
                      '${event['description'] ?? ''}\n${staffDate(event['occurredAt'])} · ${event['actor'] ?? ''}${event['requestId'] == null ? '' : '\n${event['requestId']}'}',
                    ),
                  ),
                ),
            ] else if (_error == null)
              const Center(child: CircularProgressIndicator()),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }
}
