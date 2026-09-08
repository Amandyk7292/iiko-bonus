part of '../main.dart';

class StaffCustomers extends StatefulWidget {
  const StaffCustomers({
    required this.api,
    required this.actions,
    this.role = 'viewer',
    super.key,
  });
  final StaffApiClient api;
  final Set<String> actions;
  final String role;
  @override
  State<StaffCustomers> createState() => _StaffCustomersState();
}

class _StaffCustomersState extends State<StaffCustomers>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _customers = [];
  int _page = 1, _total = 0, _generation = 0;
  bool _loading = false, _mutating = false, _active = true;
  String _search = '';
  String? _error;
  Timer? _debounce, _poll;
  StreamSubscription<Map<String, dynamic>>? _events;
  bool _can(String action) =>
      widget.actions.contains('*') || widget.actions.contains(action);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    _connect();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_active && !_loading) {
        unawaited(_load());
        _connect();
      }
    });
  }

  void _connect() {
    if (_events != null || !_active) return;
    _events = widget.api.events().listen(
      (event) {
        if (_active &&
            [
              'connected',
              'customer.updated',
              'loyalty.balance.updated',
              'order.created',
              'transaction.created',
            ].contains(event['type'])) {
          unawaited(_load());
        }
      },
      onError: (Object _) => _events = null,
      onDone: () => _events = null,
      cancelOnError: true,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) {
      _connect();
      unawaited(_load());
    } else {
      unawaited(_events?.cancel());
      _events = null;
    }
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
          'search': _search.trim(),
        },
      ).query;
      final result = await widget.api.request('/customers?$query');
      if (mounted && generation == _generation) {
        setState(() {
          _customers = (result['customers'] as List)
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList();
          _total = (result['total'] as num).toInt();
          _error = null;
        });
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

  Future<void> _edit(Map<String, dynamic> customer, bool bonus) async {
    if (!_can(bonus ? 'customers:adjust-bonus' : 'customers:update')) return;
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _StaffCustomerEditor(
        api: widget.api,
        customer: customer,
        bonus: bonus,
      ),
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _action(String action, {Map<String, dynamic>? customer}) async {
    final permission = switch (action) {
      'delete' => 'customers:delete',
      'notify-inactive' => 'customers:bulk-notify',
      _ => 'customers:bulk-expire',
    };
    if (!_can(permission) || _mutating) return;
    final title = switch (action) {
      'delete' => staffText(
        'Удалить клиента?',
        'Клиентті жою керек пе?',
        'Delete customer?',
      ),
      'notify-inactive' => staffText(
        'Уведомить неактивных клиентов?',
        'Белсенді емес клиенттерге хабарлау керек пе?',
        'Notify inactive customers?',
      ),
      _ => staffText(
        'Списать истёкшие бонусы?',
        'Мерзімі өткен бонустарды есептен шығару керек пе?',
        'Expire inactive bonuses?',
      ),
    };
    final yes = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => BulkaActionDialog(
        title: Text(title),
        content: Text(
          customer == null
              ? staffText(
                  'Действие затронет всех неактивных клиентов по текущим правилам программы.',
                  'Әрекет бағдарламаның ағымдағы ережелеріне сәйкес барлық белсенді емес клиенттерге қолданылады.',
                  'This applies to all inactive customers under the current loyalty rules.',
                )
              : '${customer['name'] ?? ''}\n${customer['phone'] ?? ''}',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(staffText('Подтвердить', 'Растау', 'Confirm')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _mutating = true);
    try {
      await widget.api.request(
        action == 'delete'
            ? '/customers/${Uri.encodeComponent('${customer!['id']}')}'
            : '/customers/$action',
        method: action == 'delete' ? 'DELETE' : 'POST',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(staffText('Готово', 'Дайын', 'Done'))),
        );
        unawaited(_load());
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _mutating = false);
    }
  }

  Future<void> _export() async {
    String cell(Object? value) {
      var text = '${value ?? ''}';
      if (RegExp(r'^[=+@\-\t\r]').hasMatch(text)) text = "'$text";
      return '"${text.replaceAll('"', '""')}"';
    }

    final rows = <List<Object?>>[
      [
        staffText('Имя', 'Аты', 'Name'),
        staffText('Телефон', 'Телефон', 'Phone'),
        staffText('Бонусы', 'Бонустар', 'Bonus balance'),
        staffText('Покупки', 'Сатып алулар', 'Purchases'),
      ],
      for (final customer in _customers)
        [
          customer['name'],
          customer['phone'],
          customer['balance'],
          customer['total_spent'],
        ],
    ];
    final bytes = Uint8List.fromList(
      utf8.encode(
        '\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}',
      ),
    );
    final box = context.findRenderObject() as RenderBox?;
    try {
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(bytes, mimeType: 'text/csv')],
          fileNameOverrides: ['bulka-customers-page-$_page.csv'],
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        TextField(
          onChanged: (value) {
            _debounce?.cancel();
            _generation++;
            setState(() {
              _search = value;
              _page = 1;
              _customers = [];
            });
            _debounce = Timer(const Duration(milliseconds: 300), _load);
          },
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.search),
            hintText: staffText(
              'Имя или телефон',
              'Аты немесе телефоны',
              'Name or phone',
            ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: _customers.isEmpty || _loading ? null : _export,
              icon: const Icon(Icons.file_download_outlined),
              label: Text(
                staffText('Скачать страницу', 'Бетті жүктеу', 'Export page'),
              ),
            ),
            if (_can('customers:bulk-notify'))
              OutlinedButton(
                onPressed: _mutating ? null : () => _action('notify-inactive'),
                child: Text(
                  staffText(
                    'Напомнить о бонусах',
                    'Бонустарды еске салу',
                    'Bonus reminders',
                  ),
                ),
              ),
            if (_can('customers:bulk-expire'))
              OutlinedButton(
                onPressed: _mutating ? null : () => _action('expire-inactive'),
                child: Text(
                  staffText(
                    'Списать истёкшие',
                    'Мерзімі өткендерді шығару',
                    'Expire bonuses',
                  ),
                ),
              ),
          ],
        ),
        if (_loading || _mutating) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        const SizedBox(height: 12),
        for (final customer in _customers)
          Card(
            margin: const EdgeInsets.only(bottom: 14),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${customer['name'] ?? '—'}',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  SelectableText('${customer['phone'] ?? ''}'),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 24,
                    runSpacing: 8,
                    children: [
                      Text(
                        '${staffText('Бонусы', 'Бонустар', 'Bonus balance')}: ${staffValue(customer['balance'])}',
                      ),
                      Text(
                        '${staffText('Покупки', 'Сатып алулар', 'Purchases')}: ${staffValue(customer['total_spent'])} ₸',
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      TextButton.icon(
                        onPressed: () => Navigator.push(
                          context,
                          StaffPageRoute<void>(
                            builder: (_) => StaffGlobalDetail(
                              api: widget.api,
                              role: widget.role,
                              type: 'customer',
                              id: '${customer['id']}',
                            ),
                          ),
                        ),
                        icon: const Icon(Icons.history),
                        label: Text(
                          staffText(
                            'История клиента',
                            'Клиент тарихы',
                            'Customer history',
                          ),
                        ),
                      ),
                      if (_can('customers:adjust-bonus'))
                        OutlinedButton(
                          onPressed: () => _edit(customer, true),
                          child: Text(
                            staffText(
                              'Изменить бонусы',
                              'Бонустарды өзгерту',
                              'Adjust bonuses',
                            ),
                          ),
                        ),
                      if (_can('customers:update'))
                        TextButton(
                          onPressed: () => _edit(customer, false),
                          child: Text(staffText('Изменить', 'Өзгерту', 'Edit')),
                        ),
                      if (_can('customers:delete'))
                        IconButton(
                          tooltip: staffText('Удалить', 'Жою', 'Delete'),
                          onPressed: _mutating
                              ? null
                              : () => _action('delete', customer: customer),
                          icon: const Icon(Icons.delete_outline),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        if (!_loading && _customers.isEmpty && _error == null)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText(
                'Клиенты не найдены',
                'Клиенттер табылмады',
                'No customers found',
              ),
              textAlign: TextAlign.center,
            ),
          ),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            IconButton(
              tooltip: staffText('Назад', 'Артқа', 'Previous'),
              onPressed: _page == 1 || _loading
                  ? null
                  : () {
                      setState(() => _page--);
                      unawaited(_load());
                    },
              icon: const Icon(Icons.chevron_left),
            ),
            Flexible(
              child: Text(
                '$_page / ${max(1, (_total / 50).ceil())}',
                textAlign: TextAlign.center,
              ),
            ),
            IconButton(
              tooltip: staffText('Далее', 'Келесі', 'Next'),
              onPressed: _page * 50 >= _total || _loading
                  ? null
                  : () {
                      setState(() => _page++);
                      unawaited(_load());
                    },
              icon: const Icon(Icons.chevron_right),
            ),
          ],
        ),
      ],
    ),
  );
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _debounce?.cancel();
    _poll?.cancel();
    unawaited(_events?.cancel());
    super.dispose();
  }
}

