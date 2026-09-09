part of '../main.dart';

String staffRequestId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

List<Map<String, dynamic>> staffRows(dynamic value) => value is List
    ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : [];
String staffDay(DateTime value) =>
    '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
String staffDate(dynamic value) {
  final date = DateTime.tryParse(
    '$value',
  )?.toUtc().add(const Duration(hours: 5));
  return date == null
      ? '—'
      : '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

String staffMoney(dynamic value) => '${staffNumber(value)} ₸';
String staffNumber(dynamic value) {
  final number = value is num ? value : num.tryParse('$value');
  if (number == null || !number.isFinite) return '—';
  return staffValue(number);
}

String staffStatus(dynamic value) => switch ('$value') {
  'new' => staffText('Новый', 'Жаңа', 'New'),
  'accepted' => staffText('Принят', 'Қабылданды', 'Accepted'),
  'preparing' => staffText('Готовится', 'Дайындалуда', 'Preparing'),
  'ready' => staffText('Готов', 'Дайын', 'Ready'),
  'completed' || 'delivered' => staffText('Завершён', 'Аяқталды', 'Completed'),
  'cancelled' => staffText('Отменён', 'Бас тартылды', 'Cancelled'),
  'paid' => staffText('Оплачен', 'Төленді', 'Paid'),
  'pending' => staffText(
    'Ожидает оплаты',
    'Төлем күтілуде',
    'Awaiting payment',
  ),
  'failed' => staffText('Ошибка', 'Қате', 'Failed'),
  'refunded' => staffText('Возврат', 'Қайтарылды', 'Refunded'),
  'processing' ||
  'unknown' => staffText('Проверяется', 'Тексерілуде', 'Reconciling'),
  'pickup' => staffText('Самовывоз', 'Өзімен алып кету', 'Pickup'),
  'delivery' => staffText('Доставка', 'Жеткізу', 'Delivery'),
  'preorder' => staffText('Предзаказ', 'Алдын ала тапсырыс', 'Preorder'),
  'unassigned' => staffText(
    'Курьер не назначен',
    'Курьер тағайындалмады',
    'Unassigned',
  ),
  'assigned' => staffText('Курьер назначен', 'Курьер тағайындалды', 'Assigned'),
  'picked_up' => staffText('У курьера', 'Курьерде', 'Picked up'),
  'in_transit' => staffText('В пути', 'Жолда', 'On the way'),
  _ => value == null ? '—' : '$value',
};

/// One subscription per visible native page, with resume refresh and retry fallback.
class StaffLiveRefresh with WidgetsBindingObserver {
  StaffLiveRefresh(
    this.api,
    this.refresh, {
    this.events = const [],
    this.isBusy,
  }) {
    WidgetsBinding.instance.addObserver(this);
    _connect();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_active && !_disposed) {
        _schedule();
        _connect();
      }
    });
  }
  final StaffApiClient api;
  final FutureOr<void> Function() refresh;
  final bool Function()? isBusy;
  final List<String> events;
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Timer? _timer, _debounce;
  bool _active = true, _disposed = false, _running = false, _pending = false;
  int _connection = 0;
  String? _lastId;
  void _schedule() {
    if (_disposed || !_active) return;
    _pending = true;
    if (_running) return;
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 100),
      () => unawaited(_drain()),
    );
  }

  Future<void> _drain() async {
    if (_disposed || !_active || _running) return;
    if (isBusy?.call() == true) {
      _debounce = Timer(
        const Duration(milliseconds: 200),
        () => unawaited(_drain()),
      );
      return;
    }
    _running = true;
    try {
      while (_pending && !_disposed && _active) {
        _pending = false;
        try {
          await refresh();
        } catch (_) {
          /* Page owns its visible error state. */
        }
      }
    } finally {
      _running = false;
    }
  }

  void _connect() {
    if (_subscription != null || !_active || _disposed) return;
    final connection = ++_connection;
    _subscription = api
        .events(lastEventId: _lastId)
        .listen(
          (event) {
            if (connection != _connection || _disposed) return;
            if ('${event['id'] ?? ''}'.isNotEmpty) _lastId = '${event['id']}';
            if (events.isEmpty ||
                events.contains(event['type']) ||
                event['type'] == 'connected') {
              _schedule();
            }
          },
          onError: (Object _) {
            if (connection == _connection) _subscription = null;
          },
          onDone: () {
            if (connection == _connection) _subscription = null;
          },
          cancelOnError: true,
        );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active && !_disposed) {
      _schedule();
      _connect();
    } else {
      _connection++;
      _debounce?.cancel();
      unawaited(_subscription?.cancel());
      _subscription = null;
    }
  }

  void dispose() {
    _disposed = true;
    _connection++;
    _timer?.cancel();
    _debounce?.cancel();
    unawaited(_subscription?.cancel());
    WidgetsBinding.instance.removeObserver(this);
  }
}

