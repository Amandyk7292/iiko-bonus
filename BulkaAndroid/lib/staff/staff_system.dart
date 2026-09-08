part of '../main.dart';

class StaffSystem extends StatefulWidget {
  const StaffSystem({required this.api, required this.section, super.key});
  final StaffApiClient api;
  final String section;
  @override
  State<StaffSystem> createState() => _StaffSystemState();
}

class _StaffSystemState extends State<StaffSystem> {
  Map<String, dynamic> _data = {};
  List<Map<String, dynamic>> _logs = [];
  int _page = 1, _total = 0, _generation = 0;
  bool _loading = false;
  String _search = '', _method = '', _outcome = '';
  String? _error;
  Timer? _debounce;
  late final StaffLiveRefresh _live;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _loading);
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    final generation = ++_generation;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(
        widget.section == 'security'
            ? '/security/status'
            : '/integrations/status',
      );
      final logs = widget.section == 'security'
          ? await widget.api.request(
              '/audit-logs',
              query: {
                'page': '$_page',
                'pageSize': '50',
                'search': _search,
                'method': _method,
                'outcome': _outcome,
              },
            )
          : null;
      if (mounted && generation == _generation) {
        setState(() {
          _data = Map<String, dynamic>.from(result as Map);
          _logs = staffRows(logs?['logs']);
          _total = (logs?['total'] as num?)?.toInt() ?? 0;
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

  Future<void> _paymentAction(bool probe) async {
    final payments = (_data['payments'] as Map?) ?? {};
    final mode = (payments['mode'] as Map?) ?? {};
    final accepted = await staffEdit(
      context,
      title: probe
          ? staffText(
              'Проверить платёжное подключение?',
              'Төлем байланысын тексеру керек пе?',
              'Check payment connection?',
            )
          : staffText(
              'Изменить способ оплаты?',
              'Төлем тәсілін өзгерту керек пе?',
              'Change checkout integration?',
            ),
      description: probe
          ? staffText(
              'Проверка доступности провайдера',
              'Провайдер қолжетімділігін тексеру',
              'Provider availability check',
            )
          : mode['widgetEnabled'] == true
          ? staffText(
              'Использовать платёжную страницу Forte',
              'Forte төлем бетін пайдалану',
              'Use Forte hosted payment page',
            )
          : staffText(
              'Включить виджет Forte',
              'Forte виджетін қосу',
              'Enable Forte widget',
            ),
      fields: [],
      save: (_) async {
        await widget.api.request(
          probe
              ? '/integrations/payments/probe'
              : '/integrations/payments/widget',
          method: probe ? 'POST' : 'PUT',
          body: probe ? null : {'enabled': mode['widgetEnabled'] != true},
        );
      },
    );
    if (accepted == true && mounted) unawaited(_load());
  }

  Widget _security() {
    final users = staffRows(_data['configuredUsers']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                StaffFacts({
                  staffText(
                    'Двухфакторный вход',
                    'Екі факторлы кіру',
                    'Two-factor authentication',
                  ): _data['mfaRequired'] == true
                      ? staffText('Обязателен', 'Міндетті', 'Required')
                      : staffText('Не обязателен', 'Міндетті емес', 'Optional'),
                  staffText(
                    'Аккаунты с 2FA',
                    '2FA аккаунттары',
                    'Accounts with 2FA',
                  ): '${users.where((u) => u['mfa'] == true).length}/${users.length}',
                }),
                for (final user in users)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${user['username']}'),
                    subtitle: Text(staffRoleLabels()['${user['role']}'] ?? ''),
                    trailing: Icon(
                      user['mfa'] == true
                          ? Icons.verified_user_outlined
                          : Icons.shield_outlined,
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 18),
        TextField(
          decoration: InputDecoration(
            labelText: staffText(
              'Поиск в журнале',
              'Журналдан іздеу',
              'Search audit log',
            ),
            prefixIcon: const Icon(Icons.search),
          ),
          onChanged: (value) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), () {
              _search = value;
              _page = 1;
              unawaited(_load());
            });
          },
        ),
        const SizedBox(height: 12),
        StaffPicker(
          label: staffText('Действие', 'Әрекет', 'Method'),
          value: _method,
          options: {
            '': staffText('Все', 'Барлығы', 'All'),
            for (final v in ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) v: v,
          },
          onChanged: (v) {
            _method = v;
            _page = 1;
            unawaited(_load());
          },
        ),
        const SizedBox(height: 12),
        StaffPicker(
          label: staffText('Результат', 'Нәтиже', 'Outcome'),
          value: _outcome,
          options: {
            '': staffText('Все', 'Барлығы', 'All'),
            'success': staffText('Успешно', 'Сәтті', 'Success'),
            'rejected': staffText('Отклонено', 'Қабылданбады', 'Rejected'),
            'server_error': staffText(
              'Ошибка сервера',
              'Сервер қатесі',
              'Server error',
            ),
          },
          onChanged: (v) {
            _outcome = v;
            _page = 1;
            unawaited(_load());
          },
        ),
        for (final log in _logs)
          Card(
            child: ExpansionTile(
              title: Text(
                '${log['admin_username'] ?? log['admin_subject'] ?? '—'} · ${log['method']}',
              ),
              subtitle: Text('${staffDate(log['created_at'])}\n${log['path']}'),
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: StaffFacts({
                    staffText(
                      'Результат',
                      'Нәтиже',
                      'Outcome',
                    ): '${log['outcome'] ?? '—'} · ${log['status_code'] ?? '—'}',
                    staffText('Запрос', 'Сұрау', 'Request ID'):
                        '${log['request_id'] ?? '—'}',
                    staffText('Действие', 'Әрекет', 'Action'):
                        '${log['action_code'] ?? '—'}',
                    staffText(
                      'Объект',
                      'Нысан',
                      'Target',
                    ): '${log['target_type'] ?? '—'} · ${log['target_id'] ?? '—'}',
                    staffText('Филиал', 'Филиал', 'Branch'):
                        '${log['branch_id'] ?? '—'}',
                    staffText('Основание', 'Негіздеме', 'Reason'):
                        '${log['reason'] ?? '—'}',
                    if (log['amount_change'] != null)
                      staffText(
                        'Изменение суммы',
                        'Сома өзгерісі',
                        'Amount change',
                      ): staffMoney(
                        log['amount_change'],
                      ),
                    'IP': '${log['ip'] ?? log['ip_hash'] ?? '—'}',
                    staffText('Устройство', 'Құрылғы', 'Device'):
                        '${log['user_agent'] ?? '—'}',
                    for (final entry
                        in ((log['context'] as Map?) ?? {}).entries)
                      '${entry.key}': '${entry.value ?? '—'}',
                  }),
                ),
              ],
            ),
          ),
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
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
            Text('$_page / ${(_total / 50).ceil().clamp(1, 999999)}'),
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
    );
  }

  Widget _integrations() {
    final payments = (_data['payments'] as Map?) ?? {};
    final mode = (payments['mode'] as Map?) ?? {};
    final providers = (payments['providers'] as Map?) ?? {};
    final webhook =
        ((payments['webhooks'] as Map?)?['forteWidget'] as Map?) ?? {};
    final cleanup = (payments['cleanup'] as Map?) ?? {};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final service in staffRows(_data['services']))
          Card(
            child: ExpansionTile(
              leading: Icon(
                service['state'] == 'healthy'
                    ? Icons.check_circle_outline
                    : Icons.info_outline,
              ),
              title: Text('${service['name']}'),
              subtitle: Text('${service['summary']}'),
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    '${service['detail']}\n${staffDate(service['updatedAt'])}',
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 18),
        Text(
          staffText('Оплата', 'Төлем', 'Payments'),
          style: Theme.of(context).textTheme.titleLarge,
        ),
        StaffFacts({
          staffText(
            'Подключение',
            'Қосылым',
            'Integration',
          ): mode['effectiveIntegration'] == 'widget'
              ? 'Forte Widget'
              : 'Forte Hosted',
          staffText(
            'Резервный режим',
            'Қосалқы режим',
            'Fallback',
          ): mode['fallbackActive'] == true
              ? '${mode['fallbackReason'] ?? '—'}'
              : staffText('Не используется', 'Қолданылмайды', 'Not active'),
        }),
        for (final entry in providers.entries)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    entry.key == 'forteWidget'
                        ? 'Forte Widget'
                        : 'Forte Hosted',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text('${entry.value['message'] ?? ''}'),
                  StaffFacts({
                    staffText(
                      'Доступность',
                      'Қолжетімділік',
                      'Availability',
                    ): entry.value['available'] == null
                        ? staffText(
                            'Не проверено',
                            'Тексерілмеді',
                            'Not checked',
                          )
                        : entry.value['available'] == true
                        ? staffText('Доступен', 'Қолжетімді', 'Available')
                        : staffText('Недоступен', 'Қолжетімсіз', 'Unavailable'),
                    staffText('Проверено', 'Тексерілді', 'Checked'): staffDate(
                      entry.value['checkedAt'],
                    ),
                    if (entry.value['errorCode'] != null)
                      staffText('Код ошибки', 'Қате коды', 'Error code'):
                          '${entry.value['errorCode']}',
                    if (entry.value['availableMethods'] is List)
                      staffText('Методы', 'Тәсілдер', 'Methods'):
                          (entry.value['availableMethods'] as List).join(', '),
                  }),
                ],
              ),
            ),
          ),
        if (payments['canManage'] == true)
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              OutlinedButton(
                onPressed: () => _paymentAction(true),
                child: Text(
                  staffText(
                    'Проверить подключение',
                    'Қосылымды тексеру',
                    'Check connection',
                  ),
                ),
              ),
              OutlinedButton(
                onPressed: () => _paymentAction(false),
                child: Text(
                  mode['widgetEnabled'] == true
                      ? staffText(
                          'Выключить виджет',
                          'Виджетті өшіру',
                          'Disable widget',
                        )
                      : staffText(
                          'Включить виджет',
                          'Виджетті қосу',
                          'Enable widget',
                        ),
                ),
              ),
            ],
          ),
        ExpansionTile(
          title: Text(
            staffText(
              'Уведомления об оплате',
              'Төлем хабарламалары',
              'Payment webhooks',
            ),
          ),
          children: [
            StaffFacts({
              staffText('Последний успех', 'Соңғы сәттілік', 'Last success'):
                  staffDate(webhook['lastSuccessAt']),
              staffText('Последняя ошибка', 'Соңғы қате', 'Last failure'):
                  staffDate(webhook['lastFailureAt']),
              staffText('Код ошибки', 'Қате коды', 'Error code'):
                  '${webhook['lastErrorCode'] ?? '—'}',
            }),
          ],
        ),
        ExpansionTile(
          title: Text(
            staffText(
              'Очистка неоплаченных заказов',
              'Төленбеген тапсырыстарды тазалау',
              'Unpaid order cleanup',
            ),
          ),
          children: [
            StaffFacts({
              staffText('Проверено', 'Тексерілді', 'Inspected'): staffNumber(
                cleanup['inspected'],
              ),
              staffText('Истекло', 'Мерзімі өтті', 'Expired'): staffNumber(
                cleanup['expired'],
              ),
              staffText('Отменено', 'Бас тартылды', 'Cancelled'): staffNumber(
                cleanup['cancelled'],
              ),
              staffText('Резерв снят', 'Резерв босатылды', 'Released'):
                  staffNumber(cleanup['released']),
              staffText('Ошибки', 'Қателер', 'Errors'): staffNumber(
                cleanup['errors'],
              ),
            }),
          ],
        ),
        for (final error in staffRows(payments['latestErrors']))
          Card(
            child: ListTile(
              title: Text(
                '№${error['orderNumber'] ?? '—'} · ${error['provider']}',
              ),
              subtitle: Text(
                '${error['message']}\n${staffDate(error['occurredAt'])}',
              ),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (_data.isNotEmpty)
          widget.section == 'security' ? _security() : _integrations(),
      ],
    ),
  );
  @override
  void dispose() {
    _generation++;
    _live.dispose();
    _debounce?.cancel();
    super.dispose();
  }
}

