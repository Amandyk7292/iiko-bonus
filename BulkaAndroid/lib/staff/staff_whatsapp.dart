part of '../main.dart';

String staffMessageStatus(dynamic status) => switch ('$status') {
  'pending' || 'queued' => staffText('Отправляется', 'Жіберілуде', 'Sending'),
  'sent' => staffText('Отправлено', 'Жіберілді', 'Sent'),
  'delivered' => staffText('Доставлено', 'Жеткізілді', 'Delivered'),
  'read' => staffText('Прочитано', 'Оқылды', 'Read'),
  'failed' => staffText('Не отправлено', 'Жіберілмеді', 'Not sent'),
  _ => status == null ? '' : '$status',
};

Map<String, String> staffWhatsAppStatuses() => {
  'open': staffText('Открыт', 'Ашық', 'Open'),
  'closed': staffText('Закрыт', 'Жабық', 'Closed'),
  'spam': staffText('Спам', 'Спам', 'Spam'),
};

class StaffWhatsApp extends StatefulWidget {
  const StaffWhatsApp({
    required this.api,
    required this.conversationOnly,
    this.canEdit = true,
    super.key,
  });
  final StaffApiClient api;
  final bool conversationOnly, canEdit;
  @override
  State<StaffWhatsApp> createState() => _StaffWhatsAppState();
}