class StaffField {
  const StaffField(
    this.key,
    this.label, {
    this.type = 'text',
    this.required = false,
    this.minimum,
    this.maximum,
    this.options,
    this.maxLength,
    this.hint,
    this.pick,
    this.translateFrom,
    this.translate,
    this.advanced = false,
    this.visibleWhen,
  });
  final String key, label, type;
  final bool required;
  final num? minimum, maximum;
  final int? maxLength;
  final Map<String, String>? options;
  final String? hint;
  final Future<String?> Function()? pick;
  final String? translateFrom;
  final Future<String> Function(String)? translate;
  final bool advanced;
  final bool Function(Map<String, dynamic>)? visibleWhen;
}

Future<bool?> staffEdit(
  BuildContext context, {
  required String title,
  required List<StaffField> fields,
  Map<String, dynamic> initial = const {},
  required Future<void> Function(Map<String, dynamic>) save,
  String? description,
  String? submitLabel,
}) => showDialog<bool>(
  context: context,
  barrierDismissible: false,
  builder: (_) => _StaffEditor(
    title: title,
    fields: fields,
    initial: initial,
    save: save,
    description: description,
    submitLabel: submitLabel,
  ),
);

class _StaffEditor extends StatefulWidget {
  const _StaffEditor({
    required this.title,
    required this.fields,
    required this.initial,
    required this.save,
    this.description,
    this.submitLabel,
  });
  final String title;
  final List<StaffField> fields;
  final Map<String, dynamic> initial;
  final Future<void> Function(Map<String, dynamic>) save;
  final String? description, submitLabel;
  @override
  State<_StaffEditor> createState() => _StaffEditorState();
}

class _StaffEditorState extends State<_StaffEditor> {
  final _form = GlobalKey<FormState>();
  final _controllers = <String, TextEditingController>{};
  final _values = <String, dynamic>{};
  bool _busy = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    for (final field in widget.fields) {
      final initial = widget.initial[field.key];
      if (field.type == 'bool') {
        _values[field.key] = initial == true;
      } else if (field.type == 'multi') {
        _values[field.key] = (initial is List ? initial : const [])
            .whereType<String>()
            .toList();
      } else if (field.options != null) {
        _values[field.key] =
            '${initial ?? field.options!.keys.firstOrNull ?? ''}';
      } else {
        _controllers[field.key] = TextEditingController(
          text: initial == null ? '' : '$initial',
        );
      }
    }
  }

  Future<void> _save() async {
    if (_busy || !_form.currentState!.validate()) return;
    final values = <String, dynamic>{..._values};
    for (final field in widget.fields.where(
      (f) => _controllers.containsKey(f.key),
    )) {
      final text = _controllers[field.key]!.text.trim();
      values[field.key] = field.type == 'number'
          ? num.tryParse(text.replaceAll(',', '.'))
          : text;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.save(values);
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick(StaffField field) async {
    if (_busy || field.pick == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final value = await field.pick!();
      if (mounted && value != null) {
        setState(() => _controllers[field.key]!.text = value);
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _translate(StaffField field) async {
    if (_busy || field.translate == null) return;
    final source = _controllers[field.translateFrom]?.text.trim() ?? '';
    if (source.isEmpty) return;
    setState(() => _busy = true);
    try {
      final translated = await field.translate!(source);
      if (mounted) setState(() => _controllers[field.key]!.text = translated);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool _fieldVisible(StaffField field) =>
      field.visibleWhen?.call(_values) ?? true;

  Widget _fieldWidget(StaffField field) => Padding(
    padding: const EdgeInsets.only(bottom: 18),
    child: field.type == 'bool'
        ? SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: Text(field.label),
            value: _values[field.key] == true,
            onChanged: _busy
                ? null
                : (value) => setState(() => _values[field.key] = value),
          )
        : field.options != null
        ? AbsorbPointer(
            absorbing: _busy,
            child: field.type == 'multi'
                ? StaffMultiPicker(
                    label: field.label,
                    values: List<String>.from(_values[field.key] as List),
                    options: field.options!,
                    onChanged: (values) =>
                        setState(() => _values[field.key] = values),
                  )
                : StaffPicker(
                    label: field.label,
                    value: '${_values[field.key]}',
                    options: field.options!,
                    onChanged: (value) =>
                        setState(() => _values[field.key] = value),
                  ),
          )
        : TextFormField(
            controller: _controllers[field.key],
            enabled: !_busy,
            obscureText: field.type == 'password',
            autocorrect: field.type != 'password',
            minLines: field.type == 'multiline' ? 2 : 1,
            maxLines: field.type == 'multiline' ? 5 : 1,
            maxLength: field.maxLength,
            keyboardType: field.type == 'number'
                ? const TextInputType.numberWithOptions(
                    decimal: true,
                    signed: true,
                  )
                : field.type == 'phone'
                ? TextInputType.phone
                : null,
            decoration: InputDecoration(
              labelText: field.label,
              helperText: field.hint,
              suffixIcon: field.translate != null
                  ? IconButton(
                      tooltip: staffText(
                        'Перевести с русского',
                        'Орыс тілінен аудару',
                        'Translate from Russian',
                      ),
                      onPressed: _busy ? null : () => _translate(field),
                      icon: const Icon(Icons.translate),
                    )
                  : field.pick == null
                  ? null
                  : IconButton(
                      tooltip: staffText('Выбрать', 'Таңдау', 'Choose'),
                      onPressed: _busy ? null : () => _pick(field),
                      icon: Icon(
                        field.key.endsWith('At')
                            ? Icons.calendar_month_outlined
                            : Icons.photo_library_outlined,
                      ),
                    ),
            ),
            validator: (value) {
              final text = (value ?? '').trim();
              if (field.required && text.isEmpty) {
                return staffText(
                  'Обязательное поле',
                  'Міндетті өріс',
                  'Required',
                );
              }
              if (field.type == 'number' && text.isNotEmpty) {
                final n = num.tryParse(text.replaceAll(',', '.'));
                if (n == null ||
                    !n.isFinite ||
                    (field.minimum != null && n < field.minimum!) ||
                    (field.maximum != null && n > field.maximum!)) {
                  return staffText(
                    'Проверьте значение',
                    'Мәнді тексеріңіз',
                    'Check the value',
                  );
                }
              }
              return null;
            },
          ),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: BulkaActionDialog(
      title: Text(widget.title),
      content: Form(
        key: _form,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.description != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(widget.description!),
                ),
              for (final field in widget.fields.where(
                (field) => !field.advanced && _fieldVisible(field),
              ))
                _fieldWidget(field),
              if (widget.fields.any((field) => field.advanced))
                ExpansionTile(
                  title: Text(
                    staffText(
                      'Дополнительные условия',
                      'Қосымша шарттар',
                      'Additional conditions',
                    ),
                  ),
                  tilePadding: EdgeInsets.zero,
                  maintainState: true,
                  children: [
                    for (final field in widget.fields.where(
                      (field) => field.advanced && _fieldVisible(field),
                    ))
                      _fieldWidget(field),
                  ],
                ),
              if (_error != null)
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
            ],
          ),
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
              : Text(
                  widget.submitLabel ??
                      staffText('Сохранить', 'Сақтау', 'Save'),
                ),
        ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context, false),
          child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
        ),
      ],
    ),
  );
  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }
}