class StaffSiteAccess extends StatefulWidget {
  const StaffSiteAccess({required this.api, super.key});
  final StaffApiClient api;
  @override
  State<StaffSiteAccess> createState() => _StaffSiteAccessState();
}

class _StaffSiteAccessState extends State<StaffSiteAccess> {
  Map<String, dynamic> _site = {}, _ordering = {};
  String? _error;
  bool _loading = false;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        widget.api.request('/site-access'),
        widget.api.request('/online-ordering'),
      ]);
      if (mounted) {
        setState(() {
          _site = Map<String, dynamic>.from(results[0] as Map);
          _ordering = Map<String, dynamic>.from(results[1]['config'] as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit(bool site) async {
    final config = (_site['config'] as Map?) ?? {};
    final saved = await staffEdit(
      context,
      title: site
          ? staffText('Доступ к сайту', 'Сайтқа кіру', 'Website access')
          : staffText(
              'Приём онлайн-заказов',
              'Онлайн тапсырыстарды қабылдау',
              'Online ordering',
            ),
      description: site
          ? '${staffText('Текущий IP', 'Ағымдағы IP', 'Current IP')}: ${_site['currentIp'] ?? '—'}'
          : null,
      fields: site
          ? [
              StaffField(
                'enabled',
                staffText(
                  'Разрешить только указанные IP',
                  'Тек көрсетілген IP-ге рұқсат беру',
                  'Allow only listed IP addresses',
                ),
                type: 'bool',
              ),
              StaffField(
                'allowedIps',
                staffText(
                  'IP-адреса, каждый с новой строки',
                  'IP мекенжайлары, әрқайсысы жаңа жолда',
                  'IP addresses, one per line',
                ),
                type: 'multiline',
              ),
            ]
          : [
              StaffField(
                'disabled',
                staffText(
                  'Приостановить онлайн-заказы',
                  'Онлайн тапсырыстарды тоқтату',
                  'Pause online ordering',
                ),
                type: 'bool',
              ),
            ],
      initial: site
          ? {
              ...config,
              'allowedIps': (config['allowedIps'] as List? ?? []).join('\n'),
            }
          : _ordering,
      save: (values) async {
        await widget.api.request(
          site ? '/site-access' : '/online-ordering',
          method: 'PUT',
          body: site
              ? {...values, 'allowedIps': staffSplit(values['allowedIps'])}
              : values,
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        Card(
          child: ListTile(
            title: Text(
              staffText('Доступ к сайту', 'Сайтқа кіру', 'Website access'),
            ),
            subtitle: Text(
              (_site['config'] as Map?)?['enabled'] == true
                  ? staffText(
                      'По списку IP',
                      'IP тізімі бойынша',
                      'IP allowlist',
                    )
                  : staffText(
                      'Открыт для всех',
                      'Барлығына ашық',
                      'Open to everyone',
                    ),
            ),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => _edit(true),
          ),
        ),
        Card(
          child: ListTile(
            title: Text(
              staffText(
                'Онлайн-заказы',
                'Онлайн тапсырыстар',
                'Online ordering',
              ),
            ),
            subtitle: Text(
              _ordering['disabled'] == true
                  ? staffText('Приостановлены', 'Тоқтатылған', 'Paused')
                  : staffText('Принимаются', 'Қабылданады', 'Enabled'),
            ),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => _edit(false),
          ),
        ),
      ],
    ),
  );
}