class _StaffWhatsAppState extends State<StaffWhatsApp> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _connection = {}, _settings = {};
  String _status = '', _search = '';
  int _page = 1, _total = 0, _generation = 0;
  String? _error;
  bool _loading = false;
  Timer? _debounce;
  late final StaffLiveRefresh _live;
  final _drafts = <String, String>{};
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
        '/whatsapp/conversations',
        query: {
          'search': _search,
          'status': _status,
          'page': '$_page',
          'pageSize': '50',
        },
      );
      final connection = widget.conversationOnly
          ? null
          : await widget.api.request('/whatsapp/status');
      if (mounted && generation == _generation) {
        setState(() {
          _rows = staffRows(result['conversations']);
          _total = (result['total'] as num?)?.toInt() ?? 0;
          _connection = Map<String, dynamic>.from(
            (connection?['connection'] as Map?) ?? {},
          );
          _settings = Map<String, dynamic>.from(
            (connection?['settings'] as Map?) ?? {},
          );
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

  Future<void> _configure() async {
    final saved = await staffEdit(
      context,
      title: staffText(
        'Ассистент WhatsApp',
        'WhatsApp көмекшісі',
        'WhatsApp assistant',
      ),
      fields: [
        StaffField(
          'assistantEnabled',
          staffText(
            'Ассистент включён',
            'Көмекші қосылған',
            'Assistant enabled',
          ),
          type: 'bool',
        ),
        StaffField(
          'autoReplyEnabled',
          staffText('Автоответы', 'Автожауаптар', 'Automatic replies'),
          type: 'bool',
        ),
        StaffField(
          'memoryEnabled',
          staffText(
            'Память о клиентах',
            'Клиенттер туралы жады',
            'Customer memory',
          ),
          type: 'bool',
        ),
        StaffField(
          'provider',
          staffText('Провайдер', 'Провайдер', 'Provider'),
          options: {'gemini': 'Gemini', 'qwen': 'Qwen', 'deepseek': 'DeepSeek'},
        ),
        StaffField(
          'model',
          staffText('Модель', 'Модель', 'Model'),
          required: true,
          maxLength: 120,
        ),
        StaffField(
          'apiKey',
          staffText(
            'Новый API-ключ · пусто = сохранить',
            'Жаңа API кілт · бос = сақтау',
            'New API key · blank = keep current',
          ),
          type: 'password',
          maxLength: 512,
        ),
        StaffField(
          'botName',
          staffText('Имя ассистента', 'Көмекші аты', 'Assistant name'),
          required: true,
          maxLength: 80,
        ),
        StaffField(
          'tone',
          staffText('Тон ответов', 'Жауап үні', 'Tone'),
          options: {
            'friendly': staffText('Дружелюбный', 'Достық', 'Friendly'),
            'warm': staffText('Тёплый', 'Жылы', 'Warm'),
            'concise': staffText('Краткий', 'Қысқа', 'Concise'),
            'formal': staffText('Деловой', 'Ресми', 'Formal'),
          },
        ),
        StaffField(
          'supportedLanguages',
          staffText('Языки', 'Тілдер', 'Languages'),
          type: 'multi',
          options: {'ru': 'Русский', 'kk': 'Қазақша', 'en': 'English'},
        ),
        StaffField(
          'historyMessages',
          staffText(
            'Сообщений в контексте',
            'Контекст хабарламалары',
            'Context messages',
          ),
          type: 'number',
          minimum: 0,
          maximum: 30,
          required: true,
        ),
        StaffField(
          'businessDescription',
          staffText('О компании', 'Компания туралы', 'Business description'),
          type: 'multiline',
          maxLength: 4000,
        ),
        StaffField(
          'customInstructions',
          staffText(
            'Инструкции ассистенту',
            'Көмекші нұсқаулары',
            'Assistant instructions',
          ),
          type: 'multiline',
          maxLength: 6000,
        ),
        StaffField(
          'welcomeMessage',
          staffText('Приветствие', 'Сәлемдесу', 'Welcome message'),
          type: 'multiline',
          required: true,
          maxLength: 500,
        ),
        StaffField(
          'fallbackMessage',
          staffText(
            'Ответ при ошибке',
            'Қате кезіндегі жауап',
            'Fallback message',
          ),
          type: 'multiline',
          required: true,
          maxLength: 500,
        ),
      ],
      initial: _settings,
      save: (values) async {
        if (values['apiKey'] == '') values.remove('apiKey');
        await widget.api.request(
          '/whatsapp/settings',
          method: 'PUT',
          body: values,
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _pairing() async {
    final result = await staffEdit(
      context,
      title: staffText(
        'Переподключить WhatsApp?',
        'WhatsApp-ты қайта қосу керек пе?',
        'Reconnect WhatsApp?',
      ),
      description: staffText(
        'Потребуется заново сканировать QR-код в связанных устройствах WhatsApp.',
        'WhatsApp байланысқан құрылғыларында QR кодты қайта сканерлеу керек.',
        'Scan the new QR code in WhatsApp linked devices.',
      ),
      fields: [],
      save: (_) async {
        await widget.api.request('/whatsapp/pairing/reset', method: 'POST');
      },
    );
    if (result == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (!widget.conversationOnly) ...[
          Card(
            child: ExpansionTile(
              title: Text(
                _connection['connected'] == true
                    ? staffText(
                        'WhatsApp подключён',
                        'WhatsApp қосылған',
                        'WhatsApp connected',
                      )
                    : staffText(
                        'Подключение WhatsApp',
                        'WhatsApp қосылымы',
                        'WhatsApp connection',
                      ),
              ),
              subtitle: Text(
                '${_connection['phone'] ?? ''} ${_connection['lastError'] ?? ''}',
              ),
              children: [
                if ('${_connection['qrDataUrl'] ?? ''}'.startsWith(
                  'data:image/',
                ))
                  Padding(
                    padding: const EdgeInsets.all(18),
                    child: Image.memory(
                      base64Decode(
                        '${_connection['qrDataUrl']}'.split(',').last,
                      ),
                      width: 240,
                      height: 240,
                    ),
                  ),
                TextButton(
                  onPressed: widget.canEdit ? _pairing : null,
                  child: Text(
                    staffText('Переподключить', 'Қайта қосу', 'Reconnect'),
                  ),
                ),
              ],
            ),
          ),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: widget.canEdit ? _configure : null,
                icon: const Icon(Icons.tune),
                label: Text(staffText('Ассистент', 'Көмекші', 'Assistant')),
              ),
              OutlinedButton.icon(
                onPressed: () => Navigator.push(
                  context,
                  StaffPageRoute<void>(
                    builder: (_) => Scaffold(
                      appBar: AppBar(
                        title: Text(
                          staffText(
                            'База знаний',
                            'Білім базасы',
                            'Knowledge base',
                          ),
                        ),
                      ),
                      body: StaffResource(
                        api: widget.api,
                        path: '/whatsapp/knowledge',
                        listKey: 'documents',
                        title: staffText('Документ', 'Құжат', 'Document'),
                        titleKey: 'title',
                        canEdit: widget.canEdit,
                        defaults: {'isActive': true},
                        deletePath: (row) =>
                            '/whatsapp/knowledge/${Uri.encodeComponent('${row['id']}')}',
                        fields: [
                          StaffField(
                            'title',
                            staffText('Заголовок', 'Тақырып', 'Title'),
                            required: true,
                            maxLength: 160,
                          ),
                          StaffField(
                            'category',
                            staffText('Категория', 'Санат', 'Category'),
                            maxLength: 60,
                          ),
                          StaffField(
                            'content',
                            staffText('Содержание', 'Мазмұны', 'Content'),
                            required: true,
                            type: 'multiline',
                            maxLength: 12000,
                          ),
                          StaffField(
                            'isActive',
                            staffText('Использовать', 'Пайдалану', 'Enabled'),
                            type: 'bool',
                          ),
                        ],
                        facts: {
                          'category': staffText(
                            'Категория',
                            'Санат',
                            'Category',
                          ),
                          'isActive': staffText(
                            'Активен',
                            'Белсенді',
                            'Active',
                          ),
                        },
                      ),
                    ),
                  ),
                ),
                icon: const Icon(Icons.library_books_outlined),
                label: Text(
                  staffText('База знаний', 'Білім базасы', 'Knowledge base'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        TextField(
          decoration: InputDecoration(
            labelText: staffText(
              'Поиск диалогов',
              'Диалогтарды іздеу',
              'Search conversations',
            ),
            prefixIcon: const Icon(Icons.search),
          ),
          onChanged: (v) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), () {
              _search = v;
              _page = 1;
              unawaited(_load());
            });
          },
        ),
        const SizedBox(height: 12),
        StaffPicker(
          label: staffText('Статус', 'Мәртебе', 'Status'),
          value: _status,
          options: {
            '': staffText('Все', 'Барлығы', 'All'),
            ...staffWhatsAppStatuses(),
          },
          onChanged: (v) {
            _status = v;
            _page = 1;
            unawaited(_load());
          },
        ),
        for (final row in _rows)
          Card(
            child: ListTile(
              title: Text('${row['displayName'] ?? row['phone']}'),
              subtitle: Text(
                '${row['lastMessagePreview'] ?? ''}\n${staffDate(row['lastMessageAt'])}',
              ),
              trailing: (row['unreadCount'] as num? ?? 0) > 0
                  ? Badge(
                      label: Text('${row['unreadCount']}'),
                      child: const Icon(Icons.chat_bubble_outline),
                    )
                  : const Icon(Icons.chevron_right),
              onTap: () async {
                await Navigator.push(
                  context,
                  StaffPageRoute<void>(
                    builder: (_) => StaffWhatsAppConversation(
                      api: widget.api,
                      id: '${row['id']}',
                      conversationOnly: widget.conversationOnly,
                      canEdit: widget.canEdit,
                      draft: _drafts['${row['id']}'] ?? '',
                      onDraft: (v) => _drafts['${row['id']}'] = v,
                    ),
                  ),
                );
                if (mounted) unawaited(_load());
              },
            ),
          ),
        if (!_loading && _rows.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              staffText('Диалогов нет', 'Диалогтар жоқ', 'No conversations'),
              textAlign: TextAlign.center,
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
    ),
  );
  @override
  void dispose() {
    _generation++;
    _debounce?.cancel();
    _live.dispose();
    super.dispose();
  }
}

class StaffWhatsAppConversation extends StatefulWidget {
  const StaffWhatsAppConversation({
    required this.api,
    required this.id,
    required this.conversationOnly,
    this.canEdit = true,
    this.draft = '',
    this.onDraft,
    super.key,
  });
  final StaffApiClient api;
  final String id, draft;
  final bool conversationOnly, canEdit;
  final ValueChanged<String>? onDraft;
  @override
  State<StaffWhatsAppConversation> createState() =>
      _StaffWhatsAppConversationState();
}

class _StaffWhatsAppConversationState extends State<StaffWhatsAppConversation> {
  Map<String, dynamic>? _conversation;
  List<Map<String, dynamic>> _messages = [], _memories = [];
  late final TextEditingController _reply;
  late final StaffLiveRefresh _live;
  bool _loading = false, _sending = false;
  String? _error, _requestId, _requestText;
  final _scroll = ScrollController();
  @override
  void initState() {
    super.initState();
    _reply = TextEditingController(text: widget.draft);
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _loading);
    unawaited(_load());
  }

  String get _path =>
      '/whatsapp/conversations/${Uri.encodeComponent(widget.id)}';
  Future<void> _load() async {
    if (!mounted || _loading) return;
    _loading = true;
    try {
      final result = await widget.api.request(_path);
      if (!mounted) return;
      final rows = staffRows(result['messages']);
      final nearBottom =
          !_scroll.hasClients || _scroll.position.extentAfter < 120;
      final changed = _messages.lastOrNull?['id'] != rows.lastOrNull?['id'];
      setState(() {
        _conversation = Map<String, dynamic>.from(
          result['conversation'] as Map,
        );
        _messages = rows;
        _memories = staffRows(result['memories']);
        _error = null;
      });
      if (widget.canEdit && (_conversation?['unreadCount'] as num? ?? 0) > 0) {
        await widget.api.request(
          _path,
          method: 'PATCH',
          body: {'markRead': true},
        );
      }
      if (changed && nearBottom) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _scroll.hasClients) {
            _scroll.jumpTo(_scroll.position.maxScrollExtent);
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      _loading = false;
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (!widget.canEdit || text.isEmpty || _sending) return;
    if (_requestText != text) {
      _requestText = text;
      _requestId = staffRequestId();
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.api.request(
        '$_path/messages',
        method: 'POST',
        body: {'text': text, 'clientMessageId': _requestId},
      );
      if (mounted) {
        _reply.clear();
        widget.onDraft?.call('');
        _requestId = null;
        _requestText = null;
        await _load();
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _configure() async {
    final saved = await staffEdit(
      context,
      title: staffText(
        'Настройки диалога',
        'Диалог баптаулары',
        'Conversation settings',
      ),
      fields: [
        StaffField(
          'displayName',
          staffText('Имя', 'Аты', 'Name'),
          maxLength: 160,
        ),
        StaffField(
          'status',
          staffText('Статус', 'Мәртебе', 'Status'),
          options: staffWhatsAppStatuses(),
        ),
        StaffField(
          'assistantEnabled',
          staffText(
            'Ответы ассистента',
            'Көмекші жауаптары',
            'Assistant replies',
          ),
          type: 'bool',
        ),
      ],
      initial: _conversation ?? {},
      save: (values) async {
        await widget.api.request(_path, method: 'PATCH', body: values);
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _memory([Map<String, dynamic>? message]) async {
    final saved = await staffEdit(
      context,
      title: staffText(
        'Память о клиенте',
        'Клиент туралы жады',
        'Customer memory',
      ),
      fields: [
        StaffField(
          'label',
          staffText('Название', 'Атауы', 'Label'),
          maxLength: 120,
        ),
        StaffField(
          'content',
          staffText(
            'Что запомнить',
            'Нені есте сақтау керек',
            'What to remember',
          ),
          type: 'multiline',
          required: true,
          maxLength: 2000,
        ),
      ],
      initial: {'content': message?['content'] ?? ''},
      save: (values) async {
        await widget.api.request(
          '$_path/memories',
          method: 'POST',
          body: {
            ...values,
            'sourceType': message == null ? 'manual' : 'message',
            if (message != null) 'sourceMessageId': message['id'],
          },
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _deleteMemory(Map row) async {
    final saved = await staffEdit(
      context,
      title: staffText(
        'Удалить из памяти?',
        'Жадыдан жою керек пе?',
        'Delete memory?',
      ),
      description: '${row['label']}',
      fields: [],
      submitLabel: staffText('Удалить', 'Жою', 'Delete'),
      save: (_) async {
        await widget.api.request(
          '$_path/memories/${Uri.encodeComponent('${row['id']}')}',
          method: 'DELETE',
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        '${_conversation?['displayName'] ?? _conversation?['phone'] ?? 'WhatsApp'}',
      ),
      actions: [
        IconButton(
          tooltip: staffText('Настройки', 'Баптаулар', 'Settings'),
          onPressed: widget.canEdit ? _configure : null,
          icon: const Icon(Icons.tune),
        ),
      ],
    ),
    body: SafeArea(
      child: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: _StaffError(message: _error!, onRetry: _load),
            ),
          if (!widget.conversationOnly)
            ExpansionTile(
              title: Text(
                '${staffText('Память', 'Жады', 'Memory')} · ${_memories.length}',
              ),
              children: [
                for (final row in _memories)
                  ListTile(
                    title: Text('${row['label']}'),
                    subtitle: Text('${row['content']}'),
                    trailing: IconButton(
                      tooltip: staffText('Удалить', 'Жою', 'Delete'),
                      onPressed: widget.canEdit
                          ? () => _deleteMemory(row)
                          : null,
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ),
                TextButton.icon(
                  onPressed: widget.canEdit ? () => _memory() : null,
                  icon: const Icon(Icons.add),
                  label: Text(
                    staffText('Запомнить', 'Есте сақтау', 'Add memory'),
                  ),
                ),
              ],
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.all(16),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final message = _messages[index];
                  final inbound = message['direction'] == 'inbound';
                  return Align(
                    alignment: inbound
                        ? Alignment.centerLeft
                        : Alignment.centerRight,
                    child: Container(
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.sizeOf(context).width * .86,
                      ),
                      margin: const EdgeInsets.symmetric(vertical: 5),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: inbound
                            ? const Color(0xFFF4F4F2)
                            : const Color(0xFFFFF1CC),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            message['senderType'] == 'customer'
                                ? staffText('Клиент', 'Клиент', 'Customer')
                                : message['senderType'] == 'operator'
                                ? staffText('Оператор', 'Оператор', 'Operator')
                                : staffText(
                                    'Ассистент',
                                    'Көмекші',
                                    'Assistant',
                                  ),
                            style: Theme.of(context).textTheme.labelMedium,
                          ),
                          SelectableText('${message['content'] ?? ''}'),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 8,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                staffDate(message['createdAt']),
                                style: Theme.of(context).textTheme.labelSmall,
                              ),
                              if (!inbound)
                                Text(
                                  staffMessageStatus(message['deliveryStatus']),
                                  style: Theme.of(context).textTheme.labelSmall,
                                ),
                              if (!widget.conversationOnly)
                                IconButton(
                                  tooltip: staffText(
                                    'Запомнить',
                                    'Есте сақтау',
                                    'Save to memory',
                                  ),
                                  onPressed: widget.canEdit
                                      ? () => _memory(message)
                                      : null,
                                  icon: const Icon(
                                    Icons.bookmark_add_outlined,
                                    size: 18,
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
            child: Column(
              children: [
                if (_conversation?['assistantEnabled'] == false)
                  Text(
                    staffText(
                      'Отвечает оператор',
                      'Оператор жауап береді',
                      'Operator mode',
                    ),
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _reply,
                        enabled: !_sending,
                        minLines: 1,
                        maxLines: 5,
                        maxLength: 10000,
                        onChanged: widget.onDraft,
                        decoration: InputDecoration(
                          hintText: staffText(
                            'Сообщение',
                            'Хабарлама',
                            'Message',
                          ),
                          counterText: '',
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: staffText(
                        'Голосовое сообщение',
                        'Дауыстық хабарлама',
                        'Voice message',
                      ),
                      onPressed: !widget.canEdit || _sending
                          ? null
                          : () async {
                              await showDialog<void>(
                                context: context,
                                barrierDismissible: false,
                                builder: (_) => StaffVoiceRecorder(
                                  api: widget.api,
                                  conversationId: widget.id,
                                ),
                              );
                              if (mounted) unawaited(_load());
                            },
                      icon: const Icon(Icons.mic_none),
                    ),
                    IconButton(
                      tooltip: staffText('Отправить', 'Жіберу', 'Send'),
                      onPressed: !widget.canEdit || _sending ? null : _send,
                      icon: _sending
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_outlined),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  @override
  void dispose() {
    _live.dispose();
    _reply.dispose();
    _scroll.dispose();
    super.dispose();
  }
}

class StaffVoiceRecorder extends StatefulWidget {
  const StaffVoiceRecorder({
    required this.api,
    required this.conversationId,
    super.key,
  });
  final StaffApiClient api;
  final String conversationId;
  @override
  State<StaffVoiceRecorder> createState() => _StaffVoiceRecorderState();
}

class _StaffVoiceRecorderState extends State<StaffVoiceRecorder>
    with WidgetsBindingObserver {
  final _recorder = AudioRecorder();
  final _player = AudioPlayer();
  final _requestId = staffRequestId();
  Timer? _timer;
  String? _path, _error;
  bool _recording = false, _busy = false, _playing = false;
  int _seconds = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  Future<void> _start() async {
    if (_busy || _recording) return;
    setState(() => _busy = true);
    try {
      if (!await _recorder.hasPermission()) {
        throw Exception(
          staffText(
            'Разрешите доступ к микрофону в настройках телефона.',
            'Телефон баптауларында микрофонға рұқсат беріңіз.',
            'Allow microphone access in phone settings.',
          ),
        );
      }
      final path = kIsWeb
          ? 'voice.m4a'
          : '${(await getTemporaryDirectory()).path}/bulka-voice-$_requestId.m4a';
      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 64000,
          sampleRate: 44100,
          numChannels: 1,
        ),
        path: path,
      );
      if (!mounted) {
        await _recorder.cancel();
        return;
      }
      setState(() {
        _recording = true;
        _error = null;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() => _seconds++);
        if (_seconds >= 120) unawaited(_stop());
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stop() async {
    if (!_recording || _busy) return;
    _timer?.cancel();
    setState(() => _busy = true);
    try {
      final path = await _recorder.stop();
      if (mounted) {
        setState(() {
          _path = path;
          _recording = false;
          _seconds = _seconds.clamp(1, 120);
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _listen() async {
    if (_path == null || _busy) return;
    try {
      if (_playing) {
        await _player.pause();
        if (mounted) setState(() => _playing = false);
      } else {
        if (kIsWeb) {
          await _player.setUrl(_path!);
        } else {
          await _player.setFilePath(_path!);
        }
        if (mounted) setState(() => _playing = true);
        await _player.play();
        if (mounted) setState(() => _playing = false);
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _send() async {
    if (_path == null || _busy) return;
    setState(() => _busy = true);
    try {
      await _player.stop();
      final bytes = await XFile(_path!).readAsBytes();
      await widget.api.sendVoice(
        widget.conversationId,
        bytes,
        _seconds,
        _requestId,
      );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && _recording) unawaited(_stop());
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: AlertDialog(
      title: Text(
        staffText('Голосовое сообщение', 'Дауыстық хабарлама', 'Voice message'),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${(_seconds ~/ 60).toString().padLeft(2, '0')}:${(_seconds % 60).toString().padLeft(2, '0')}',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          Text(
            _recording
                ? staffText('Идёт запись', 'Жазылуда', 'Recording')
                : staffText(
                    'Микрофон нужен для ответа клиенту. Запись можно прослушать перед отправкой.',
                    'Микрофон клиентке жауап беру үшін қажет. Жазбаны жібермес бұрын тыңдауға болады.',
                    'The microphone records your reply. Listen before sending.',
                  ),
          ),
          if (_error != null)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (_busy) const LinearProgressIndicator(),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
        ),
        if (_path == null)
          FilledButton(
            onPressed: _busy
                ? null
                : _recording
                ? _stop
                : _start,
            child: Text(
              _recording
                  ? staffText('Остановить', 'Тоқтату', 'Stop')
                  : staffText('Записать', 'Жазу', 'Record'),
            ),
          ),
        if (_path != null) ...[
          TextButton(
            onPressed: _busy ? null : _listen,
            child: Text(
              _playing
                  ? staffText('Пауза', 'Үзіліс', 'Pause')
                  : staffText('Прослушать', 'Тыңдау', 'Listen'),
            ),
          ),
          FilledButton(
            onPressed: _busy ? null : _send,
            child: Text(staffText('Отправить', 'Жіберу', 'Send')),
          ),
        ],
      ],
    ),
  );
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    unawaited(_player.dispose());
    final path = _path;
    unawaited(() async {
      if (_recording) await _recorder.cancel();
      await _recorder.dispose();
      if (path != null && !kIsWeb) {
        final file = io.File(path);
        try {
          if (await file.exists()) await file.delete();
        } on io.FileSystemException catch (_) {
          /* OS may still be releasing the recording. */
        }
      }
    }());
    super.dispose();
  }
}