class StaffMultiPicker extends StatelessWidget {
  const StaffMultiPicker({
    required this.label,
    required this.values,
    required this.options,
    required this.onChanged,
    super.key,
  });
  final String label;
  final List<String> values;
  final Map<String, String> options;
  final ValueChanged<List<String>> onChanged;
  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: () async {
      final selected = await staffChooseFields(
        context,
        label,
        options,
        values,
        limit: 50,
      );
      if (selected != null && context.mounted) onChanged(selected);
    },
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          Text(
            values.isEmpty
                ? staffText('Не выбрано', 'Таңдалмаған', 'Not selected')
                : values.map((id) => options[id] ?? id).join(', '),
          ),
        ],
      ),
    ),
  );
}

class StaffFacts extends StatelessWidget {
  const StaffFacts(this.values, {super.key});
  final Map<String, String> values;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final fact in values.entries)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            spacing: 16,
            runSpacing: 4,
            children: [
              Text(fact.key, style: Theme.of(context).textTheme.bodySmall),
              SelectableText(fact.value),
            ],
          ),
        ),
    ],
  );
}

Future<void> staffExportCsv(
  BuildContext context,
  String name,
  Map<String, String> columns,
  List<Map<String, dynamic>> rows,
) async {
  String cell(dynamic value) {
    var text = value == null ? '' : '$value';
    if (RegExp(r'^[\s]*[=+@\-]').hasMatch(text) ||
        text.startsWith('\t') ||
        text.startsWith('\r')) {
      text = "'$text";
    }
    return '"${text.replaceAll('"', '""')}"';
  }

  final csv =
      '\uFEFF${columns.values.map(cell).join(';')}\r\n${rows.map((row) => columns.keys.map((key) => cell(row[key])).join(';')).join('\r\n')}';
  final box = context.findRenderObject() as RenderBox?;
  await SharePlus.instance.share(
    ShareParams(
      files: [
        XFile.fromData(
          Uint8List.fromList(utf8.encode(csv)),
          mimeType: 'text/csv',
          name: '$name.csv',
        ),
      ],
      sharePositionOrigin: box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size,
    ),
  );
}

Future<bool> staffConfirmDiscard(BuildContext context) async =>
    await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(
          staffText(
            'Есть несохранённые изменения',
            'Сақталмаған өзгерістер бар',
            'Unsaved changes',
          ),
        ),
        content: Text(
          staffText(
            'Выйти без сохранения?',
            'Сақтамай шығу керек пе?',
            'Leave without saving?',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: Text(
              staffText(
                'Продолжить редактирование',
                'Өңдеуді жалғастыру',
                'Keep editing',
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(c, true),
            child: Text(staffText('Выйти', 'Шығу', 'Leave')),
          ),
        ],
      ),
    ) ??
    false;
