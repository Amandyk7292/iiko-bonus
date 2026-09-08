part of '../main.dart';

Map<String, String> staffSupportStatuses() => {
  'new': staffText('Новое', 'Жаңа', 'New'),
  'in_review': staffText('В работе', 'Жұмыста', 'In review'),
  'resolved': staffText('Решено', 'Шешілді', 'Resolved'),
  'rejected': staffText('Закрыто', 'Жабылды', 'Closed'),
};
Map<String, String> staffSupportPriorities() => {
  'low': staffText('Низкий', 'Төмен', 'Low'),
  'normal': staffText('Обычный', 'Қалыпты', 'Normal'),
  'high': staffText('Высокий', 'Жоғары', 'High'),
  'urgent': staffText('Срочный', 'Шұғыл', 'Urgent'),
};
Map<String, String> staffReviewStatuses() => {
  'published': staffText('Опубликован', 'Жарияланды', 'Published'),
  'hidden': staffText('Скрыт', 'Жасырылған', 'Hidden'),
  'requires_attention': staffText(
    'Требует внимания',
    'Назар аудару қажет',
    'Needs attention',
  ),
  'resolved': staffText('Решено', 'Шешілді', 'Resolved'),
};

class StaffSupport extends StatefulWidget {
  const StaffSupport({
    required this.api,
    required this.canEdit,
    this.reviews = false,
    super.key,
  });
  final StaffApiClient api;
  final bool canEdit, reviews;
  @override
  State<StaffSupport> createState() => _StaffSupportState();
}

class _StaffSupportState extends State<StaffSupport> {
  String _search = '', _status = '', _queue = 'new', _priority = '';
  int _page = 1, _total = 0, _generation = 0;
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _rows = [];
  Timer? _debounce;
  late final StaffLiveRefresh _live;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: [
        'support.created',
        'support.updated',
        'support.message.created',
        'review.created',
        'review.updated',
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
          'pageSize': '30',
          'search': _search.trim(),
          'status': _status,
          if (!widget.reviews) 'queue': _queue,
          if (!widget.reviews) 'priority': _priority,
        },
      ).query;
      final result = await widget.api.request(
        '/${widget.reviews ? 'reviews' : 'support'}?$query',
      );
      if (mounted && generation == _generation) {
        setState(() {
          _rows = staffRows(result[widget.reviews ? 'reviews' : 'requests']);
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

  void _filter(VoidCallback change) {
    setState(() {
      change();
      _page = 1;
    });
    unawaited(_load());
  }

  Future<void> _open(Map<String, dynamic> row) async {
    if (widget.reviews) {
      if (!widget.canEdit) return;
      await staffEdit(
        context,
        title: staffText('Статус отзыва', 'Пікір мәртебесі', 'Review status'),
        fields: [
          StaffField(
            'status',
            staffText('Статус', 'Мәртебе', 'Status'),
            options: staffReviewStatuses(),
          ),
        ],
        initial: {'status': row['status']},
        save: (values) async {
          await widget.api.request(
            '/reviews/${Uri.encodeComponent('${row['id']}')}/status',
            method: 'PATCH',
            body: values,
          );
        },
      );
    } else {
      await Navigator.push(
        context,
        StaffPageRoute<void>(
          builder: (_) => StaffSupportDetail(
            api: widget.api,
            id: '${row['id']}',
            canEdit: widget.canEdit,
          ),
        ),
      );
    }
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        TextField(
          decoration: InputDecoration(
            labelText: staffText('Поиск', 'Іздеу', 'Search'),
            prefixIcon: const Icon(Icons.search),
          ),
          onChanged: (value) {
            _search = value;
            _page = 1;
            _generation++;
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), _load);
          },
        ),
        const SizedBox(height: 12),
        StaffPicker(
          label: staffText('Статус', 'Мәртебе', 'Status'),
          value: _status,
          options: {
            '': staffText('Все', 'Барлығы', 'All'),
            ...(widget.reviews
                ? staffReviewStatuses()
                : staffSupportStatuses()),
          },
          onChanged: (value) => _filter(() => _status = value),
        ),
        if (!widget.reviews) ...[
          const SizedBox(height: 12),
          StaffPicker(
            label: staffText('Очередь', 'Кезек', 'Queue'),
            value: _queue,
            options: {
              'new': staffText('Новые', 'Жаңа', 'New'),
              'mine': staffText('Мои', 'Менің', 'Mine'),
              'overdue': staffText('Просроченные', 'Мерзімі өткен', 'Overdue'),
              'closed': staffText('Закрытые', 'Жабылған', 'Closed'),
              'all': staffText('Все', 'Барлығы', 'All'),
            },
            onChanged: (value) => _filter(() => _queue = value),
          ),
          const SizedBox(height: 12),
          StaffPicker(
            label: staffText('Приоритет', 'Басымдық', 'Priority'),
            value: _priority,
            options: {
              '': staffText('Все', 'Барлығы', 'All'),
              ...staffSupportPriorities(),
            },
            onChanged: (value) => _filter(() => _priority = value),
          ),
        ],
        const SizedBox(height: 16),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (!_loading && _rows.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText('Обращений нет', 'Өтініштер жоқ', 'No requests'),
              textAlign: TextAlign.center,
            ),
          ),
        for (final row in _rows)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 8),
            child: InkWell(
              onTap: () => _open(row),
              borderRadius: BorderRadius.circular(20),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${(row['customer'] as Map?)?['name'] ?? row['customerName'] ?? row['name'] ?? '—'}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    if (widget.reviews) Text('★ ${row['rating'] ?? '—'}'),
                    Text(
                      '${row['preview'] ?? row['message'] ?? row['comment'] ?? ''}',
                    ),
                    const SizedBox(height: 10),
                    Text(
                      '${row['branch'] ?? ''} · ${staffDate(row['createdAt'] ?? row['created_at'])}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    Text(
                      (widget.reviews
                              ? staffReviewStatuses()
                              : staffSupportStatuses())['${row['status']}'] ??
                          '—',
                    ),
                    if (row['overdue'] == true)
                      Text(
                        staffText(
                          'Срок ответа истёк',
                          'Жауап беру мерзімі өтті',
                          'Response overdue',
                        ),
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
              onPressed: !_loading && _page > 1
                  ? () {
                      _page--;
                      unawaited(_load());
                    }
                  : null,
              icon: const Icon(Icons.chevron_left),
            ),
            Text('$_page / ${max(1, (_total / 30).ceil())} · $_total'),
            IconButton(
              tooltip: staffText('Далее', 'Келесі', 'Next'),
              onPressed: !_loading && _page * 30 < _total
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
    super.dispose();
  }
}