class _StaffCustomerEditor extends StatefulWidget {
  const _StaffCustomerEditor({
    required this.api,
    required this.customer,
    required this.bonus,
  });
  final StaffApiClient api;
  final Map<String, dynamic> customer;
  final bool bonus;
  @override
  State<_StaffCustomerEditor> createState() => _StaffCustomerEditorState();
}

class _StaffCustomerEditorState extends State<_StaffCustomerEditor> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(
    text: '${widget.customer['name'] ?? ''}',
  );
  late final _phone = TextEditingController(
    text: '${widget.customer['phone'] ?? ''}',
  );
  final _amount = TextEditingController(), _reason = TextEditingController();
  bool _subtract = false, _busy = false;
  String? _error;
  Future<void> _save() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.request(
        widget.bonus ? '/customers/bonus' : '/customers/update',
        method: 'POST',
        body: {
          'customerId': widget.customer['id'],
          if (widget.bonus) ...{
            'amount':
                num.parse(_amount.text.replaceAll(',', '.')) *
                (_subtract ? -1 : 1),
            'reason': _reason.text.trim(),
          } else ...{
            'name': _name.text.trim(),
            'phone': _phone.text.trim(),
          },
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: BulkaActionDialog(
      title: Text(
        widget.bonus
            ? staffText(
                'Изменить бонусы',
                'Бонустарды өзгерту',
                'Adjust bonuses',
              )
            : staffText(
                'Данные клиента',
                'Клиент деректері',
                'Customer details',
              ),
      ),
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.bonus) ...[
              Text(
                '${widget.customer['name'] ?? ''}\n${widget.customer['phone'] ?? ''}',
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: Text(staffText('Начислить', 'Қосу', 'Credit')),
                    selected: !_subtract,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _subtract = false),
                  ),
                  ChoiceChip(
                    label: Text(staffText('Списать', 'Шығару', 'Debit')),
                    selected: _subtract,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _subtract = true),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                staffText(
                  'Количество бонусов',
                  'Бонустар саны',
                  'Bonus amount',
                ),
              ),
              TextFormField(
                controller: _amount,
                enabled: !_busy,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                validator: (value) {
                  final number = num.tryParse(
                    (value ?? '').replaceAll(',', '.'),
                  );
                  return number == null || !number.isFinite || number <= 0
                      ? staffText(
                          'Введите положительное число',
                          'Оң сан енгізіңіз',
                          'Enter a positive number',
                        )
                      : null;
                },
              ),
              const SizedBox(height: 16),
              Text(staffText('Причина изменения', 'Өзгерту себебі', 'Reason')),
              TextFormField(
                controller: _reason,
                enabled: !_busy,
                minLines: 2,
                maxLines: 4,
                maxLength: 500,
                validator: (value) => (value ?? '').trim().length < 5
                    ? staffText(
                        'Не менее 5 символов',
                        'Кемінде 5 таңба',
                        'At least 5 characters',
                      )
                    : null,
              ),
            ] else ...[
              Text(staffText('Имя', 'Аты', 'Name')),
              TextFormField(controller: _name, enabled: !_busy, maxLength: 160),
              const SizedBox(height: 12),
              Text(staffText('Телефон', 'Телефон', 'Phone')),
              TextFormField(
                controller: _phone,
                enabled: !_busy,
                keyboardType: TextInputType.phone,
                validator: (value) => (value ?? '').trim().isEmpty
                    ? staffText(
                        'Укажите телефон',
                        'Телефонды көрсетіңіз',
                        'Enter a phone number',
                      )
                    : null,
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
      actions: [
        FilledButton(
          onPressed: _busy ? null : _save,
          child: _busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(staffText('Сохранить', 'Сақтау', 'Save')),
        ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
        ),
      ],
    ),
  );
  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }
}