class StaffSupportDetail extends StatefulWidget {
  const StaffSupportDetail({
    required this.api,
    required this.id,
    required this.canEdit,
    super.key,
  });
  final StaffApiClient api;
  final String id;
  final bool canEdit;
  @override
  State<StaffSupportDetail> createState() => _StaffSupportDetailState();
}

class _StaffSupportDetailState extends State<StaffSupportDetail> {
  Map<String, dynamic>? _request;
  List<Map<String, dynamic>> _messages = [];
  bool _loading = false;
  String? _error;
  late final StaffLiveRefresh _live;
  String get _path => '/support/${Uri.encodeComponent(widget.id)}';
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(
      widget.api,
      () => _load(),
      isBusy: () => _loading,
      events: ['support.updated', 'support.message.created'],
    );
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(_path);
      if (mounted) {
        setState(() {
          _request = Map<String, dynamic>.from(result['request'] as Map);
          _messages = staffRows(result['messages']);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _change() async {
    if (!widget.canEdit || _request == null) return;
    await staffEdit(
      context,
      title: staffText(
        'Обработка обращения',
        'Өтінішті өңдеу',
        'Manage request',
      ),
      fields: [
        StaffField(
          'status',
          staffText('Статус', 'Мәртебе', 'Status'),
          options: staffSupportStatuses(),
        ),
        StaffField(
          'priority',
          staffText('Приоритет', 'Басымдық', 'Priority'),
          options: staffSupportPriorities(),
        ),
        StaffField(
          'assignedTo',
          staffText('Ответственный', 'Жауапты', 'Assigned employee'),
          maxLength: 120,
        ),
        StaffField(
          'assignToMe',
          staffText('Назначить мне', 'Маған тағайындау', 'Assign to me'),
          type: 'bool',
        ),
        StaffField(
          'resolution',
          staffText('Решение', 'Шешім', 'Resolution'),
          type: 'multiline',
          maxLength: 1000,
        ),
      ],
      initial: _request!,
      save: (values) async {
        if (['resolved', 'rejected'].contains(values['status'])) {
          final lastPublic = _messages
              .where((m) => m['internal'] != true)
              .lastOrNull;
          if (lastPublic?['senderType'] != 'admin') {
            throw Exception(
              staffText(
                'Сначала ответьте клиенту. Внутренняя заметка не считается ответом.',
                'Алдымен клиентке жауап беріңіз. Ішкі жазба жауап болып саналмайды.',
                'Reply to the customer first. An internal note is not a public reply.',
              ),
            );
          }
        }
        if (values['assignedTo'] == '') values['assignedTo'] = null;
        await widget.api.request(_path, method: 'PATCH', body: values);
      },
    );
    if (mounted) unawaited(_load());
  }

  Future<void> _reply() async {
    if (!widget.canEdit) return;
    await staffEdit(
      context,
      title: staffText(
        'Ответ на обращение',
        'Өтінішке жауап',
        'Reply to request',
      ),
      fields: [
        StaffField(
          'body',
          staffText('Сообщение', 'Хабарлама', 'Message'),
          type: 'multiline',
          required: true,
          maxLength: 4000,
        ),
        StaffField(
          'internal',
          staffText(
            'Внутренняя заметка — клиент не увидит',
            'Ішкі жазба — клиентке көрінбейді',
            'Internal note — hidden from customer',
          ),
          type: 'bool',
        ),
      ],
      submitLabel: staffText('Отправить', 'Жіберу', 'Send'),
      save: (values) async {
        await widget.api.request(
          '$_path/messages',
          method: 'POST',
          body: values,
        );
      },
    );
    if (mounted) unawaited(_load());
  }

  List<Widget> _attachments(dynamic attachments) => [
    for (final item in staffRows(attachments))
      if (item['url'] != null)
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Image.network(
            '${item['url']}',
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => Text(
              staffText(
                'Вложение недоступно',
                'Тіркеме қолжетімсіз',
                'Attachment unavailable',
              ),
            ),
          ),
        ),
  ];
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(staffText('Обращение', 'Өтініш', 'Support request')),
    ),
    body: RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) _StaffError(message: _error!, onRetry: _load),
          if (_request != null) ...[
            StaffFacts({
              staffText('Клиент', 'Клиент', 'Customer'):
                  '${(_request!['customer'] as Map?)?['name'] ?? '—'}',
              staffText('Телефон', 'Телефон', 'Phone'):
                  '${(_request!['customer'] as Map?)?['phone'] ?? '—'}',
              staffText('Заказ', 'Тапсырыс', 'Order'):
                  '${_request!['orderNumber'] ?? '—'}',
              staffText('Филиал', 'Филиал', 'Branch'):
                  '${_request!['branch'] ?? '—'}',
              staffText('Статус', 'Мәртебе', 'Status'):
                  staffSupportStatuses()['${_request!['status']}'] ?? '—',
              staffText('Ответственный', 'Жауапты', 'Assigned employee'):
                  '${_request!['assignedTo'] ?? '—'}',
              staffText('Ответить до', 'Жауап беру мерзімі', 'Respond by'):
                  staffDate(_request!['dueAt']),
            }),
            const SizedBox(height: 16),
            Text('${_request!['message'] ?? ''}'),
            ..._attachments(_request!['attachments']),
            if (widget.canEdit)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    OutlinedButton(
                      onPressed: _change,
                      child: Text(staffText('Изменить', 'Өзгерту', 'Manage')),
                    ),
                    FilledButton(
                      onPressed: _reply,
                      child: Text(staffText('Ответить', 'Жауап беру', 'Reply')),
                    ),
                  ],
                ),
              ),
            for (final message in _messages)
              Card(
                color: message['internal'] == true
                    ? const Color(0xFFFFF5D9)
                    : Colors.white,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        message['internal'] == true
                            ? staffText(
                                'Внутренняя заметка',
                                'Ішкі жазба',
                                'Internal note',
                              )
                            : message['senderType'] == 'admin'
                            ? staffText('Сотрудник', 'Қызметкер', 'Employee')
                            : staffText('Клиент', 'Клиент', 'Customer'),
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 10),
                      SelectableText('${message['body'] ?? ''}'),
                      ..._attachments(message['attachments']),
                      const SizedBox(height: 8),
                      Text(
                        staffDate(message['createdAt']),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ],
      ),
    ),
  );
  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }
}
